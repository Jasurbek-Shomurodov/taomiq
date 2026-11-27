import type { Page } from "@playwright/test";
import { getDictionary } from "../src/i18n";
import fixture from "./account-fixture.json";
import { SESSION_COOKIE, sessionCookie } from "./account-session";
import { expect, test } from "./fixtures";

/**
 * Signing out leaves none of the customer's data in the browser (docs/plans/sign-out-clears-page.md): not in the page
 * after the sign-out, and not on Back or Forward, on a shared device. Runs only in the `account` projects, against
 * `scripts/e2e-server.mjs --account` (a local mock of Supabase with the made-up customer of account-fixture.json).
 */
const locale = "uz";
const t = getDictionary(locale);

/** Everything about the customer that the account page shows or carries (the user id goes to the analytics props). */
const CUSTOMER_DATA = [
  fixture.profile.name,
  fixture.profile.phone,
  fixture.user.email,
  String(fixture.order.number),
  fixture.user.id,
];

/** The customer data found anywhere in the current document (DOM, hidden kept routes, inline RSC payload). */
async function dataInPage(page: Page): Promise<string[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      return CUSTOMER_DATA.filter((value) => html.includes(value));
    } catch (error) {
      // A navigation in progress replaces the document under the call; read the new one.
      if (attempt >= 20) throw error;
      await page.waitForTimeout(100);
    }
  }
}

/** For two seconds: no customer data in the page, and never on the account page. Catches a late paint or restore. */
async function expectNoCustomerData(page: Page, step: string) {
  const until = Date.now() + 2000;
  while (Date.now() < until) {
    expect(await dataInPage(page), `${step}: customer data in the page at ${page.url()}`).toEqual([]);
    expect(new URL(page.url()).pathname, step).not.toBe(`/${locale}/account`);
    await page.waitForTimeout(100);
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: SESSION_COOKIE, value: sessionCookie(), url: baseURL! }]);
});

for (const entry of ["direct load", "link from the menu page"] as const) {
  test(`sign out leaves no customer data in the browser (${entry})`, async ({ page, isMobile }) => {
    if (entry === "direct load") {
      await page.goto(`/${locale}/account`);
    } else {
      await page.goto(`/${locale}/menu`);
      // Phones: the account link is in the sections sheet.
      if (isMobile) await page.getByRole("button", { name: t.nav.sections }).click();
      // The link turns into the account link once the browser has read its session cookie.
      await page.locator(`a[href="/${locale}/account"]:visible`).first().click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/account$`));
    }

    // 1. Signed in: the page shows the customer.
    await expect(page.locator("#account-name")).toHaveValue(fixture.profile.name);
    // Nothing takes focus on load: the name field waits for the customer.
    await expect(page.locator("#account-name")).not.toBeFocused();
    await expect(page.getByText(fixture.profile.phone, { exact: true })).toBeVisible();
    await expect(page.getByText(fixture.user.email, { exact: true })).toBeVisible();
    await expect(
      page.getByText(t.account.orderNumber.replace("{n}", String(fixture.order.number)), { exact: true }),
    ).toBeVisible();

    // 2. Sign out → home, and nothing of the customer is left in the document.
    await page.getByRole("button", { name: t.account.signOut, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    await page.waitForLoadState("load");
    await expectNoCustomerData(page, "after sign-out");
    expect((await page.context().cookies()).map((cookie) => cookie.name)).not.toContain(SESSION_COOKIE);

    // 3. Back: the page before (or the login page), never the account page with the customer's data.
    await page.goBack();
    await expectNoCustomerData(page, "after Back");

    // 4. Forward and Back again.
    await page.goForward();
    await expectNoCustomerData(page, "after Forward");
    await page.goBack();
    await expectNoCustomerData(page, "after Back again");
  });
}
