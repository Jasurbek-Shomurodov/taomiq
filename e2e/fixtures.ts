import { test as base, expect, type Page } from "@playwright/test";
import { ANALYTICS_PATH } from "../src/lib/analytics/config";

/**
 * Requests the browser must never make while testing: the real database, Telegram, Cloudflare Turnstile (its keys
 * are unset in the e2e build, so no page may load the widget) and PostHog, directly or through the site's own
 * analytics path (no key in the e2e build, so nothing may load or send).
 */
const FORBIDDEN = [
  /^https?:\/\/([a-z0-9-]+\.)*supabase\.co(:\d+)?\//i,
  /^https?:\/\/api\.telegram\.org(:\d+)?\//i,
  /^https?:\/\/challenges\.cloudflare\.com(:\d+)?\//i,
  /^https?:\/\/([a-z0-9-]+\.)*posthog\.com(:\d+)?\//i,
  new RegExp(`^https?://[^/]+${ANALYTICS_PATH}(/|$)`, "i"),
];

/**
 * Every test gets a browser context that aborts requests to *.supabase.co, api.telegram.org,
 * challenges.cloudflare.com and PostHog, and fails if one was attempted. This is the second barrier; the first is
 * demo mode itself (demo-mode.setup.ts).
 */
export const test = base.extend<{ adminURL: (path?: string) => string }>({
  // The fixture callback is named `provide`, not `use`, so the React hooks lint rule does not mistake it for a hook.
  context: async ({ context }, provide) => {
    const blocked: string[] = [];
    for (const pattern of FORBIDDEN) {
      await context.route(pattern, (route) => {
        blocked.push(new URL(route.request().url()).host);
        return route.abort("blockedbyclient");
      });
    }
    await provide(context);
    expect(blocked, "the browser tried to reach Supabase, Telegram, Turnstile or PostHog").toEqual([]);
  },
  /** The same server under admin.localhost; Chromium resolves *.localhost to the loopback address. */
  adminURL: async ({ baseURL }, provide) => {
    const origin = new URL(baseURL!);
    origin.hostname = `admin.${origin.hostname}`;
    await provide((path = "/") => new URL(path, origin).toString());
  },
});

/**
 * Collects console errors, uncaught page errors and failed same-origin requests from the moment it is
 * called. Cancelled requests (a prefetch dropped by a navigation) are not failures.
 */
export function watchPageProblems(page: Page, origin: string) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      problems.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    if (request.url().startsWith(origin) && !failure.includes("ERR_ABORTED")) {
      problems.push(`failed ${request.url()}: ${failure}`);
    }
  });
  return problems;
}

export { expect };
