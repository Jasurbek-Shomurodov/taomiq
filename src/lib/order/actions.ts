"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { getCustomerId } from "@/lib/account/auth";
import { getDurations, getOrderSettings, getPrograms } from "@/lib/data/catalog";
import { createSecretClient, isOrderingConfigured, supabaseSecretKey } from "@/lib/supabase/secret";
import { TURNSTILE_FIELD } from "@/lib/turnstile/shared";
import { verifyTurnstile } from "@/lib/turnstile/verify";
import {
  SOURCE_KEYS,
  SOURCE_VALUE_MAX,
  fullPhone,
  phoneDigits,
  startDateRange,
  validateOrder,
  type FieldErrors,
  type OrderInput,
} from "./rules";
import { scheduleOrderAlert } from "./telegram";

/** captcha: the bot check (Turnstile) did not pass; the widget resets and the customer presses the button again. */
export type OrderGeneralError = "failed" | "rate_limited" | "captcha";

export type OrderState = {
  fields?: FieldErrors;
  error?: OrderGeneralError;
  /** Ordering is not connected yet (no database or no secret key): ordering opens soon. */
  demo?: boolean;
  /** Fresh start-date range, sent when the chosen date is no longer allowed (e.g. the cutoff passed). */
  startRange?: { earliest: string; latest: string };
};

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable codes raised by submit_order() → where the message is shown. invalid_date is handled separately. */
const DB_ERRORS: Record<string, OrderState> = {
  invalid_variant: { fields: { plan: "invalid" } },
  invalid_days: { fields: { duration: "invalid" } },
  invalid_phone: { fields: { phone: "invalid" } },
  invalid_name: { fields: { name: "invalid" } },
  invalid_address: { fields: { address: "invalid" } },
  invalid_window: { fields: { window: "invalid" } },
  too_long: { fields: { comment: "too_long" } },
  rate_limited: { error: "rate_limited" },
};

/** The first X-Forwarded-For address (on Vercel, the visitor's), or "" when there is none. */
async function clientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() ?? "";
}

/** SHA-256 of the client IP, salted with the secret key. The raw IP is never stored. */
async function clientIpHash(): Promise<string> {
  const ip = await clientIp();
  if (!ip) return "";
  return createHash("sha256").update(`${ip}|${supabaseSecretKey}`).digest("hex");
}

/**
 * Never throws: every failure becomes a state the form can show, so nothing typed is lost.
 * Only the final redirect() (outside any try) leaves the function by throwing, as Next.js expects.
 */
export async function submitOrder(_prev: OrderState, form: FormData): Promise<OrderState> {
  const number = await placeOrder(form);
  if (typeof number !== "number") return number;
  redirect(`/${text(form, "locale")}/order/success?n=${number}`);
}

async function placeOrder(form: FormData): Promise<OrderState | number> {
  try {
    // Honeypot: a hidden field people never see. Bots that fill every input are turned away.
    if (text(form, "website")) return { error: "failed" };

    const locale = text(form, "locale");
    if (!isLocale(locale)) return { error: "failed" };

    const input: OrderInput = {
      variantId: text(form, "variant_id"),
      days: Number(text(form, "days")),
      weekdaysOnly: text(form, "schedule") === "weekdays",
      startDate: text(form, "start_date"),
      address: text(form, "address"),
      window: text(form, "window"),
      comment: text(form, "comment"),
      name: text(form, "name"),
      phone: fullPhone(phoneDigits(text(form, "phone"))),
      exclusions: text(form, "exclusions"),
      consent: form.get("consent") === "on",
    };

    const [programs, durations, settings] = await Promise.all([getPrograms(), getDurations(), getOrderSettings()]);
    const startRange = startDateRange(new Date(), settings.cutoffHour);
    const fields = validateOrder(input, {
      variantIds: programs.flatMap((p) => p.variants.map((v) => v.id)),
      days: durations.map((d) => d.days),
      windows: settings.deliveryWindows,
      ...startRange,
    });
    if (Object.keys(fields).length > 0) return fields.start ? { fields, startRange } : { fields };

    if (!isOrderingConfigured) return { demo: true };
    if (!UUID_RE.test(input.variantId)) return { fields: { plan: "invalid" } };

    // Bot check (Turnstile), the last step before the database. Passes when the keys are not set. If Cloudflare
    // cannot be reached the order goes through: the honeypot and the database rate limit still stand, and no
    // customer is turned away for Cloudflare's outage. A missing or refused token is a state the form recovers from.
    const human = await verifyTurnstile(text(form, TURNSTILE_FIELD), (await clientIp()) || undefined, "order");
    if (!human.ok && human.reason !== "unavailable") return { error: "captcha" };

    const source: Record<string, string> = {};
    for (const key of SOURCE_KEYS) {
      const value = text(form, key);
      if (value) source[key] = value.slice(0, SOURCE_VALUE_MAX);
    }

    const { data, error } = await createSecretClient().rpc("submit_order", {
      p_variant_id: input.variantId,
      p_days: input.days,
      p_weekdays_only: input.weekdaysOnly,
      p_start_date: input.startDate,
      p_name: input.name,
      p_phone: input.phone,
      p_address: input.address,
      p_window: input.window,
      p_comment: input.comment,
      p_exclusions: input.exclusions,
      p_locale: locale,
      p_source: source,
      p_ip_hash: await clientIpHash(),
      // The signed-in customer, from the session on the server (never from the form); null when signed out.
      p_user_id: await getCustomerId(),
    });

    if (error) {
      if (error.message.includes("invalid_date")) {
        // The database clock decides; recompute so the form can move the selection.
        return { fields: { start: "invalid" }, startRange: startDateRange(new Date(), settings.cutoffHour) };
      }
      const code = Object.keys(DB_ERRORS).find((c) => error.message.includes(c));
      if (code) return DB_ERRORS[code];
      console.error("submit_order failed", error.code, error.message);
      return { error: "failed" };
    }

    const number = Number(data);
    if (!Number.isSafeInteger(number) || number <= 0) return { error: "failed" };

    // The order is saved: from here nothing may turn it into a failure.
    const program = programs.find((p) => p.variants.some((v) => v.id === input.variantId));
    const variant = program?.variants.find((v) => v.id === input.variantId);
    scheduleOrderAlert({
      number,
      programName: program?.name ?? "—",
      tagColor: program?.tag_color ?? "",
      kcal: variant?.kcal ?? 0,
      days: input.days,
      weekdaysOnly: input.weekdaysOnly,
      startDate: input.startDate,
      window: input.window,
      locale,
    });
    return number;
  } catch (error) {
    console.error("submitOrder failed", error);
    return { error: "failed" };
  }
}
