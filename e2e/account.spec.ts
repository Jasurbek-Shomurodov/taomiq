import { getDictionary } from "../src/i18n";
import { locales } from "../src/i18n/config";
import { expect, test } from "./fixtures";

/**
 * Customer sign-in is off in the e2e build (NEXT_PUBLIC_AUTH_METHODS empty, no Supabase keys:
 * scripts/e2e-server.mjs). Then there is no login link anywhere and the account pages do not exist.
 */
for (const locale of locales) {
  test(`sign-in off: /${locale}/login and /${locale}/account are 404, the header has no login link`, async ({ page }) => {
    const t = getDictionary(locale);

    for (const path of ["/login", "/account"]) {
      const response = await page.goto(`/${locale}${path}`);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.notFound.title);
    }

    await page.goto(`/${locale}`);
    const banner = page.getByRole("banner");
    await expect(banner).toBeVisible();
    await expect(page.locator(`a[href^="/${locale}/login"], a[href^="/${locale}/account"]`)).toHaveCount(0);
    await expect(banner.getByRole("link", { name: t.account.login, exact: true })).toHaveCount(0);
  });
}

test("the sign-in callback has no locale redirect and goes home while sign-in is off", async ({ request }) => {
  const response = await request.get("/auth/callback?code=x&locale=ru&next=/ru/menu", { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(new URL(response.headers()["location"], "http://localhost").pathname).toBe("/ru");
});
