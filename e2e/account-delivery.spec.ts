import type { Page } from "@playwright/test";
import { getDictionary } from "../src/i18n";
import { DEFAULT_CUTOFF_HOUR, DEFAULT_DELIVERY_WINDOWS, firstDeliveryDate, startDateRange } from "../src/lib/order/rules";
import fixture from "./account-fixture.json";
import { SESSION_COOKIE, sessionCookie } from "./account-session";
import { expect, test } from "./fixtures";

/**
 * Saved delivery details and "Repeat last order" (docs/plans/saved-address-repeat-order.md): the account card shows,
 * changes and removes the saved address; the order form fills it in for a signed-in customer, with Clear and "Save for
 * next time"; ?repeat=<number> fills the form from one of the customer's own orders, with the earliest start date and,
 * for a level no longer offered, the nearest one and a note. Runs only in the `account` projects, against the local
 * Supabase mock, which keeps each session's saved details apart (session ids "saved-..." start with the fixture's).
 */
const locale = "ru";
const t = getDictionary(locale);
const d = t.account.delivery;
const o = t.order;
const saved = fixture.savedDelivery;
const DEFAULT_WINDOW = DEFAULT_DELIVERY_WINDOWS[1];

/** A session of its own per project and test, so no other suite sees what this one saves or removes. */
async function signIn(page: Page, baseURL: string, prefix: "saved" | "repeat", title: string, project: string) {
  const session = `${prefix}-${project}-${title.length}-${Date.now()}`;
  await page.context().addCookies([{ name: SESSION_COOKIE, value: sessionCookie(session), url: baseURL }]);
}

/** Phones show one step at a time: the delivery fields are on step 2. From md every section shows. */
async function toDeliveryStep(page: Page) {
  const next = page.getByRole("button", { name: o.next, exact: true });
  const address = page.locator("#order-address");
  if ((page.viewportSize()?.width ?? 1280) >= 768) return expect(address).toBeVisible();
  // A tap before the page has hydrated does nothing (Next is a plain type="button"): tap again until step 2 shows.
  await expect(async () => {
    if (!(await address.isVisible())) await next.click();
    await expect(address).toBeVisible({ timeout: 1000 });
  }).toPass();
}

const radio = (page: Page, name: string, value: string) => page.locator(`input[name="${name}"][value="${value}"]`);

test("saved details show in the account and fill in the order form, which can clear them", async ({ page, baseURL }, info) => {
  await signIn(page, baseURL!, "saved", info.title, info.project.name);

  await page.goto(`/${locale}/account`);
  const card = page.locator("section[aria-labelledby='delivery-details']");
  await expect(card).toHaveAttribute("data-ph-mask");
  await expect(card.locator("[data-delivery-address]")).toHaveText(saved.address);
  await expect(card.locator("[data-delivery-address]")).toHaveAttribute("data-ph-mask");
  await expect(card.locator("[data-delivery-window]")).toHaveText(saved.delivery_window);
  await expect(card).toContainText(saved.courier_note);

  await page.goto(`/${locale}/order`);
  await expect(page.locator("#order-address")).toHaveValue(saved.address);
  await expect(page.locator("#order-address")).toHaveAttribute("data-ph-mask");
  await expect(page.locator("#order-comment")).toHaveValue(saved.courier_note);
  await expect(radio(page, "window", saved.delivery_window)).toBeChecked();
  // The address never travels in the URL.
  expect(page.url()).toBe(new URL(`/${locale}/order`, baseURL).toString());

  await toDeliveryStep(page);
  const save = page.getByRole("checkbox", { name: o.saveDelivery });
  // Opt-in: keeping the address is the customer's choice, so the box starts unticked.
  await expect(save).toBeVisible();
  await expect(save).not.toBeChecked();

  await page.getByRole("button", { name: o.clearDeliveryLabel }).click();
  await expect(page.locator("#order-address")).toHaveValue("");
  await expect(page.locator("#order-address")).toBeFocused();
  await expect(page.locator("#order-comment")).toHaveValue("");
  await expect(radio(page, "window", DEFAULT_WINDOW)).toBeChecked();
  await expect(page.getByRole("button", { name: o.clearDeliveryLabel })).toHaveCount(0);
});

