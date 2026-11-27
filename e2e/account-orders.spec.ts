import { getDictionary } from "../src/i18n";
import { orderProgress, renewDue, type ProgressOrder } from "../src/lib/account/order-status";
import { addDays } from "../src/lib/order/rules";
import { tashkentToday } from "../src/lib/order/days";
import fixture from "./account-fixture.json";
import { SESSION_COOKIE, sessionCookie } from "./account-session";
import { expect, test } from "./fixtures";

/**
 * The account's order cards: a plain status line from the order's own dates, and a gold Renew button on an order
 * that ends within two days (docs/plans/customer-site-round-2.md, item 11). Runs only in the `account` projects,
 * against the local Supabase mock, whose progressOrders start relative to today (account-fixture.json).
 */
const locale = "ru";
const t = getDictionary(locale);
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${t.order.monthNames[Number(iso.slice(5, 7)) - 1]}`;

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionCookie(), url: baseURL! }]);
});

test("order cards say where each order stands, and offer Renew only near the end", async ({ page }) => {
  const today = tashkentToday();
  await page.goto(`/${locale}/account`);

  for (const order of fixture.progressOrders) {
    const card = page.getByRole("listitem").filter({
      hasText: t.account.orderNumber.replace("{n}", String(order.number)),
    });
    await expect(card).toBeVisible();
    const start = addDays(today, order.start_offset_days);
    const progress = orderProgress({ ...order, status: order.status as ProgressOrder["status"], start_date: start }, today);
    expect(progress, `order ${order.number}`).not.toBeNull();

    let line = "";
    if (progress!.kind === "starts") line = t.account.progressStarts.replace("{date}", short(progress!.date));
    else if (progress!.kind === "ended") line = t.account.progressEnded.replace("{date}", short(progress!.date));
    else {
      line = t.account.progressRunning
        .replace("{n}", String(progress!.day))
        .replace("{days}", String(progress!.days))
        .replace("{date}", short(progress!.end));
    }
    await expect(card.locator("[data-order-progress]")).toHaveText(line);

    const renew = card.getByRole("link", { name: new RegExp(`^${t.account.renew}`) });
    if (renewDue(progress, today)) {
      await expect(renew).toHaveAttribute("href", `/${locale}/order?program=balance&kcal=${order.kcal}`);
    } else {
      await expect(renew).toHaveCount(0);
    }
  }

  // The fixture holds both kinds: one order three days in with a day left (Renew), one a month long (no Renew).
  const cards = page.getByRole("listitem").filter({ has: page.locator("[data-order-progress]") });
  await expect(cards.getByRole("link", { name: new RegExp(`^${t.account.renew}`) })).toHaveCount(1);
  await expect(page.getByText(t.account.progressRunning.replace("{n}", "3").replace("{days}", "4").split(" ·")[0])).toBeVisible();

  // With a Renew on the page, the general order button is the outline one: one gold order button per page.
  await expect(page.getByRole("link", { name: t.account.orderCta, exact: true })).toHaveClass(/btn-outline/);
});
