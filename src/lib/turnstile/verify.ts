import "server-only";
import { randomUUID } from "node:crypto";
import { turnstileSiteKey, type TurnstileAction } from "./shared";

/** Server-only secret (Cloudflare → Turnstile → the widget → Settings). Never NEXT_PUBLIC_. */
const secretKey = process.env.TURNSTILE_SECRET_KEY ?? "";

/**
 * True only when both keys are set. With either missing there is no check: the widget needs the site key
 * and the check needs the secret, and a check without a widget would refuse every order.
 */
export const isTurnstileConfigured = Boolean(turnstileSiteKey && secretKey);

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's limit; anything longer is not a token. */
const TOKEN_MAX = 2048;
const TIMEOUT_MS = 4000;

export type TurnstileResult =
  | { ok: true }
  /**
   * missing: no token (the widget had not finished, failed to load, or a bot skipped it).
   * rejected: Cloudflare said no (invalid, expired after 300 s, or already used: tokens are single-use).
   * unavailable: Cloudflare could not be asked (network, timeout, its own internal error).
   */
  | { ok: false; reason: "missing" | "rejected" | "unavailable" };

type SiteverifyResponse = { success?: boolean; action?: string; "error-codes"?: string[] };

/**
 * Checks a Turnstile token with Cloudflare's siteverify (POST, form-encoded: secret, response, remoteip,
 * idempotency_key). A token can be redeemed once, so call this once per submission, and never for a token
 * that is also handed to Supabase as captchaToken (Supabase redeems it itself).
 *
 * When `action` is given, a token solved by a widget with another action is refused.
 * Passes without asking anyone when Turnstile is not configured.
 */
export async function verifyTurnstile(
  token: string,
  ip: string | undefined,
  action?: TurnstileAction,
): Promise<TurnstileResult> {
  if (!isTurnstileConfigured) return { ok: true };
  if (!token || token.length > TOKEN_MAX) return { ok: false, reason: "missing" };

  const body = new URLSearchParams({ secret: secretKey, response: token, idempotency_key: randomUUID() });
  if (ip) body.set("remoteip", ip);

  // One retry on a network failure or timeout, with the same idempotency key so a redemption that did reach
  // Cloudflare the first time is not reported as a duplicate the second time.
  for (let attempt = 0; attempt < 2; attempt++) {
    let result: SiteverifyResponse;
    try {
      const response = await fetch(SITEVERIFY, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (response.status >= 500) throw new Error(`siteverify HTTP ${response.status}`);
      result = (await response.json()) as SiteverifyResponse;
    } catch (error) {
      if (attempt === 0) continue;
      console.error("turnstile: siteverify unreachable", error instanceof Error ? error.message : error);
      return { ok: false, reason: "unavailable" };
    }

    const codes = result["error-codes"] ?? [];
    if (result.success === true) {
      // Cloudflare's test keys answer without an action, so only a different, named action is refused.
      if (action && result.action && result.action !== action) {
        console.warn("turnstile: token for another action", result.action);
        return { ok: false, reason: "rejected" };
      }
      return { ok: true };
    }
    if (codes.includes("internal-error")) {
      if (attempt === 0) continue;
      console.error("turnstile: siteverify internal error");
      return { ok: false, reason: "unavailable" };
    }
    // A wrong secret is our configuration, not the visitor: say so loudly in the logs.
    if (codes.some((code) => code.includes("secret"))) console.error("turnstile: secret key refused", codes);
    return { ok: false, reason: "rejected" };
  }
  return { ok: false, reason: "unavailable" };
}