test("the account card changes, removes and adds the saved details", async ({ page, baseURL }, info) => {
  await signIn(page, baseURL!, "saved", info.title, info.project.name);
  await page.goto(`/${locale}/account`);
  const card = page.locator("section[aria-labelledby='delivery-details']");

  await card.getByRole("button", { name: d.edit, exact: true }).click();
  const address = card.getByLabel(d.address);
  await expect(address).toBeFocused();
  await expect(address).toHaveValue(saved.address);

  // Too short: the server's sentence, and nothing changes.
  await address.fill("abc");
  await card.getByRole("button", { name: d.save, exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText(d.errors.address);
  // The refused text stays in the field to correct.
  await expect(address).toHaveValue("abc");

  const next = "Mirobod tumani, Afrosiyob 7, 18-xonadon";
  await address.fill(next);
  await card.getByLabel(d.window).selectOption("08:00–10:00");
  await card.getByLabel(d.note).fill("");
  await card.getByRole("button", { name: d.save, exact: true }).click();
  await expect(card.locator("[data-delivery-status]")).toHaveText(d.saved);
  await expect(card.locator("[data-delivery-address]")).toHaveText(next);
  await expect(card.locator("[data-delivery-window]")).toHaveText("08:00–10:00");
  await expect(card).not.toContainText(saved.courier_note);

  await card.getByRole("button", { name: d.remove, exact: true }).click();
  await expect(card.locator("[data-delivery-status]")).toHaveText(d.removed);
  await expect(card.getByText(d.empty)).toBeVisible();
  await expect(card.locator("[data-delivery-address]")).toHaveCount(0);

  // Removed for good: the next page load and the order form have nothing to fill in.
  await page.reload();
  await expect(card.getByText(d.empty)).toBeVisible();
  await page.goto(`/${locale}/order`);
  await expect(page.locator("#order-address")).toHaveValue("");
  await expect(page.getByRole("button", { name: o.clearDeliveryLabel })).toHaveCount(0);

  await page.goto(`/${locale}/account`);
  await card.getByRole("button", { name: d.add, exact: true }).click();
  await card.getByLabel(d.address).fill(next);
  await card.getByRole("button", { name: d.save, exact: true }).click();
  await expect(card.locator("[data-delivery-address]")).toHaveText(next);
  await expect(card.locator("[data-delivery-window]")).toHaveCount(0);
});

test("Repeat last order fills the form from that order, from the earliest start date", async ({ page, baseURL }, info) => {
  await signIn(page, baseURL!, "repeat", info.title, info.project.name);
  const { earliest } = startDateRange(new Date(), DEFAULT_CUTOFF_HOUR);

  await page.goto(`/${locale}/account`);
  await page.locator("[data-repeat-order]").click();
  // Only the order number is in the URL; the server reads the rest.
  await expect(page).toHaveURL(new URL(`/${locale}/order?repeat=${fixture.order.number}`, baseURL).toString());
  await expect(page.locator("[data-order-notice]")).toHaveText(o.repeatFrom.replace("{n}", String(fixture.order.number)));

  await expect(radio(page, "variant_id", "e2e-balance-1800")).toBeChecked();
  await expect(radio(page, "days", String(fixture.order.days))).toBeChecked();
  await expect(radio(page, "schedule", fixture.order.weekdays_only ? "weekdays" : "everyday")).toBeChecked();
  await expect(radio(page, "start_date", firstDeliveryDate(earliest, fixture.order.weekdays_only))).toBeChecked();
  await expect(page.locator("#order-address")).toHaveValue(fixture.repeat.address);
  await expect(radio(page, "window", fixture.repeat.delivery_window)).toBeChecked();
  await expect(page.locator("#order-comment")).toHaveValue(fixture.repeat.comment);
  await expect(page.locator("#order-exclusions")).toHaveValue(fixture.repeat.exclusions);
});

test("a repeat with a saved address uses the saved address and note, and says the order had another", async ({
  page,
  baseURL,
}, info) => {
  await signIn(page, baseURL!, "saved", info.title, info.project.name);
  await page.goto(`/${locale}/order?repeat=${fixture.order.number}`);
  await expect(page.locator("[data-order-notice]")).toHaveText(
    `${o.repeatFrom.replace("{n}", String(fixture.order.number))} ${o.repeatSavedAddress}`,
  );
  await expect(page.locator("#order-address")).toHaveValue(saved.address);
  await expect(page.locator("#order-comment")).toHaveValue(saved.courier_note);
  // The plan, time and exclusions still come from the order.
  await expect(radio(page, "window", fixture.repeat.delivery_window)).toBeChecked();
  await expect(page.locator("#order-exclusions")).toHaveValue(fixture.repeat.exclusions);
  await expect(radio(page, "days", String(fixture.order.days))).toBeChecked();
});

test("a repeated order whose level is gone gets the nearest level and says so", async ({ page, baseURL }, info) => {
  await signIn(page, baseURL!, "repeat", info.title, info.project.name);
  const retired = fixture.retiredLevelOrder;
  const { earliest } = startDateRange(new Date(), DEFAULT_CUTOFF_HOUR);

  await page.goto(`/${locale}/order?repeat=${retired.number}`);
  await expect(page.locator("[data-order-notice]")).toHaveText(
    o.repeatLevel.replace("{from}", String(retired.kcal)).replace("{to}", "1800"),
  );
  await expect(radio(page, "variant_id", "e2e-balance-1800")).toBeChecked();
  await expect(radio(page, "days", String(retired.days))).toBeChecked();
  await expect(radio(page, "schedule", "weekdays")).toBeChecked();
  // Weekdays only: a weekend earliest date moves to the Monday after.
  await expect(radio(page, "start_date", firstDeliveryDate(earliest, true))).toBeChecked();
});

test("an order that is not the customer's fills in nothing and says so", async ({ page, baseURL }, info) => {
  await signIn(page, baseURL!, "repeat", info.title, info.project.name);
  await page.goto(`/${locale}/order?repeat=999999`);
  await expect(page.locator("[data-order-notice]")).toHaveText(o.repeatFailed.replace("{n}", "999999"));
  await expect(page.locator("#order-address")).toHaveValue("");
  await expect(page.locator("#order-exclusions")).toHaveValue("");
});

test("signed out, a repeat link goes to the login page and comes back", async ({ page }) => {
  await page.goto(`/${locale}/order?repeat=${fixture.order.number}`);
  await expect(page).toHaveURL(
    new RegExp(`/${locale}/login\\?next=${encodeURIComponent(`/${locale}/order?repeat=${fixture.order.number}`)}$`),
  );
});
