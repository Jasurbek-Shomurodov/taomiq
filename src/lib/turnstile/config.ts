import "server-only";

/**
 * Whether the Turnstile bot check is on, decided once, on the server, for the widget and the check alike.
 *
 * It is on only when both keys are set. Half a configuration (exactly one key) counts as off on both sides:
 *  - secret without site key: no widget could produce a token, so a check would refuse every order;
 *  - site key without secret: a widget would show with no check of ours behind it (for the order form), or hand
 *    Supabase a token it may not check either (for the sign-in forms). A widget that guards nothing is worse than
 *    none: it looks like protection, loads Cloudflare's script and can still ask the visitor to click.
 * The browser only ever sees the public key, so it cannot tell a half configuration from a whole one by itself.
 * The pages therefore never read the key in the browser: each server page passes `turnstileWidgetKey` (empty when
 * the check is off) down to the form's <Turnstile>, so the widget shows exactly when this server checks.
 *
 * Supabase's own CAPTCHA (Authentication → Attack Protection) must stay off unless both keys are set here: with it
 * on and the check off, the email-code sign-in and the back-office login would refuse everyone.
 */
const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
/** Server-only secret (Cloudflare → Turnstile → the widget → Settings). Never NEXT_PUBLIC_. */
export const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY ?? "";

export const isTurnstileConfigured = Boolean(siteKey && turnstileSecretKey);

/** The site key for the widget, or "" when the check is off (no widget then). */
export const turnstileWidgetKey = isTurnstileConfigured ? siteKey : "";

// One warning per server process (module scope runs once; the flag also survives dev reloads), not per request.
const warned = globalThis as { __taomiqTurnstileHalfWarned?: boolean };
if (Boolean(siteKey) !== Boolean(turnstileSecretKey) && !warned.__taomiqTurnstileHalfWarned) {
  warned.__taomiqTurnstileHalfWarned = true;
  console.warn(
    `turnstile: only ${siteKey ? "NEXT_PUBLIC_TURNSTILE_SITE_KEY" : "TURNSTILE_SECRET_KEY"} is set; ` +
      `the bot check is OFF (no widget, no check) until ${siteKey ? "TURNSTILE_SECRET_KEY" : "NEXT_PUBLIC_TURNSTILE_SITE_KEY"} is set too.`,
  );
}
