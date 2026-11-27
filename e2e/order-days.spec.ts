import { orderProgress, renewDue, type ProgressOrder } from "../src/lib/account/order-status";
import { canCancelPause, parsePauseMax, previewPause } from "../src/lib/admin/pauses";
import {
  daysBetween,
  deliveredDays,
  orderDayIndex,
  orderDeliveryDays,
  orderEndDate,
  skippedDays,
  tashkentToday,
} from "../src/lib/order/days";
import { expect, test } from "./fixtures";

/**
 * The TypeScript copy of the database's delivery-day rules (src/lib/order/days.ts ↔ private.order_day_index, 0009, and
 * private.order_end_date, 0020) and the account's status line made from them. No page: plain function checks, like the
 * calculator maths in smoke.spec.ts. The cases below were worked out on a calendar (Mon 30 Nov 2026 is a Monday).
 */
test("delivery days: every day and weekdays-only orders, as the database counts them", () => {
  // Every day: day n is start + n - 1.
  expect(orderEndDate("2026-12-01", false, 7)).toBe("2026-12-07");
  expect(orderDayIndex("2026-12-01", false, "2026-12-03")).toBe(3);
  expect(orderDayIndex("2026-12-01", false, "2026-11-30")).toBeNull();
  expect(orderEndDate("2026-12-01", false, 1)).toBe("2026-12-01");
  expect(orderEndDate("2026-12-01", false, 0)).toBeNull();

  // Weekdays only, from Monday 30 Nov: Mon–Fri, then Mon 7 and Tue 8 Dec.
  expect(orderEndDate("2026-11-30", true, 7)).toBe("2026-12-08");
  expect(orderDayIndex("2026-11-30", true, "2026-12-04")).toBe(5);
  expect(orderDayIndex("2026-11-30", true, "2026-12-05")).toBeNull(); // Saturday: no delivery
  expect(orderDayIndex("2026-11-30", true, "2026-12-07")).toBe(6);
  expect(deliveredDays("2026-11-30", true, 7, "2026-12-06")).toBe(5); // Sunday: five delivered so far
  // From a Wednesday, ten weekdays end on the Tuesday two weeks later; one day from a Friday is that Friday.
  expect(orderEndDate("2026-12-02", true, 10)).toBe("2026-12-15");
  expect(orderEndDate("2026-12-04", true, 1)).toBe("2026-12-04");

  // Delivered so far: none before the start, never more than the order's length.
  expect(deliveredDays("2026-12-01", false, 7, "2026-11-30")).toBe(0);
  expect(deliveredDays("2026-12-01", false, 7, "2026-12-01")).toBe(1);
  expect(deliveredDays("2026-12-01", false, 7, "2027-01-15")).toBe(7);

  // Tashkent is UTC+5: 19:00 UTC is already the next day there.
  expect(tashkentToday(new Date("2026-11-28T18:59:00Z"))).toBe("2026-11-28");
  expect(tashkentToday(new Date("2026-11-28T19:00:00Z"))).toBe("2026-11-29");
  expect(daysBetween("2026-11-28", "2026-12-01")).toBe(3);
});

