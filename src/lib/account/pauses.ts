import type { OrderStatus } from "@/lib/admin/orders";
import { canPause, previewPauseFrom, type PauseCheck } from "@/lib/admin/pauses";
import { orderEndDate, type DayRange } from "@/lib/order/days";
import { startDateRange } from "@/lib/order/rules";

/*
 * A customer's own pauses in the account (migration 0029; docs/plans/pause-and-skip-days.md, slice 3). Pure and not
 * server-only: the account's pause sheet previews with them, e2e/order-days.spec.ts checks them, and the database has
 * the final word (public.pause_my_order / cancel_my_pause, same rules and error names).
 */

/** A pause of one of the customer's orders, as public.my_order_pauses_v2() returns it (0029). */
export type CustomerPause = DayRange & {
  /** Null when only the older my_order_pauses() (0028) could be read: then nothing can be removed. */
  id: string | null;
  source: "staff" | "customer";
};

/**
 * The first day a customer may pause, and the first day of a pause they may still remove: the earliest start date of
 * a new order placed now (tomorrow in Tashkent before the order cutoff hour, the day after from then). The rule of
 * private.customer_pause_first_day (0029) and of submit_order's start date.
 */
export function customerFirstPauseDay(now: Date, cutoffHour: number): string {
  return startDateRange(now, cutoffHour).earliest;
}

/** The order can take a pause from the customer: confirmed, paid or delivering, as for staff. */
export function customerCanPause(status: OrderStatus): boolean {
  return canPause(status);
}

/** A pause the customer added themselves that starts on or after the first allowed day: "Remove" is offered. */
export function customerCanRemove(pause: CustomerPause, firstDay: string): boolean {
  return pause.id !== null && pause.source === "customer" && pause.from >= firstDay;
}

type Schedule = { status: OrderStatus; start_date: string; weekdays_only: boolean; days: number };

/**
 * There is something to pause: the order delivers on the first allowed day or later. Without pauses read (null) the
 * sheet is not offered, since its end dates would be wrong.
 */
export function hasDaysToPause(order: Schedule, pauses: readonly DayRange[] | null, firstDay: string): boolean {
  if (pauses === null || !customerCanPause(order.status)) return false;
  const end = orderEndDate(order.start_date, order.weekdays_only, order.days, pauses);
  return end !== null && end >= firstDay;
}

/** What pausing from..to would do, or why it cannot be done: pause_my_order's checks, in the same order. */
export function previewCustomerPause(
  order: Schedule,
  pauses: readonly DayRange[],
  from: string,
  to: string,
  firstDay: string,
  max: number,
): PauseCheck {
  return previewPauseFrom(order, pauses, from, to, firstDay, max);
}

/** "9 dek" from "2026-12-09", with the dictionary's short month names (as the account's status line). */
export function formatShortDay(iso: string, monthNames: readonly string[]): string {
  return `${Number(iso.slice(8, 10))} ${monthNames[Number(iso.slice(5, 7)) - 1]}`;
}

/** "3 dek", "3–5 dek" or "30 noy – 2 dek". */
export function formatPauseRange(from: string, to: string, monthNames: readonly string[]): string {
  if (from === to) return formatShortDay(from, monthNames);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8, 10))}–${formatShortDay(to, monthNames)}`;
  return `${formatShortDay(from, monthNames)} – ${formatShortDay(to, monthNames)}`;
}

export const CUSTOMER_PAUSE_ERRORS = [
  "bad_range",
  "pause_too_soon",
  "not_pausable",
  "no_delivery_days",
  "pause_limit",
  "too_many_changes",
  "staff_pause",
  "already_cancelled",
  "pause_locked",
  "not_found",
  "not_allowed",
] as const;
export type CustomerPauseError = (typeof CUSTOMER_PAUSE_ERRORS)[number];

/** The error name in a database message, if it is one of the customer pause functions' own (0029). */
export function customerPauseErrorOf(message: string): CustomerPauseError | null {
  return CUSTOMER_PAUSE_ERRORS.find((code) => message.includes(code)) ?? null;
}
