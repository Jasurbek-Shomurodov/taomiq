/**
 * Cloudflare Turnstile, shared by the widget (src/components/Turnstile.tsx) and the server check
 * (./verify.ts). Whether the check is on, and the site key the widget uses, are decided on the server
 * (./config.ts): both keys unset, or only one set → no widget and every check passes (demo mode, the e2e build).
 */

/** The hidden input Turnstile adds inside the widget's container; a form posts the token under this name. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

/**
 * The action label each form gives its widget (Turnstile analytics; at most 32 characters of a-z, 0-9, - and _).
 * The order check also compares it, so a token solved on another form is refused there.
 */
export type TurnstileAction = "order" | "email-code" | "admin-login";
