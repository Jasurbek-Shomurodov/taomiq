import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke suite for the public site and the host routing (`npm run test:e2e`, the gate's fourth step).
 * It builds and serves its own production copy of the app in demo mode (scripts/e2e-server.mjs): never the
 * real database, never Telegram. The `demo-mode` project runs first and stops the run if demo mode is off.
 */
const port = Number(process.env.E2E_PORT ?? 5599);
const baseURL = `http://localhost:${port}`;

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
    { name: "phone", dependencies: ["demo-mode"], use: { ...devices["Pixel 7"] } },
    { name: "desktop", dependencies: ["demo-mode"], use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `${baseURL}/robots.txt`,
    // Never test whatever else might be listening on the port (a dev server holds the real keys).
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