test("account status line: starts, day n of N, ended; Renew only in the last two days", () => {
  const order = (status: ProgressOrder["status"], start_date: string, days = 7, weekdays_only = false) => ({
    status,
    start_date,
    days,
    weekdays_only,
  });

  expect(orderProgress(order("confirmed", "2026-12-03"), "2026-11-28")).toEqual({ kind: "starts", date: "2026-12-03" });
  expect(orderProgress(order("new", "2026-12-03"), "2026-11-28")).toEqual({ kind: "starts", date: "2026-12-03" });
  // A new order whose start passed before anyone confirmed it: its dates are not true any more.
  expect(orderProgress(order("new", "2026-11-25"), "2026-11-28")).toBeNull();
  expect(orderProgress(order("cancelled", "2026-12-03"), "2026-11-28")).toBeNull();

  const running = orderProgress(order("active", "2026-12-01"), "2026-12-03");
  expect(running).toEqual({ kind: "running", day: 3, days: 7, end: "2026-12-07" });
  expect(renewDue(running, "2026-12-03")).toBe(false); // four days left
  expect(renewDue(orderProgress(order("active", "2026-12-01"), "2026-12-05"), "2026-12-05")).toBe(true);
  expect(renewDue(orderProgress(order("paid", "2026-12-01"), "2026-12-07"), "2026-12-07")).toBe(true); // last day

  // Weekdays only, on the Saturday after day 5 of 7: still running, five delivered, ends Tuesday 8 Dec.
  expect(orderProgress(order("active", "2026-11-30", 7, true), "2026-12-05")).toEqual({
    kind: "running",
    day: 5,
    days: 7,
    end: "2026-12-08",
  });

  expect(orderProgress(order("active", "2026-12-01"), "2026-12-08")).toEqual({ kind: "ended", date: "2026-12-07" });
  expect(orderProgress(order("completed", "2026-12-01"), "2026-12-08")).toEqual({ kind: "ended", date: "2026-12-07" });
  // Completed early by staff: no end date in the future is shown as "ended".
  expect(orderProgress(order("completed", "2026-12-01"), "2026-12-03")).toBeNull();
  expect(renewDue(orderProgress(order("active", "2026-12-01"), "2026-12-08"), "2026-12-08")).toBe(false);
  expect(renewDue(orderProgress(order("confirmed", "2026-11-29", 2), "2026-11-28"), "2026-11-28")).toBe(false);
});

/**
 * Pauses (migration 0028): the TypeScript copy of private.order_day_index_paused, order_end_date_paused and
 * order_skipped_days, and the staff picker's checks (src/lib/admin/pauses.ts ↔ public.staff_pause_order). The same
 * cases were run against the SQL functions on a local Postgres.
 */
test("delivery days with pauses: weekends, overlapping pauses, pauses outside the order", () => {
  // Weekdays only, 7 days from Mon 30 Nov, paused Wed 2 – Thu 3 Dec and (overlapping) Thu 3 – Mon 7 Dec:
  // Mon 30, Tue 1, then Tue 8, Wed 9, Thu 10, Fri 11, Mon 14. Four delivery days moved; the weekend inside does not count.
  const pauses = [
    { from: "2026-12-02", to: "2026-12-03" },
    { from: "2026-12-03", to: "2026-12-07" },
  ];
  expect(orderDayIndex("2026-11-30", true, "2026-12-01", pauses)).toBe(2);
  expect(orderDayIndex("2026-11-30", true, "2026-12-03", pauses)).toBeNull(); // paused
  expect(orderDayIndex("2026-11-30", true, "2026-12-05", pauses)).toBeNull(); // Saturday
  expect(orderDayIndex("2026-11-30", true, "2026-12-08", pauses)).toBe(3);
  expect(orderDayIndex("2026-11-30", true, "2026-12-14", pauses)).toBe(7);
  expect(orderEndDate("2026-11-30", true, 7, pauses)).toBe("2026-12-14");
  expect(skippedDays("2026-11-30", true, 7, pauses)).toBe(4);
  expect(deliveredDays("2026-11-30", true, 7, "2026-12-09", pauses)).toBe(4);
  expect(orderDeliveryDays("2026-11-30", true, 7, pauses)).toEqual([
    "2026-11-30",
    "2026-12-01",
    "2026-12-08",
    "2026-12-09",
    "2026-12-10",
    "2026-12-11",
    "2026-12-14",
  ]);

  // Every day, 20 days from 1 Mar 2027 (ends 20 Mar); 5–7 Mar and 6–9 Mar paused: 5 days moved, ends 25 Mar.
  const every = [
    { from: "2027-03-05", to: "2027-03-07" },
    { from: "2027-03-06", to: "2027-03-09" },
  ];
  expect(orderEndDate("2027-03-01", false, 20, every)).toBe("2027-03-25");
  expect(skippedDays("2027-03-01", false, 20, every)).toBe(5);
  expect(orderDayIndex("2027-03-01", false, "2027-03-10", every)).toBe(5);

  // A pause before the start or after the end moves nothing; one on the start moves the first delivery.
  expect(orderEndDate("2026-12-01", false, 7, [{ from: "2026-11-25", to: "2026-11-28" }])).toBe("2026-12-07");
  expect(skippedDays("2026-12-01", false, 7, [{ from: "2026-12-20", to: "2026-12-22" }])).toBe(0);
  expect(orderDayIndex("2026-12-01", false, "2026-12-03", [{ from: "2026-12-01", to: "2026-12-02" }])).toBe(1);
  expect(orderEndDate("2026-12-01", false, 7, [{ from: "2026-12-01", to: "2026-12-02" }])).toBe("2026-12-09");
  // A weekend-only pause of a weekdays-only order moves nothing.
  expect(skippedDays("2026-11-30", true, 7, [{ from: "2026-12-05", to: "2026-12-06" }])).toBe(0);
  // No pauses: the same answers as before.
  expect(orderEndDate("2026-11-30", true, 7, [])).toBe("2026-12-08");
  expect(skippedDays("2026-11-30", true, 7, [])).toBe(0);
});

