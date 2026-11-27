import { orderProgress, renewDue, type ProgressOrder } from "../src/lib/account/order-status";
import { daysBetween, deliveredDays, orderDayIndex, orderEndDate, tashkentToday } from "../src/lib/order/days";
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
