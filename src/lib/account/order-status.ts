import type { OrderStatus } from "@/lib/admin/orders";
import { daysBetween, deliveredDays, orderEndDate } from "@/lib/order/days";

/**
 * The plain status line of an order on the customer's account page, from the fields public.my_orders() already
 * returns (no migration): "Starts 3 Dec", "Day 3 of 7 · ends 9 Dec", "Ended 5 Dec". Plain module (no server-only):
 * e2e/order-days.spec.ts checks it directly.
 */
export type OrderProgress =
  | { kind: "starts"; date: string }
  | { kind: "running"; day: number; days: number; end: string }
  | { kind: "ended"; date: string };

/** The fields the line is made from. */
export type ProgressOrder = {
  status: OrderStatus;
  start_date: string;
  days: number;
  weekdays_only: boolean;
};

/** An order whose last delivery is this many days away or fewer gets the Renew button. */
export const RENEW_WITHIN_DAYS = 2;

/** Statuses whose deliveries go ahead as planned (the kitchen sheet's rule, 0009). */
const DELIVERING: readonly OrderStatus[] = ["confirmed", "paid", "active"];

/**
 * Null when the dates say nothing true: a cancelled order, a new (unconfirmed) order whose start has passed (the
 * manager sets the dates when confirming), or a completed one whose end is still ahead (closed early by staff).
 */
export function orderProgress(order: ProgressOrder, today: string): OrderProgress | null {
  const { status, start_date: start, days, weekdays_only: weekdaysOnly } = order;
  if (status === "cancelled") return null;
  const end = orderEndDate(start, weekdaysOnly, days);
  if (!end) return null;
  if (status === "completed") return today > end ? { kind: "ended", date: end } : null;
  if (today < start) return { kind: "starts", date: start };
  if (!DELIVERING.includes(status)) return null;
  if (today > end) return { kind: "ended", date: end };
  return { kind: "running", day: Math.max(1, deliveredDays(start, weekdaysOnly, days, today)), days, end };
}

/** A running order whose last delivery is at most RENEW_WITHIN_DAYS away: time to offer the next one. */
export function renewDue(progress: OrderProgress | null, today: string): boolean {
  return progress?.kind === "running" && daysBetween(today, progress.end) <= RENEW_WITHIN_DAYS;
}
