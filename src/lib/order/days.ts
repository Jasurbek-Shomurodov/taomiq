import { addDays, isWeekend } from "./rules";

/**
 * An order's delivery days, in TypeScript for the customer's account page. Mirrors, rule for rule, the database's
 * private.order_day_index (0009) and private.order_end_date (0020), which the kitchen and delivery sheets and the
 * back office use; e2e/order-days.spec.ts checks the same cases. Pauses do not exist yet (round 2, item 4): when they
 * do, they are read there, and this file must follow.
 * Dates are ISO strings (YYYY-MM-DD) in Tashkent time.
 */

const TASHKENT_OFFSET_MS = 5 * 3_600_000;

/** Today's date in Tashkent (UTC+5 all year, no daylight saving). */
export function tashkentToday(now: Date = new Date()): string {
  return new Date(now.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Which delivery day of an order `date` is: 1 on the start date, counting calendar days, or weekdays only for a
 * weekdays-only order. Null before the start, and on a Saturday or Sunday of a weekdays-only order. Does not look at
 * the order's length (as private.order_day_index).
 */
export function orderDayIndex(start: string, weekdaysOnly: boolean, date: string): number | null {
  if (date < start) return null;
  if (!weekdaysOnly) return daysBetween(start, date) + 1;
  if (isWeekend(date)) return null;
  let count = 0;
  for (let d = start; d <= date; d = addDays(d, 1)) if (!isWeekend(d)) count++;
  return count;
}

/** The last delivery day: the day whose index is `days` (as private.order_end_date). Null for a length under 1. */
export function orderEndDate(start: string, weekdaysOnly: boolean, days: number): string | null {
  if (!Number.isInteger(days) || days < 1) return null;
  if (!weekdaysOnly) return addDays(start, days - 1);
  // n weekdays span at most 1.4 n + 7 calendar days (the bound of the database functions).
  const last = addDays(start, days * 2 + 7);
  for (let d = start; d <= last; d = addDays(d, 1)) if (orderDayIndex(start, true, d) === days) return d;
  return null;
}

/** How many of the order's deliveries fall on or before `today` (0 before the start, `days` after the end). */
export function deliveredDays(start: string, weekdaysOnly: boolean, days: number, today: string): number {
  if (today < start) return 0;
  const end = orderEndDate(start, weekdaysOnly, days);
  if (end && today >= end) return days;
  let count = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) if (!weekdaysOnly || !isWeekend(d)) count++;
  return Math.min(count, days);
}
