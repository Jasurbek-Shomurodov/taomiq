/**
 * Product analytics (PostHog, EU cloud). Plan: docs/plans/analytics.md.
 *
 * This file has no imports, so next.config.ts, the proxy, the browser, the server and the e2e suite can all read it.
 *
 * No key, no PostHog: with NEXT_PUBLIC_POSTHOG_KEY unset (local dev, demo mode, the e2e build, Preview) nothing is
 * loaded, no request is made, the first-party path below is not routed and every capture call is a no-op. The key is
 * the project's public API key (it ships to every browser by design) and is set in Vercel, Production only.
 */
export const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";

export const isAnalyticsEnabled = Boolean(posthogKey);

/**
 * The first-party path the browser sends analytics to (taomiq.uz/k7r2/…); next.config.ts rewrites it to PostHog.
 * A neutral name: ad blockers list paths such as /ingest and /posthog. It must never be a locale or a page slug.
 * The proxy matcher in src/proxy.ts repeats it as a literal (a matcher must be static): change both together.
 */
export const ANALYTICS_PATH = "/k7r2";

/** PostHog EU ingestion (Frankfurt), for the rewrite and for server-side capture. */
export const POSTHOG_API_HOST = "https://eu.i.posthog.com";
/** PostHog EU static files (the SDK's lazily loaded parts: replay recorder, exception autocapture). */
export const POSTHOG_ASSETS_HOST = "https://eu-assets.i.posthog.com";
/** The PostHog app, for links the SDK builds (the toolbar). */
export const POSTHOG_UI_HOST = "https://eu.posthog.com";
