import { startAnalytics } from "@/lib/analytics/client";

// Runs in the browser before hydration, on every page of both hosts. startAnalytics() only decides whether to load
// PostHog (key set, public site, no Do Not Track); the SDK itself is fetched later, once the page has loaded.
try {
  startAnalytics();
} catch {
  // Analytics must never stop the page from starting.
}