test("pause picker checks: past, nothing to pause, the cap of paused delivery days, status", () => {
  const order = { status: "active" as const, start_date: "2027-03-01", weekdays_only: false, days: 20 };
  const today = "2027-03-02";
  const existing = [
    { from: "2027-03-05", to: "2027-03-07" },
    { from: "2027-03-06", to: "2027-03-09" },
  ];

  const ok = previewPause(order, [], "2027-03-05", "2027-03-07", today, 30);
  expect(ok).toEqual({ ok: true, preview: { endBefore: "2027-03-20", endAfter: "2027-03-23", skipped: 3, added: 3 } });

  // Five moved already: 25 more reach the cap of 30 exactly, 26 go over it.
  const full = previewPause(order, existing, "2027-03-10", "2027-04-03", today, 30);
  expect(full.ok).toBe(true);
  expect(full.preview?.skipped).toBe(30);
  expect(full.preview?.endAfter).toBe("2027-04-19");
  const over = previewPause(order, existing, "2027-03-10", "2027-04-04", today, 30);
  expect(over).toMatchObject({ ok: false, error: "pause_limit" });
  // A lower cap from the settings.
  expect(previewPause(order, existing, "2027-03-12", "2027-03-14", today, 7)).toMatchObject({ ok: false, error: "pause_limit" });
  expect(previewPause(order, existing, "2027-03-12", "2027-03-13", today, 7).ok).toBe(true);

  // Only days already paused, or after the end: nothing to pause.
  expect(previewPause(order, existing, "2027-03-06", "2027-03-08", today, 30)).toMatchObject({ ok: false, error: "no_delivery_days" });
  expect(previewPause(order, existing, "2027-03-26", "2027-03-28", today, 30)).toMatchObject({ ok: false, error: "no_delivery_days" });
  // Weekends of a weekdays-only order are not delivery days.
  const weekdays = { status: "paid" as const, start_date: "2026-11-30", weekdays_only: true, days: 7 };
  expect(previewPause(weekdays, [], "2026-12-05", "2026-12-06", "2026-11-28", 30)).toMatchObject({ ok: false, error: "no_delivery_days" });

  // Tomorrow at the earliest: today and the past are too soon (every pause can still be removed before it starts).
  expect(previewPause(order, [], "2027-03-01", "2027-03-03", today, 30)).toMatchObject({ ok: false, error: "pause_too_soon" });
  expect(previewPause(order, [], today, "2027-03-03", today, 30)).toMatchObject({ ok: false, error: "pause_too_soon" });
  expect(previewPause(order, [], "2027-03-03", "2027-03-03", today, 30).ok).toBe(true);
  expect(previewPause(order, [], "2027-03-05", "2027-03-04", today, 30)).toMatchObject({ ok: false, error: "bad_range" });
  expect(previewPause(order, [], "2027-03-05", "2027-06-06", today, 300)).toMatchObject({ ok: false, error: "bad_range" });
  expect(previewPause({ ...order, status: "completed" }, [], "2027-03-05", "2027-03-07", today, 30)).toMatchObject({
    ok: false,
    error: "not_pausable",
  });

  // Removing: only a pause that has not started; the setting's value, else 30.
  const pause = { id: "x", from_date: "2027-03-05", to_date: "2027-03-07", source: "staff" as const, created_at: "", cancelled_at: null };
  expect(canCancelPause(pause, "2027-03-04")).toBe(true);
  expect(canCancelPause(pause, "2027-03-05")).toBe(false);
  expect(canCancelPause({ ...pause, cancelled_at: "2027-03-01T00:00:00Z" }, "2027-03-01")).toBe(false);
  // The setting: a JSON number, floored, kept when 1..366 (private.pause_max_days); else 30.
  expect(parsePauseMax(10)).toBe(10);
  expect(parsePauseMax(JSON.parse("10.0"))).toBe(10);
  expect(parsePauseMax(10.9)).toBe(10);
  expect(parsePauseMax(366)).toBe(366);
  expect(parsePauseMax(367)).toBe(30);
  expect(parsePauseMax(0)).toBe(30);
  expect(parsePauseMax("10")).toBe(30);
  expect(parsePauseMax(undefined)).toBe(30);
});

