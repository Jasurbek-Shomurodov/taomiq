"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { isLocale } from "@/i18n/config";
import { getCustomerId } from "@/lib/account/auth";
import { saveDelivery } from "@/lib/account/delivery";
import { composeExclusions, normalizeTags, type AllergenKey } from "@/lib/allergens";
import { captureServerEvent } from "@/lib/analytics/server";
import type { ServerEventProperties } from "@/lib/analytics/events";
import { getDurations, getOrderSettings, getPrograms } from "@/lib/data/catalog";
import { pricePerDay } from "@/lib/data/types";
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

/**
 * The order_placed analytics event, sent after the response (after()), so it never delays or fails the order.
 * Describes the order only, never the customer (no name, phone, address or comment). A no-op without the PostHog key.
 */
function scheduleOrderPlaced(properties: ServerEventProperties<"order_placed">, userId: string | null): void {
  try {
    after(() => captureServerEvent("order_placed", properties, { userId: userId ?? undefined }));
  } catch (error) {
    console.error("analytics: order_placed not scheduled", error instanceof Error ? error.message : error);
  }
}

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
 * The number of the order already saved with this request id (migration 0027), or null: none yet, or the read
 * failed (then submit_order() still finds it and says so with created = false).
 */
async function savedOrderNumber(requestId: string): Promise<number | null> {
  try {
    const { data, error } = await createSecretClient()
      .from("orders")
      .select("number")
      .eq("request_id", requestId)
      .maybeSingle();
    if (error || !data) return null;
    const number = Number(data.number);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  } catch {
    return null;
  }
}

/**
 * submit_order()'s answer: since migration 0027 one row { order_number, created } (in an array, as PostgREST returns a
 * set), before it a bare number (always a new order). Null when it is neither.
 */
function savedOrder(data: unknown): { number: number; created: boolean } | null {
  const row: unknown = Array.isArray(data) ? data[0] : data;
  let number: number;
  let created = true;
  if (typeof row === "number" || typeof row === "string") number = Number(row);
  else if (row && typeof row === "object" && "order_number" in row) {
    number = Number(row.order_number);
    created = !("created" in row) || row.created !== false;
  } else return null;
  return Number.isSafeInteger(number) && number > 0 ? { number, created } : null;
}

/**
 * The allergens ticked on the order form, as keys on the order (migration 0031, public.set_order_exclusion_tags,
 * service_role only), for the kitchen sheet's grouping. Sent after the response (after()), so it never delays or fails
 * the order: after a new order, and again on a retry that found the order saved (the first round may have lost its
 * answer before the tags were set; setting the same tags twice is harmless). The same allergens are already in the
 * order's exclusions text in words, so a failure (also: the migration not applied yet) is only logged, with its code.
 */
function scheduleExclusionTags(number: number, tags: readonly AllergenKey[]): void {
  if (tags.length === 0) return;
  try {
    after(async () => {
      try {
        const { error } = await createSecretClient().rpc("set_order_exclusion_tags", { p_number: number, p_tags: tags });
        if (error) console.error("submitOrder: exclusion tags not saved", error.code);
      } catch (error) {
        console.error("submitOrder: exclusion tags not saved", error instanceof Error ? error.name : "unknown");
      }
    });
  } catch (error) {
    console.error("submitOrder: exclusion tags not scheduled", error instanceof Error ? error.message : error);
  }
}

/**
 * "Save for next time" (migration 0030): when the customer is signed in and ticked the box, the order's address, time and
 * courier note go onto their own profile, in their own session (public.save_my_delivery checks them again). Runs only
 * after the order is saved. A failure is logged (the code only, never the address) and never fails the order.
 */
