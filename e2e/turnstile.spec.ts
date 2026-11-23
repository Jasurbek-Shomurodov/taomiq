import type { Page } from "@playwright/test";
import { getAdminDictionary } from "../src/i18n/admin";
import uz from "../src/i18n/uz";
import { TURNSTILE_FIELD } from "../src/lib/turnstile/shared";
import { expect, test } from "./fixtures";

/**
 * The Turnstile keys are unset in the e2e build (scripts/e2e-server.mjs): no widget, no Cloudflare script,
 * and the forms work exactly as before. The fixture also fails any test whose page reaches
 * challenges.cloudflare.com, so every other page is covered too.
 */
const widget = (page: Page) =>
  page.locator(`input[name="${TURNSTILE_FIELD}"], script[src*="challenges.cloudflare.com"], iframe[src*="challenges.cloudflare.com"]`);

test("bot check off: the order form has no widget and still answers a valid order", async ({ page, isMobile }) => {
  // Phones get the stepped form (smoke.spec.ts); the fixture still fails it if any page loads the widget.
  test.skip(isMobile, "phones get the stepped form, covered in smoke.spec.ts");
  const t = uz.order;
  await page.goto("/uz/order");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(widget(page)).toHaveCount(0);

  await page.getByLabel(t.address, { exact: true }).fill("Toshkent, Amir Temur koʻchasi 1, 5-xonadon");
  await page.getByLabel(t.name, { exact: true }).fill("Test");
  await page.getByLabel(t.phone, { exact: true }).fill("901234567");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: t.submit }).filter({ visible: true }).click();

  await expect(page.getByRole("alert").filter({ hasText: t.general.demo })).toBeVisible();
  await expect(page.getByText(t.general.captcha)).toHaveCount(0);
  await expect(widget(page)).toHaveCount(0);
});

test("bot check off: the back-office login has no widget and answers as before", async ({ page, adminURL }) => {
  // The login page follows the admin_locale cookie, Russian by default.
  const t = getAdminDictionary("ru").login;
  await page.goto(adminURL("/login"));
  await expect(page.getByLabel(t.email)).toBeVisible();
  await expect(widget(page)).toHaveCount(0);

  await page.getByLabel(t.email).fill("staff@example.com");
  await page.getByLabel(t.password).fill("not-a-real-password");
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.getByRole("alert").filter({ hasText: t.notConfigured })).toBeVisible();
  await expect(widget(page)).toHaveCount(0);
});

test("marketing pages and the order page set no cookies (the session refresh is for account pages only)", async ({ request }) => {
  for (const path of ["/uz", "/ru/menu", "/uz/order", "/uz/login", "/ru/account"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["set-cookie"], path).toBeUndefined();
  }
});
