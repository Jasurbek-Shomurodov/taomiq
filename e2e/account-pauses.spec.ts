import { getDictionary } from "../src/i18n";
import { customerFirstPauseDay, formatPauseRange, formatShortDay } from "../src/lib/account/pauses";
import { orderEndDate, tashkentToday } from "../src/lib/order/days";
import { addDays, DEFAULT_CUTOFF_HOUR } from "../src/lib/order/rules";
import fixture from "./account-fixture.json";
import { SESSION_COOKIE, sessionCookie } from "./account-session";
import { expect, test } from "./fixtures";

/**
 * Pausing delivery days in the account (docs/plans/pause-and-skip-days.md, slice 3): the sheet on a running order, the
 * calendar from the first day the cutoff allows, the live preview of the new end, saving, the card's new end and
 * pause line, and removing the customer's own pause (not one staff set). Runs only in the `account` projects, against
 * the local Supabase mock, which keeps this session's pauses apart from every other suite's (session id "pause-...").
 */
const locale = "ru";
const t = getDictionary(locale);
const p = t.account.pause;
const months = t.order.monthNames;
const short = (iso: string) => formatShortDay(iso, months);

const order = fixture.progressOrders.find((o) => o.number === fixture.pauseOrder)!;
const STAFF_PAUSE_OFFSET = fixture.staffPauseOffsetDays;

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  // A session of its own per project and test: the mock's pauses for it start with the one staff pause only.
  const session = `pause-${testInfo.project.name}-${testInfo.title.length}-${Date.now()}`;
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionCookie(session), url: baseURL! }]);
});

test("a customer pauses a day of a running order, sees the new end, and removes the pause again", async ({ page }) => {
  const today = tashkentToday();
  const first = customerFirstPauseDay(new Date(), DEFAULT_CUTOFF_HOUR);
  const start = addDays(today, order.start_offset_days);
  const staffDay = addDays(today, STAFF_PAUSE_OFFSET);
  const staffPause = { from: staffDay, to: staffDay };
  const endBefore = orderEndDate(start, false, order.days, [staffPause])!;
  const endAfter = orderEndDate(start, false, order.days, [staffPause, { from: first, to: first }])!;

  await page.goto(`/${locale}/account`);
  const card = page.getByRole("listitem").filter({ hasText: t.account.orderNumber.replace("{n}", String(order.number)) });
  await expect(card.locator("[data-order-pauses]")).toHaveText(p.cardLine.replace("{ranges}", short(staffDay)));
  await expect(card.locator("[data-order-progress]")).toContainText(short(endBefore));
  // A completed order has nothing to pause.
  const done = page.getByRole("listitem").filter({ hasText: t.account.orderNumber.replace("{n}", "873572") });
  await expect(done.getByRole("button", { name: p.open })).toHaveCount(0);

  await card.getByRole("button", { name: p.open }).click();
  const sheet = page.getByRole("dialog", { name: p.title });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-pause-rule]")).toHaveText(
    p.rule.replace("{hour}", String(DEFAULT_CUTOFF_HOUR)).replace("{date}", short(first)),
  );

  // The calendar starts on the first allowed day: today (and tomorrow after the cutoff) cannot be picked.
  await expect(sheet.locator(`button[data-day="${today}"]`)).toHaveCount(0);
  await expect(sheet.locator(`button[data-day="${first}"]`)).toBeVisible();
  // The staff pause: struck through in the calendar, listed as theirs, with no Remove.
  await expect(sheet.locator(`span[data-day="${staffDay}"]`)).toHaveClass(/line-through/);
  const staffRow = sheet.locator("[data-pause-row]").filter({ hasText: short(staffDay) });
  await expect(staffRow).toContainText(p.byStaff);
  await expect(staffRow.getByRole("button")).toHaveCount(0);

  // Nothing picked yet: nothing to confirm.
  const confirm = sheet.getByRole("button", { name: p.confirm });
  await expect(confirm).toBeDisabled();
  await sheet.locator(`button[data-day="${first}"]`).click();
  await expect(sheet.locator(`button[data-day="${first}"]`)).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.locator("[data-pause-preview]")).toContainText(
    p.endsInstead.replace("{end}", short(endAfter)).replace("{was}", short(endBefore)),
  );
  await confirm.click();

  const range = formatPauseRange(first, first, months);
  await expect(sheet.locator("[data-pause-result]")).toHaveText(p.savedNoDate.replace("{range}", range));
  const mine = sheet.locator("[data-pause-row]").filter({ hasText: range }).filter({ hasNotText: p.byStaff });
  await expect(mine.getByRole("button", { name: `${p.remove}: ${range}` })).toBeVisible();
  // The card behind the sheet: the new end and both pauses.
  await expect(card.locator("[data-order-progress]")).toContainText(short(endAfter));
  await expect(card.locator("[data-order-pauses]")).toHaveText(
    p.cardLine.replace("{ranges}", [first, staffDay].sort().map(short).join(", ")),
  );

  await mine.getByRole("button", { name: `${p.remove}: ${range}` }).click();
  await expect(sheet.locator("[data-pause-result]")).toHaveText(p.removedNoDate);
  await expect(mine).toHaveCount(0);
  await expect(card.locator("[data-order-progress]")).toContainText(short(endBefore));

  // Escape closes the sheet.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("with customer sign-in on, 'included' says pauses are made in the account", async ({ page }) => {
  await page.goto(`/${locale}`);
  await expect(page.getByText(t.included.pause.replace("{hour}", String(DEFAULT_CUTOFF_HOUR)), { exact: true })).toBeVisible();
});
