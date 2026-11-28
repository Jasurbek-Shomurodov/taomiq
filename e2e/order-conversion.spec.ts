import type { Locator, Page } from "@playwright/test";
import { formatSum, plural } from "../src/i18n/config";
import ru from "../src/i18n/ru";
import uz from "../src/i18n/uz";
import { demoDurations, demoPrograms } from "../src/lib/data/demo";
import { pricePerDay } from "../src/lib/data/types";
import { expect, test } from "./fixtures";

/**
 * The order form's conversion and robustness pass (round of 28 Nov 2026): the price per day as the big figure, the
 * phone field's grouping and paste rules, Enter moving on instead of sending, a calm message when offline with the same
 * request id on the retry, "Still sending…" after 8 s, the lines by the order button, and server errors bringing back
 * the step that holds the field. Demo mode: a valid order is answered "ordering opens soon"; nothing reaches a database.
 */

type T = typeof ru.order;
const ADDRESS = "Ташкент, ул. Амира Темура 1, кв. 5";

/** A server action's POST to the order page. */
const isOrderPost = (path: string) => (r: { method(): string; url(): string }) =>
  r.method() === "POST" && new URL(r.url()).pathname === path;

/** A field of a server action's multipart body (React prefixes the form's keys, as in "_1_address"). */
function postedField(body: string, key: string): string | undefined {
  return new RegExp(`name="(?:_?\\d+_)?${key}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1];
}

/**
 * Phones: step 1 → 2 (address) → 3. Wider screens show every section already; the address is filled either way. Each
 * step change ends with its heading focused and the bar's button at rest: only then is the step settled (a value
 * changed by a test before that would be put back by the next render, and focus would move to the heading).
 */
async function toContact(page: Page, t: T, isMobile: boolean) {
  const next = page.getByRole("button", { name: t.next, exact: true });
  const settled = async (n: number) => {
    await expect(page.locator(`#order-step-${n}`)).toBeFocused();
    await expect(page.locator("div.sticky.bottom-0 button").last()).toBeEnabled();
  };
  if (isMobile) {
    await next.click();
    await settled(2);
  }
  await page.getByLabel(t.address, { exact: true }).fill(ADDRESS);
  if (isMobile) {
    await next.click();
    await settled(3);
  }
  await expect(page.getByLabel(t.name, { exact: true })).toBeVisible();
}

async function fillOrder(page: Page, t: T, isMobile: boolean) {
  await toContact(page, t, isMobile);
  await page.getByLabel(t.name, { exact: true }).fill("Test");
  await page.getByLabel(t.phone, { exact: true }).fill("901234567");
  await page.locator("#order-consent").check();
}

/** The visible order button (the bar's on phones, the summary card's from md), whatever its label while sending. */
const orderButton = (page: Page) => page.locator('button[type="submit"]').filter({ visible: true });

