import { daysBetween, orderDayIndex, orderEndDate, skippedDays, type DayRange } from "@/lib/order/days";
import { addDays } from "@/lib/order/rules";
import type { Order, OrderStatus } from "./orders";

/*
 * Paused delivery days of an order (public.order_pauses, migration 0028; docs/plans/pause-and-skip-days.md, slice 2).
 * Pure and not server-only: the order page's pause picker previews with them, and the actions check again before the
 * database, which has the final word (public.staff_pause_order / staff_cancel_pause, same rules and error names).
 */

/** The cap of paused delivery days per order when the settings hold no pause_max_days (private.pause_max_days). */
export const PAUSE_MAX_DAYS_DEFAULT = 30;
export const PAUSE_MAX_DAYS_KEY = "pause_max_days";
/** One pause spans at most this many calendar days (staff_pause_order: to - from <= 92). */
export const PAUSE_RANGE_MAX_DAYS = 93;

export type OrderPause = {
  id: string;
  from_date: string;
  to_date: string;
  source: "staff" | "customer";
  created_at: string;
  cancelled_at: string | null;
};

/** Pauses can be added or cancelled while the order is confirmed, paid or delivering. */
export function canPause(status: OrderStatus): boolean {
  return status === "confirmed" || status === "paid" || status === "active";
}

/** The pauses still in force, as day ranges for the day maths. */
export function activeRanges(pauses: readonly OrderPause[]): DayRange[] {
  return pauses.filter((pause) => !pause.cancelled_at).map((pause) => ({ from: pause.from_date, to: pause.to_date }));
}

/** An active pause that starts after `today` can be removed (its days come back). One that started stays. */
export function canCancelPause(pause: OrderPause, today: string): boolean {
  return !pause.cancelled_at && pause.from_date > today;
}

/**
 * The setting's value: a JSON number, floored (10 and 10.0 mean 10), kept when 1..366; else the default. The rule of
 * private.pause_max_days.
 */
export function parsePauseMax(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return PAUSE_MAX_DAYS_DEFAULT;
  const days = Math.floor(value);
  return days >= 1 && days <= 366 ? days : PAUSE_MAX_DAYS_DEFAULT;
}

/** The first day a pause may start: tomorrow (Tashkent), so every pause can still be removed before it starts. */
export function firstPauseDay(today: string): string {
  return addDays(today, 1);
}

export const PAUSE_ERRORS = [
  "bad_range",
  "pause_too_soon",
  "not_pausable",
  "no_delivery_days",
  "pause_limit",
  "already_cancelled",
  "pause_started",
  "not_found",
] as const;
export type PauseError = (typeof PAUSE_ERRORS)[number];

/** The error name in a database message, if it is one of the pause functions' own. */
export function pauseErrorOf(message: string): PauseError | null {
  return PAUSE_ERRORS.find((code) => message.includes(code)) ?? null;
}

type Schedule = Pick<Order, "status" | "start_date" | "weekdays_only" | "days">;

export type PausePreview = {
  /** The last delivery day before and after the new pause. */
  endBefore: string | null;
  endAfter: string | null;
  /** Delivery days skipped in all, with the new pause. */
  skipped: number;
  /** Delivery days this pause adds (not already paused, inside the order's days). */
  added: number;
};

/**
 * What adding the pause from..to would do, or why it cannot be added: the checks of staff_pause_order in the same
 * order. `pauses` are the order's active ranges.
 */
export function previewPause(
  order: Schedule,
  pauses: readonly DayRange[],
  from: string,
  to: string,
  today: string,
  max: number,
): { ok: true; preview: PausePreview } | { ok: false; error: PauseError; preview?: PausePreview } {
  if (!from || !to || to < from || daysBetween(from, to) >= PAUSE_RANGE_MAX_DAYS) return { ok: false, error: "bad_range" };
  if (from < firstPauseDay(today)) return { ok: false, error: "pause_too_soon" };
  if (!canPause(order.status)) return { ok: false, error: "not_pausable" };

  const endBefore = orderEndDate(order.start_date, order.weekdays_only, order.days, pauses);
  const after = [...pauses, { from, to }];
  const endAfter = orderEndDate(order.start_date, order.weekdays_only, order.days, after);
  const before = skippedDays(order.start_date, order.weekdays_only, order.days, pauses);
  const skipped = skippedDays(order.start_date, order.weekdays_only, order.days, after);
  const preview = { endBefore, endAfter, skipped, added: skipped - before };

  // At least one day of the range is a delivery day now (staff_pause_order's no_delivery_days).
  let delivers = false;
  for (let d = from; d <= to && !delivers; d = addDays(d, 1)) {
    const index = orderDayIndex(order.start_date, order.weekdays_only, d, pauses);
    delivers = index !== null && index >= 1 && index <= order.days;
  }
  if (!delivers) return { ok: false, error: "no_delivery_days", preview };
  if (skipped > max) return { ok: false, error: "pause_limit", preview };
  return { ok: true, preview };
}

