import "server-only";
import { randomUUID } from "node:crypto";
import { site } from "@/lib/site";
import { isTurnstileConfigured, turnstileSecretKey } from "./config";
import type { TurnstileAction } from "./shared";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's limit; anything longer is not a token. */
const TOKEN_MAX = 2048;
const TIMEOUT_MS = 4000;

/** `next dev`. Every build (production, previews, the e2e build) counts as production here. */
const devServer = process.env.NODE_ENV === "development";

/**
 * Cloudflare's published test secret keys (1x… always passes, 2x… always fails, 3x… "token already spent").
 * They accept only the dummy token, and a passing answer always names the hostname "example.com" and carries no
 * action (Cloudflare docs: Turnstile → Troubleshooting → Testing). Honoured only by `next dev`.
 */
const TEST_SECRET = /^[123]x0+AA$/;
const devTestKeys = devServer && TEST_SECRET.test(turnstileSecretKey);

/**
 * The hostnames a token may have been solved on: the site's own (NEXT_PUBLIC_SITE_URL, without "www.") and its
 * admin host. `next dev` also allows localhost and admin.localhost, and example.com with the test keys.
 * Production never accepts any of those: a token solved anywhere else (a copy of the site, someone else's page
 * that embeds our public site key) is refused.
 */
function allowedHostnames(): Set<string> {
  let apex = "taomiq.uz";
  try {
    apex = new URL(site.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // A malformed NEXT_PUBLIC_SITE_URL: keep the production apex.
  }
  const hosts = new Set([apex, `admin.${apex}`]);
  if (devServer) {
    hosts.add("localhost");
    hosts.add("admin.localhost");
    if (devTestKeys) hosts.add("example.com");
  }
  return hosts;
}
const ALLOWED_HOSTNAMES = allowedHostnames();

export type TurnstileResult =
  | { ok: true }
  /**
   * missing: no token (the widget had not finished, failed to load, or a bot skipped it: the server cannot tell
   *   these apart, so it is refused and the form tells the customer to try again).
   * rejected: anything other than a clear yes from Cloudflare (invalid, expired after 300 s, already used, solved
   *   on another host or for another action, or an answer that is not Cloudflare's JSON).
   * unavailable: Cloudflare could not be asked (network error, timeout, HTTP 5xx, or its own "internal-error").
   */
  | { ok: false; reason: "missing" | "rejected" | "unavailable" };

type SiteverifyResponse = { success?: unknown; action?: unknown; hostname?: unknown; "error-codes"?: unknown };

/**
 * One siteverify call: the parsed answer; "unavailable" when Cloudflare could not answer (network error, timeout,
 * HTTP 5xx); "unreadable" for any other answer that is not a JSON object (a 4xx page, a proxy's error page).
 */
async function siteverify(body: URLSearchParams): Promise<SiteverifyResponse | "unavailable" | "unreadable"> {
  let response: Response;
  try {
    response = await fetch(SITEVERIFY, { method: "POST", body, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (error) {
    console.error("turnstile: siteverify unreachable", error instanceof Error ? error.message : error);
    return "unavailable";
  }
  if (response.status >= 500) {
    console.error("turnstile: siteverify HTTP", response.status);
    return "unavailable";
  }
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object") return parsed as SiteverifyResponse;
  } catch {
    // Not JSON: handled below.
  }
  console.error("turnstile: siteverify answered without JSON, HTTP", response.status);
  return "unreadable";
}

/**
 * Checks a Turnstile token with Cloudflare's siteverify (POST, form-encoded: secret, response, remoteip,
 * idempotency_key). A token can be redeemed once, so call this once per submission, and never for a token
 * that is also handed to Supabase as captchaToken (Supabase redeems it itself).
 *
 * A pass needs `success === true`, a hostname of this site (see ALLOWED_HOSTNAMES) and, when `action` is given,
 * exactly that action. Passes without asking anyone when Turnstile is not configured.
 */
export async function verifyTurnstile(
  token: string,
  ip: string | undefined,
  action?: TurnstileAction,
): Promise<TurnstileResult> {
  if (!isTurnstileConfigured) return { ok: true };
  if (!token || token.length > TOKEN_MAX) return { ok: false, reason: "missing" };

  const body = new URLSearchParams({ secret: turnstileSecretKey, response: token, idempotency_key: randomUUID() });
  if (ip) body.set("remoteip", ip);

  // One retry when Cloudflare could not answer, with the same idempotency key so a redemption that did reach
  // Cloudflare the first time is not reported as a duplicate the second time.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await siteverify(body);
    if (result === "unavailable") continue;
    if (result === "unreadable") return { ok: false, reason: "rejected" };

    const codes = Array.isArray(result["error-codes"]) ? result["error-codes"].map(String) : [];
    if (result.success === true) {
      const hostname = typeof result.hostname === "string" ? result.hostname.toLowerCase() : "";
      if (!ALLOWED_HOSTNAMES.has(hostname)) {
        console.warn("turnstile: token solved on another host", hostname || "(none)");
        return { ok: false, reason: "rejected" };
      }
      const solvedFor = typeof result.action === "string" ? result.action : "";
      // The test keys answer without an action, so only `next dev` with them may skip the comparison.
      const actionOk = !action || solvedFor === action || (devTestKeys && solvedFor === "");
      if (!actionOk) {
        console.warn("turnstile: token for another action", solvedFor || "(none)");
        return { ok: false, reason: "rejected" };
      }
      return { ok: true };
    }
    if (codes.includes("internal-error")) {
      console.error("turnstile: siteverify internal error");
      continue;
    }
    // A wrong secret is our configuration, not the visitor: say so loudly in the logs.
    if (codes.some((code) => code.includes("secret"))) console.error("turnstile: secret key refused", codes);
    return { ok: false, reason: "rejected" };
  }
  return { ok: false, reason: "unavailable" };
}
