import uz from "../src/i18n/uz";
import { expect, test } from "./fixtures";

/**
 * Runs before every other test (playwright.config.ts → dependencies). If the app under test is connected
 * to a database, this fails and no other test runs: the suite must only ever see demo mode.
 */
test("the app under test runs in demo mode", async ({ page, adminURL }) => {
  // The admin falls back to its setup page when the Supabase keys are missing.
  await page.goto(adminURL("/"));
  await expect(page).toHaveURL(adminURL("/setup"));
  await expect(page.getByRole("heading", { level: 1, name: "База данных не подключена" })).toBeVisible();

  // The public site shows the demonstration catalogue.
  await page.goto("/uz/menu?day=1");
  await expect(page.getByText(uz.menu.demoNote)).toBeVisible();
});
