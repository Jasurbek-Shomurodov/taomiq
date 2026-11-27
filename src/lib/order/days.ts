import { addDays, isWeekend } from "./rules";

/**
 * An order's delivery days, in TypeScript for the customer's account page and the back office's pause picker. Mirrors,
 * rule for rule, the database's private.order_day_index (0009) and private.order_end_date (0020), and with pauses their
 * paused versions private.order_day_index_paused, order_end_date_paused and order_skipped_days (0028), which the
 * kitchen and delivery sheets, the customers screens and the reports use; e2e/order-days.spec.ts checks the same cases.
 * Dates are ISO strings (YYYY-MM-DD) in Tashkent time.
 */

const TASHKENT_OFFSET_MS = 5 * 3_600_000;

/**
 * A paused range of an order (public.order_pauses, 0028): calendar days from `from` to `to`, both included. Only active
 * (not cancelled) pauses are passed in. Ranges may overlap: a day is paused when any range covers it.
 */
export type DayRange = { from: string; to: string };

const NO_PAUSES: readonly DayRange[] = [];

/** Today's date in Tashkent (UTC+5 all year, no daylight saving). */
export function tashkentToday(now: Date = new Date()): string {
  return new Date(now.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `date` is inside one of the ranges. */
export function isPausedDay(pauses: readonly DayRange[], date: string): boolean {
  return pauses.some((pause) => pause.from <= date && date <= pause.to);
}

/** The calendar days the ranges cover, overlaps counted twice (private.order_pause_span): only widens a search bound. */
function pauseSpan(pauses: readonly DayRange[]): number {
  return pauses.reduce((sum, pause) => sum + Math.max(0, daysBetween(pause.from, pause.to) + 1), 0);
}

/** A day the schedule delivers on before pauses: every day, or Monday to Friday for a weekdays-only order. */
function scheduleDay(weekdaysOnly: boolean, date: string): boolean {
  return !weekdaysOnly || !isWeekend(date);
}

/**
 * Which delivery day of an order `date` is: 1 on the start date, counting calendar days, or weekdays only for a
 * weekdays-only order, and skipping paused days. Null before the start, on a Saturday or Sunday of a weekdays-only
 * order and on a paused day. Does not look at the order's length (as private.order_day_index_paused).
 */
export function orderDayIndex(
  start: string,
  weekdaysOnly: boolean,
  date: string,
  pauses: readonly DayRange[] = NO_PAUSES,
): number | null {
  if (date < start) return null;
  if (!scheduleDay(weekdaysOnly, date)) return null;
  if (!weekdaysOnly && pauses.length === 0) return daysBetween(start, date) + 1;
  if (isPausedDay(pauses, date)) return null;
  let count = 0;
  for (let d = start; d <= date; d = addDays(d, 1)) if (scheduleDay(weekdaysOnly, d) && !isPausedDay(pauses, d)) count++;
  return count;
}

/**
 * The last delivery day: the day whose index is `days` (as private.order_end_date, and with pauses
 * private.order_end_date_paused). Null for a length under 1.
 */
export function orderEndDate(
  start: string,
  weekdaysOnly: boolean,
  days: number,
  pauses: readonly DayRange[] = NO_PAUSES,
): string | null {
  if (!Number.isInteger(days) || days < 1) return null;
  if (!weekdaysOnly && pauses.length === 0) return addDays(start, days - 1);
  // n delivery days plus k paused ones span at most 1.4 (n + k) + 7 calendar days (the bound of the database functions).
  const last = addDays(start, (days + pauseSpan(pauses)) * 2 + 7);
  let count = 0;
  for (let d = start; d <= last; d = addDays(d, 1)) {
    if (!scheduleDay(weekdaysOnly, d) || isPausedDay(pauses, d)) continue;
    count++;
    if (count === days) return d;
  }
  return null;
}

/**
 * The delivery days the pauses moved later (private.order_skipped_days): the schedule's days from the start through the
 * paused end, minus the order's length. 0 without pauses, and for pauses before the start or after the end.
 */
export function skippedDays(start: string, weekdaysOnly: boolean, days: number, pauses: readonly DayRange[]): number {
  const end = orderEndDate(start, weekdaysOnly, days, pauses);
  if (!end) return 0;
  return (orderDayIndex(start, weekdaysOnly, end) ?? days) - days;
}

/** Every delivery day of the order, first to last, in order (`days` dates; none for a length under 1). */
export function orderDeliveryDays(
  start: string,
  weekdaysOnly: boolean,
  days: number,
  pauses: readonly DayRange[] = NO_PAUSES,
): string[] {
  const end = orderEndDate(start, weekdaysOnly, days, pauses);
  if (!end) return [];
  const result: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (scheduleDay(weekdaysOnly, d) && !isPausedDay(pauses, d)) result.push(d);
  }
  return result;
}

/** How many of the order's deliveries fall on or before `today` (0 before the start, `days` after the end). */
export function deliveredDays(
  start: string,
  weekdaysOnly: boolean,
  days: number,
  today: string,
  pauses: readonly DayRange[] = NO_PAUSES,
): number {
  if (today < start) return 0;
  const end = orderEndDate(start, weekdaysOnly, days, pauses);
  if (end && today >= end) return days;
  let count = 0;
  for (let d = start; d <= today; d = addDays(d, 1)) if (scheduleDay(weekdaysOnly, d) && !isPausedDay(pauses, d)) count++;
  return Math.min(count, days);
}