async function saveDeliveryIfAsked(form: FormData, customerId: string | null): Promise<void> {
  if (!customerId || form.get("save_delivery") !== "on") return;
  const failed = await saveDelivery({ address: text(form, "address"), window: text(form, "window"), note: text(form, "comment") });
  if (failed) console.error("submitOrder: delivery details not saved", failed);
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

    // One order per tap: the form sends one random id per form round, the same on every retry of that round. A retry of
    // a submission already saved (the first answer was lost) gets that order's number back, before anything is checked
    // again: a retry a second after the cutoff must find its order, not "pick another date", and its bot-check token is
    // already spent. submit_order() makes the same check under a lock, so two concurrent calls with one id still make
    // one order. Not a valid uuid: no id (the old behaviour).
    // The allergen chips: known keys only, each once (also for a retry below, which sets them again).
    const exclusionTags = normalizeTags(form.getAll("allergens"));

    const rawRequestId = text(form, "request_id");
    const requestId = UUID_RE.test(rawRequestId) ? rawRequestId.toLowerCase() : null;
    if (requestId && isOrderingConfigured) {
      const saved = await savedOrderNumber(requestId);
      if (saved) {
        // The first answer may have been lost before the details were saved: save them now, as the first round would.
        if (form.get("save_delivery") === "on") await saveDeliveryIfAsked(form, await getCustomerId());
        scheduleExclusionTags(saved, exclusionTags);
        return saved;
      }
    }

    // The allergen chips go at the front of the exclusions text, in words and in the order's language
    // ("Без: молоко, орехи. лук"), so staff and the kitchen read them wherever the text is shown; the 500-character
    // limit applies to the whole text.
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
      exclusions: composeExclusions(exclusionTags, text(form, "exclusions"), locale),
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

    // Bot check (Turnstile), the last step before submit_order(). Passes when the keys are not set. If Cloudflare
    // cannot be reached the order goes through: the honeypot and the database rate limit still stand, and no
    // customer is turned away for Cloudflare's outage. A missing or refused token is a state the form recovers from.
    const human = await verifyTurnstile(text(form, TURNSTILE_FIELD), (await clientIp()) || undefined, "order");
    if (!human.ok && human.reason !== "unavailable") return { error: "captcha" };

    const source: Record<string, string> = {};
    for (const key of SOURCE_KEYS) {
      const value = text(form, key);
      if (value) source[key] = value.slice(0, SOURCE_VALUE_MAX);
    }

    // The signed-in customer, from the session on the server (never from the form); null when signed out.
    const customerId = await getCustomerId();
    const args = {
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
      p_user_id: customerId,
    };
    const supabase = createSecretClient();
    let { data, error } = await supabase.rpc("submit_order", { ...args, p_request_id: requestId });
    // Before migration 0027 is applied there is only the 14-parameter function (PostgREST: no such function): call
    // that one, so this code can go live first. Remove once 0027 is in production.
    if (error?.code === "PGRST202") ({ data, error } = await supabase.rpc("submit_order", args));

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

    const saved = savedOrder(data);
    if (!saved) return { error: "failed" };
    const { number } = saved;

    // "Save for next time": also when submit_order found this request's order already saved (created = false), and in
    // the early return above for a retry the order number was read for. Saving the same details twice is harmless.
    await saveDeliveryIfAsked(form, customerId);

    // The tags on the order: also on a retry (created = false), whose first round may have stopped before setting them.
    scheduleExclusionTags(number, exclusionTags);

    // A retry that found the order saved earlier: the alert and the analytics event went out the first time.
    if (!saved.created) return number;

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
    const duration = durations.find((d) => d.days === input.days);
    scheduleOrderPlaced(
      {
        program: program?.slug ?? "",
        kcal: variant?.kcal ?? 0,
        days: input.days,
        // The price the form showed, by the same formula as submit_order().
        total_uzs: variant && duration ? pricePerDay(variant.price_per_day, duration.markup_pct) * input.days : 0,
        order_number: number,
        locale,
      },
      customerId,
    );
    return number;
  } catch (error) {
    console.error("submitOrder failed", error);
    return { error: "failed" };
  }
}
