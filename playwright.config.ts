import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke suite for the public site and the host routing (`npm run test:e2e`, the gate's fourth step).
 * It builds and serves its own production copy of the app in demo mode (scripts/e2e-server.mjs): never the
 * real database, never Telegram. The `demo-mode` project runs first and stops the run if demo mode is off.
 *
 * The `account` project is the signed-in suite (e2e/account-signout.spec.ts): a second build, served by
 * `scripts/e2e-server.mjs --account` against a local mock of Supabase with a made-up customer. Only that spec runs
 * there, and it never runs against the demo build (where sign-in is off, which e2e/account.spec.ts asserts).
 */
const port = Number(process.env.E2E_PORT ?? 5599);
const baseURL = `http://localhost:${port}`;
const accountPort = Number(process.env.E2E_ACCOUNT_PORT ?? 5598);
const accountURL = `http://localhost:${accountPort}`;
const ACCOUNT_SPEC = /account-signout\.spec\.ts$/;

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "demo-mode", testMatch: /demo-mode\.setup\.ts$/, use: { ...devices["Desktop Chrome"] } },
    // Phones are the main audience. Pixel 7 is a Chromium device profile (mobile viewport, touch).
    { name: "phone", dependencies: ["demo-mode"], testIgnore: ACCOUNT_SPEC, use: { ...devices["Pixel 7"] } },
    { name: "desktop", dependencies: ["demo-mode"], testIgnore: ACCOUNT_SPEC, use: { ...devices["Desktop Chrome"] } },
    { name: "account", testMatch: ACCOUNT_SPEC, use: { ...devices["Desktop Chrome"], baseURL: accountURL } },
    { name: "account-phone", testMatch: ACCOUNT_SPEC, use: { ...devices["Pixel 7"], baseURL: accountURL } },
  ],
  webServer: [
    {
      command: "node scripts/e2e-server.mjs",
      url: `${baseURL}/robots.txt`,
      // Never test whatever else might be listening on the port (a dev server holds the real keys).
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "node scripts/e2e-server.mjs --account",
      url: `${accountURL}/robots.txt`,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