test("account status line with pauses: later end, paused start, Renew from the paused end, unknown pauses", () => {
  const base = { status: "active" as const, start_date: "2026-12-01", days: 7, weekdays_only: false };
  // Every day from Tue 1 Dec, 3–4 Dec paused: ends Wed 9 Dec instead of Mon 7 Dec.
  const paused = { ...base, pauses: [{ from: "2026-12-03", to: "2026-12-04" }] };
  expect(orderProgress(paused, "2026-12-05")).toEqual({ kind: "running", day: 3, days: 7, end: "2026-12-09" });
  // On a paused day: still running, two delivered so far.
  expect(orderProgress(paused, "2026-12-04")).toEqual({ kind: "running", day: 2, days: 7, end: "2026-12-09" });
  // Renew follows the paused end: not yet on 6 Dec (three days left), yes on 7 Dec.
  expect(renewDue(orderProgress(paused, "2026-12-06"), "2026-12-06")).toBe(false);
  expect(renewDue(orderProgress(paused, "2026-12-07"), "2026-12-07")).toBe(true);
  expect(orderProgress(paused, "2026-12-08")).toMatchObject({ kind: "running", end: "2026-12-09" });
  expect(orderProgress(paused, "2026-12-10")).toEqual({ kind: "ended", date: "2026-12-09" });
  // A pause on the start moves the first delivery.
  const late = { ...base, status: "paid" as const, pauses: [{ from: "2026-12-01", to: "2026-12-02" }] };
  expect(orderProgress(late, "2026-11-28")).toEqual({ kind: "starts", date: "2026-12-03" });
  expect(orderProgress(late, "2026-12-02")).toEqual({ kind: "starts", date: "2026-12-03" });
  // Pauses that could not be read: no line rather than a wrong date. No pauses: as before.
  expect(orderProgress({ ...base, pauses: null }, "2026-12-05")).toBeNull();
  expect(orderProgress({ ...base, pauses: [] }, "2026-12-03")).toEqual({ kind: "running", day: 3, days: 7, end: "2026-12-07" });
});
