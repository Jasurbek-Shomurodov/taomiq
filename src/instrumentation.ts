import type { Instrumentation } from "next";
import { isAnalyticsEnabled } from "@/lib/analytics/config";

/**
 * Server errors (Server Components, Route Handlers, Server Actions, the proxy) go to PostHog error tracking, public
 * site only: the back office (admin host, /admin routes) is left out, as its screens and errors deal with customers'
 * personal data. Nothing is loaded or sent without NEXT_PUBLIC_POSTHOG_KEY. Next.js awaits this function.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!isAnalyticsEnabled) return;
  const host = request.headers["host"];
  if ((typeof host === "string" && host.startsWith("admin.")) || context.routePath.startsWith("/admin")) return;

  const { captureServerError } = await import("@/lib/analytics/server");
  await captureServerError(error, request, context);
};