/** A real paste event, as a long-press → Paste on a phone fires it. */
async function paste(field: Locator, text: string) {
  await field.focus();
  await field.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test("price framing: the price per day is the big figure, the days and the total right under it", async ({
  page,
  isMobile,
}) => {
  const t = uz.order;
  const program = demoPrograms.find((p) => p.slug === "balance")!;
  const variant = program.variants[0];
  const week = demoDurations.find((d) => d.days === 7)!;
  const month = demoDurations.find((d) => d.days === 30)!;
  const perDay = pricePerDay(variant.price_per_day, week.markup_pct);
  await page.goto("/uz/order");

  // What is chosen at first is unchanged: BALANCE, its first level, 7 days.
  await expect(page.getByRole("radio", { name: program.name })).toBeChecked();
  await expect(page.getByRole("radio", { name: `${variant.kcal} ${t.kcal}` })).toBeChecked();
  await expect(page.getByRole("radio", { name: new RegExp(`^7 ${t.dayForms[0]}`) })).toBeChecked();

  const big = page.locator("[data-order-per-day]").filter({ visible: true });
  const small = page.locator("[data-order-total]").filter({ visible: true });
  await expect(big).toHaveCount(1);
  await expect(big).toContainText(`${formatSum(perDay)} ${t.currency} / ${t.dayForms[0]}`);
  await expect(small).toHaveText(`7 ${plural(7, t.dayForms)} · ${formatSum(perDay * 7)} ${t.currency}`);
  const size = (locator: Locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(await size(big)).toBeGreaterThan(await size(small));

  // Another length: both lines follow, the total by the same formula as the server.
  const monthPerDay = pricePerDay(variant.price_per_day, month.markup_pct);
  await page.locator("label").filter({ has: page.getByRole("radio", { name: new RegExp(`^30 ${t.dayForms[0]}`) }) }).click();
  await expect(big).toContainText(`${formatSum(monthPerDay)} ${t.currency}`);
  await expect(small).toHaveText(`30 ${plural(30, t.dayForms)} · ${formatSum(monthPerDay * 30)} ${t.currency}`);

  // The lines by the order button: payment after the manager, pauses by message (sign-in is off in the demo build),
  // and Telegram. Never online payment.
  if (isMobile) await toContact(page, t, true);
  const lines = isMobile ? page.locator("[data-order-reassure]") : page.locator("aside");
  await expect(lines.getByText(t.reassure.pay, { exact: true })).toBeVisible();
  await expect(lines.getByText(t.reassure.pauseMessage, { exact: true })).toBeVisible();
  await expect(lines.getByText(t.reassure.pauseAccount, { exact: true })).toHaveCount(0);
  await expect(lines.getByRole("link", { name: t.helpLink })).toBeVisible();
});

test("phone field: grouped while typing, pasted and autofilled numbers keep their 9 digits, Enter moves on", async ({
  page,
  isMobile,
}) => {
  const t = ru.order;
  const posts: string[] = [];
  page.on("request", (r) => {
    if (isOrderPost("/ru/order")(r)) posts.push(r.postData() ?? "");
  });
  await page.goto("/ru/order");

  // Keyboards and autofill: the right hints on every field.
  await expect(page.getByLabel(t.address, { exact: true })).toHaveAttribute("autocomplete", "street-address");
  await expect(page.getByLabel(t.comment)).toHaveAttribute("autocomplete", "off");
  await expect(page.getByLabel(t.exclusions)).toHaveAttribute("autocomplete", "off");
  await toContact(page, t, isMobile);
  const name = page.getByLabel(t.name, { exact: true });
  const phone = page.getByLabel(t.phone, { exact: true });
  const sent = page.locator('input[type="hidden"][name="phone"]');
  await expect(name).toHaveAttribute("autocomplete", "name");
  await expect(name).toHaveAttribute("enterkeyhint", "next");
  await expect(phone).toHaveAttribute("autocomplete", "tel-national");
  await expect(phone).toHaveAttribute("inputmode", "tel");
  await expect(phone).toHaveAttribute("type", "tel");

  // Typed: grouped as it goes; the 9 digits are what is sent.
  await phone.pressSequentially("90123");
  await expect(phone).toHaveValue("90 123");
  await phone.pressSequentially("4567");
  await expect(phone).toHaveValue("90 123 45 67");
  await expect(sent).toHaveValue("901234567");
  // A 10th digit is not taken.
  await phone.press("8");
  await expect(phone).toHaveValue("90 123 45 67");

  // Backspace just after a space takes the digit before it, and the caret stays there.
  await phone.fill("90123");
  await phone.evaluate((input: HTMLInputElement) => input.setSelectionRange(3, 3));
  await phone.press("Backspace");
  await expect(phone).toHaveValue("91 23");
  await expect.poll(() => phone.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(1);

  // Pasted, in the forms people copy numbers in; a paste replaces what was there.
  for (const text of ["+998 90 123-45-67", "998901234567", "901234567", "+998901234567", "(90) 123 45 67"]) {
    await phone.fill("93");
    await paste(phone, text);
    await expect(phone, text).toHaveValue("90 123 45 67");
    await expect(sent, text).toHaveValue("901234567");
  }
  // Autofill and other tools set the value directly: the same rules.
  for (const text of ["+998 90 123-45-67", "998901234567"]) {
    await phone.fill(text);
    await expect(phone, text).toHaveValue("90 123 45 67");
  }

  // Enter in the name goes to the phone, Enter in the phone to the consent box: nothing is sent early.
  await name.fill("Тест");
  await name.press("Enter");
  await expect(phone).toBeFocused();
  await phone.press("Enter");
  await expect(page.locator("#order-consent")).toBeFocused();
  expect(posts).toHaveLength(0);

  // A code that is not on the operator list: a calm hint under the field, linked to it, and nothing blocked. The list
  // is kept by hand, so a real new code must never stop an order: the server takes any 9 digits.
  const codeHint = page.locator("[data-order-phone-code]");
  await expect(codeHint).toHaveCount(0);
  await phone.fill("12");
  await expect(codeHint).toHaveText(t.phoneCodeHint);
  await phone.fill("121234567");
  await expect(phone).toHaveAttribute("aria-describedby", /order-phone-code/);
  await expect(phone).not.toHaveAttribute("aria-invalid", "true");
  await page.locator("#order-consent").check();
  await expect(phone).toHaveAttribute("enterkeyhint", "send");
  await orderButton(page).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(postedField(posts[0], "phone")).toBe("121234567");
  await expect(page.getByRole("alert").filter({ hasText: t.general.demo })).toBeVisible();
  await expect(page.getByText(t.errors.phone)).toHaveCount(0);
  // A known code: no hint.
  await phone.fill("901234567");
  await expect(codeHint).toHaveCount(0);
});

test("offline: a calm message, every answer kept, and the retry sends the same request id", async ({
  page,
  context,
  isMobile,
}) => {
  const t = uz.order;
  const ids: (string | undefined)[] = [];
  page.on("request", (r) => {
    if (isOrderPost("/uz/order")(r)) ids.push(postedField(r.postData() ?? "", "request_id"));
  });
  const offline = page.getByRole("alert").filter({ hasText: t.general.offline });
  const demo = page.getByRole("alert").filter({ hasText: t.general.demo });
  await page.goto("/uz/order");
  await fillOrder(page, t, isMobile);

  // No connection: nothing is sent, the message says to tap again, and no Telegram button (it would not open either).
  await context.setOffline(true);
  await orderButton(page).click();
  await expect(offline).toBeVisible();
  await expect(offline.getByRole("link")).toHaveCount(0);
  expect(ids).toHaveLength(0);
  await expect(page.getByLabel(t.name, { exact: true })).toHaveValue("Test");
  await expect(page.getByLabel(t.phone, { exact: true })).toHaveValue("90 123 45 67");

  // Back online, but the request fails on the way (the connection drops while sending): the same calm message.
  await context.setOffline(false);
  let drop = true;
  await page.route("**/uz/order", (route) => {
    if (route.request().method() === "POST" && drop) {
      drop = false;
      return route.abort("internetdisconnected");
    }
    return route.continue();
  });
  await orderButton(page).click();
  await expect.poll(() => ids.length).toBe(1);
  await expect(offline).toBeVisible();
  await expect(page.getByLabel(t.name, { exact: true })).toHaveValue("Test");

  // The next tap sends the same request id: had the first one been saved, the server would return that order.
  await orderButton(page).click();
  await expect.poll(() => ids.length).toBe(2);
  expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(ids[1]).toBe(ids[0]);
  await expect(demo).toBeVisible();
  await expect(offline).toHaveCount(0);
});

test("a slow answer: the button is disabled with a spinner, and after 8 s 'Still sending…'", async ({ page, isMobile }) => {
  const t = ru.order;
  await page.clock.install();
  await page.goto("/ru/order");
  await fillOrder(page, t, isMobile);

  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/ru/order", async (route) => {
    if (route.request().method() === "POST") await held;
    await route.continue();
  });
  const still = page.locator("[data-order-still-sending]").filter({ visible: true }).filter({ hasText: t.stillSending });
  const button = orderButton(page);
  const posted = page.waitForRequest(isOrderPost("/ru/order"));
  await button.click();
  await posted;
  await expect(button).toBeDisabled();
  await expect(button).toHaveAccessibleName(t.pending);
  await expect(button.locator("svg.animate-spin")).toBeVisible();
  await expect(still).toHaveCount(0);

  await page.clock.runFor(8_000);
  await expect(still).toBeVisible();
  await expect(still).toHaveAttribute("role", "status");

  release();
  await expect(page.getByRole("alert").filter({ hasText: t.general.demo })).toBeVisible();
  await expect(still).toHaveCount(0);
  await expect(button).toBeEnabled();
  await expect(button).toHaveAccessibleName(t.submit);
});

test("server field errors: each brings back its step, focuses the field and says what to do", async ({ page, isMobile }) => {
  const t = ru.order;
  const stepHeading = (n: number, title: string) =>
    page.getByRole("heading", {
      level: 2,
      name: isMobile ? `${t.step.replace("{n}", String(n)).replace("{total}", "3")}: ${title}` : title,
    });
  const plan = stepHeading(1, t.sections.plan);
  await page.goto("/ru/order");
  const earliest = (await page.locator('input[name="start_date"]').first().getAttribute("value"))!;
  await fillOrder(page, t, isMobile);

  // A start date the server no longer accepts (the cutoff passed while the form was open): step 1 comes back, the date
  // is the new earliest one and the message names it.
  await page.locator('input[name="start_date"]:checked').evaluate((input: HTMLInputElement) => (input.value = "2020-01-01"));
  await orderButton(page).click();
  await expect(plan).toBeVisible();
  await expect(page.locator("#order-start")).toBeFocused();
  await expect(page.locator("#order-start")).toBeInViewport();
  const [y, m, d] = earliest.split("-").map(Number);
  const weekdayName = t.weekdayNames[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const moved = t.errors.startMoved.replace("{date}", `${weekdayName}, ${d} ${t.monthNames[m - 1]}`);
  await expect(page.getByText(moved)).toBeVisible();
  await expect(page.locator(`input[name="start_date"][value="${earliest}"]`)).toBeChecked();
  await expect(page.getByLabel(t.name, { exact: true })).toHaveValue("Test");

  // A level that is not on sale any more: the plan.
  if (isMobile) await toContact(page, t, true);
  await page.locator('input[name="variant_id"]:checked').evaluate((input: HTMLInputElement) => (input.value = "x"));
  await orderButton(page).click();
  await expect(plan).toBeVisible();
  await expect(page.getByText(t.errors.plan)).toBeVisible();
  await expect(page.locator("#order-plan")).toBeFocused();

  // A length that is not offered: the duration, on the same step.
  await page.reload();
  await fillOrder(page, t, isMobile);
  await page.locator('input[name="days"]:checked').evaluate((input: HTMLInputElement) => (input.value = "5"));
  await orderButton(page).click();
  await expect(plan).toBeVisible();
  await expect(page.getByText(t.errors.duration)).toBeVisible();
  await expect(page.locator("#order-duration")).toBeFocused();

  // An address the server finds too short: step 2.
  await page.reload();
  await fillOrder(page, t, isMobile);
  await page.locator("#order-address").evaluate((input: HTMLTextAreaElement) => input.setAttribute("name", "address-x"));
  await orderButton(page).click();
  await expect(stepHeading(2, t.sections.delivery)).toBeVisible();
  await expect(page.getByText(t.errors.address)).toBeVisible();
  await expect(page.locator("#order-address")).toBeFocused();
  await expect(page.locator("#order-address")).toHaveValue(ADDRESS);
});
