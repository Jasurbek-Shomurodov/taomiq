import "server-only";
import { cookies, headers } from "next/headers";
import { PostHog, cookieStateToProperties, cookieStoreFromHeader, readPostHogCookie } from "posthog-node";
import { POSTHOG_API_HOST, isAnalyticsEnabled, posthogKey } from "./config";
import type { ServerEvent, ServerEventProperties } from "./events";

/**
 * The server side of analytics (posthog-node, straight to PostHog EU). A no-op without NEXT_PUBLIC_POSTHOG_KEY.
 *
 * A Vercel function may be frozen as soon as its response is sent, so nothing waits in a queue here: each call makes
 * its own client that sends at once (flushAt 1, no flush timer) and is shut down, awaited, before the call returns.
 * Failures are logged and swallowed: analytics never breaks an order or a page.
 */
function createClient() {
  return new PostHog(posthogKey, {
    host: POSTHOG_API_HOST,
    flushAt: 1,
    flushInterval: 0,
    // Short: this runs inside a customer's request.
    requestTimeout: 3000,
    captureMaxRetries: 1,
  });
}

async function send(capture: (client: PostHog) => void) {
  const client = createClient();
  try {
    capture(client);
  } finally {
    await client.shutdown();
  }
}

/**
 * Sends one server event for the visitor of the current request (a Server Action or a Route Handler, where cookies()
 * and headers() are available). Who it belongs to: the browser's PostHog id from its cookie (ph_<key>_posthog), so the
 * event joins that visitor's funnel and replay; otherwise the signed-in customer's Supabase user id (`userId`);
 * otherwise nobody, and the event is skipped rather than given an invented id. Skipped too when the browser sends
 * Do Not Track. Never pass a name, phone, email, address or comment: the property types do not allow them.
 */
export async function captureServerEvent<E extends ServerEvent>(
  event: E,
  properties: ServerEventProperties<E>,
  { userId }: { userId?: string } = {},
): Promise<void> {
  if (!isAnalyticsEnabled) return;
  try {
    if ((await headers()).get("dnt") === "1") return;
    const state = readPostHogCookie(await cookies(), posthogKey);
    const distinctId = state?.distinctId || userId;
    if (!distinctId) return;
    await send((client) =>
      client.capture({ distinctId, event, properties: { ...properties, ...cookieStateToProperties(state) } }),
    );
  } catch (error) {
    console.error("analytics: server event not sent", event, error instanceof Error ? error.message : error);
  }
}

/** What src/instrumentation.ts → onRequestError passes on: only these fields, never the body or other headers. */
export type ServerErrorRequest = {
  /** The path with its query string, as Next.js gives it; only the path part is sent. */
  path: string;
  method: string;
  /** Read for the PostHog cookie and Do Not Track only; never sent. */
  headers: Record<string, string | string[] | undefined>;
};

export type ServerErrorContext = {
  routePath: string;
  routeType: string;
  renderSource?: string;
};

/**
 * Sends a server error to PostHog error tracking: the error (message and stack), the path without its query string,
 * the method and which route failed. No request body, no cookies, no headers. The visitor's PostHog id from the cookie
 * links it to their session when there is one (not with Do Not Track); otherwise PostHog records it without a person.
 */
export async function captureServerError(
  error: unknown,
  request: ServerErrorRequest,
  context: ServerErrorContext,
): Promise<void> {
  if (!isAnalyticsEnabled) return;
  try {
    const header = (name: string) => {
      const value = request.headers[name];
      return Array.isArray(value) ? value.join("; ") : (value ?? "");
    };
    const state =
      header("dnt") === "1" ? null : readPostHogCookie(cookieStoreFromHeader(header("cookie")), posthogKey);
    const digest =
      typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
    await send((client) =>
      client.captureException(error, {
        distinctId: state?.distinctId,
        properties: {
          $pathname: request.path.split("?")[0],
          method: request.method,
          route_path: context.routePath,
          route_type: context.routeType,
          render_source: context.renderSource,
          digest,
          ...cookieStateToProperties(state),
        },
      }),
    );
  } catch (failure) {
    console.error("analytics: server error not sent", failure instanceof Error ? failure.message : failure);
  }
}
