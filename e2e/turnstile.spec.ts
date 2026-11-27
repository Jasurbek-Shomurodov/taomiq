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
  await page.locator("#order-consent").check();
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
  // exact: the show/hide toggle's name ("Показать пароль") also contains the word.
  await page.getByLabel(t.password, { exact: true }).fill("not-a-real-password");
  await page.getByRole("button", { name: t.submit }).click();
  await expect(page.getByRole("alert").filter({ hasText: t.notConfigured })).toBeVisible();
  await expect(widget(page)).toHaveCount(0);
});

test("back-office Google sign-in off: no Google button, the callback refuses, the password toggle works", async ({ page, adminURL }) => {
  // ADMIN_GOOGLE_LOGIN is unset in the e2e build (scripts/e2e-server.mjs), and Supabase is not connected.
  const t = getAdminDictionary("ru").login;
  await page.goto(adminURL("/login"));
  await expect(page.getByRole("heading", { level: 1, name: t.heading })).toBeVisible();
  await expect(page.getByRole("button", { name: t.google })).toHaveCount(0);
  await expect(page.getByText(t.or, { exact: true })).toHaveCount(0);

  const password = page.getByLabel(t.password, { exact: true });
  const toggle = page.getByRole("button", { name: t.showPassword });
  await password.fill("not-a-real-password");
  await expect(password).toHaveAttribute("type", "password");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // The admin host's /auth/callback is the staff Google callback: switched off, it goes straight back to /login.
  await page.goto(adminURL("/auth/callback?code=not-a-real-code"));
  await expect(page).toHaveURL(adminURL("/login"));
});

test("marketing pages and the order page set no cookies (the session refresh is for account pages only)", async ({ request }) => {
  for (const path of ["/uz", "/ru/menu", "/uz/order", "/uz/login", "/ru/account"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["set-cookie"], path).toBeUndefined();
  }
});
