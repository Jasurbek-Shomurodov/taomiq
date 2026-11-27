"use server";

import { refresh } from "next/cache";
import { getDictionary } from "@/i18n";
import { defaultLocale, isLocale, plural, type Locale } from "@/i18n/config";
import { isCalendarDay } from "@/lib/admin/finance/month";
import { getOrderSettings } from "@/lib/data/catalog";
import { DEFAULT_CUTOFF_HOUR } from "@/lib/order/rules";
import { createSessionClient } from "@/lib/supabase/server";
import { scheduleTelegramDrain } from "@/lib/telegram/drain";
import { isAccountEnabled } from "./methods";
import { customerPauseErrorOf, formatPauseRange, formatShortDay, type CustomerPauseError } from "./pauses";

/*
 * The customer's own pauses (migration 0029; docs/plans/pause-and-skip-days.md, slice 3). The database checks
 * everything (public.pause_my_order / cancel_my_pause: the caller's own order, its status, the cutoff, the cap) and
 * writes the history row, which queues the owner-group message. Errors are logged with their code only and shown as
 * one sentence in the customer's language.
 */

export type PauseState = { ok?: string; error?: string };

const NUMBER_RE = /^[1-9][0-9]{0,14}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const localeFrom = (value: unknown): Locale => (typeof value === "string" && isLocale(value) ? value : defaultLocale);

/** The end date in a pause function's answer ({ end_date: "YYYY-MM-DD" }), or null. */
function endDateOf(data: unknown): string | null {
  const end = (data as { end_date?: unknown } | null)?.end_date;
  return typeof end === "string" && isCalendarDay(end) ? end : null;
}

async function cutoffHour(): Promise<number> {
  try {
    return (await getOrderSettings()).cutoffHour;
  } catch {
    return DEFAULT_CUTOFF_HOUR;
  }
}

/** One sentence for a database error: the function's own error names, else "could not save". */
async function errorText(
  locale: Locale,
  error: { code?: string; message: string; details?: string | null },
  what: string,
): Promise<string> {
  const t = getDictionary(locale);
  const e = t.account.pause.errors;
  const code: CustomerPauseError | null =
    customerPauseErrorOf(error.message) ?? (error.code === "42501" ? "not_allowed" : null);
  if (!code) {
    console.error(`account: ${what} failed`, error.code);
    return e.failed;
  }
  if (code === "pause_limit") {
    const max = Number(error.details);
    if (!Number.isInteger(max) || max < 1) return e.failed;
    return e.pause_limit.replace("{max}", String(max)).replace("{days}", plural(max, t.order.dayForms));
  }
  if (code === "pause_too_soon" || code === "pause_locked") return e[code].replace("{hour}", String(await cutoffHour()));
  return e[code];
}

/** Pauses the customer's order `number` from `from` to `to` (calendar days, both included). */
export async function pauseMyOrder(_prev: PauseState, form: FormData): Promise<PauseState> {
  const locale = localeFrom(form.get("locale"));
  const t = getDictionary(locale);
  const p = t.account.pause;
  const number = text(form, "number");
  const from = text(form, "from");
  const to = text(form, "to");
  if (!isAccountEnabled) return { error: p.errors.failed };
  if (!NUMBER_RE.test(number)) return { error: p.errors.not_found };
  if (!isCalendarDay(from) || !isCalendarDay(to) || to < from) return { error: p.errors.bad_range };

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("pause_my_order", { p_number: Number(number), p_from: from, p_to: to });
  if (error) {
    // Refused for a reason that may be new since the page loaded (cutoff passed, staff changed the order): show it as
    // it is now.
    refresh();
    return { error: await errorText(locale, error, "pause_my_order") };
  }

  scheduleTelegramDrain();
  refresh();
  const range = formatPauseRange(from, to, t.order.monthNames);
  const end = endDateOf(data);
  return {
    ok: end
      ? p.saved.replace("{range}", range).replace("{date}", formatShortDay(end, t.order.monthNames))
      : p.savedNoDate.replace("{range}", range),
  };
}

/** Removes a pause the customer added that has not reached the cutoff: its days are delivered again. */
export async function cancelMyPause(_prev: PauseState, form: FormData): Promise<PauseState> {
  const locale = localeFrom(form.get("locale"));
  const t = getDictionary(locale);
  const p = t.account.pause;
  const id = text(form, "pause_id");
  if (!isAccountEnabled) return { error: p.errors.failed };
  if (!UUID_RE.test(id)) return { error: p.errors.not_found };

  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("cancel_my_pause", { p_id: id });
  if (error) {
    refresh();
    return { error: await errorText(locale, error, "cancel_my_pause") };
  }

  scheduleTelegramDrain();
  refresh();
  const end = endDateOf(data);
  return { ok: end ? p.removed.replace("{date}", formatShortDay(end, t.order.monthNames)) : p.removedNoDate };
}
