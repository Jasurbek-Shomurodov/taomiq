import { isLocale, type Locale } from "@/i18n/config";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** The ways a customer can sign in, in the order the login page shows them (Telegram first). */
export const AUTH_METHODS = ["telegram", "google", "email"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];
export type OAuthMethod = Exclude<AuthMethod, "email">;

/**
 * The sign-in methods switched on for this deployment: NEXT_PUBLIC_AUTH_METHODS, a comma list of
 * telegram, google, email (e.g. "telegram,google,email"). Unknown names are ignored. Read literally so
 * Next inlines it into client bundles as well.
 */
const configured = (process.env.NEXT_PUBLIC_AUTH_METHODS ?? "")
  .split(",")
  .map((method) => method.trim().toLowerCase());

export const authMethods: AuthMethod[] = isSupabaseConfigured
  ? AUTH_METHODS.filter((method) => configured.includes(method))
  : [];

/**
 * False when no method is switched on (or Supabase is not connected, as in demo mode and the e2e build):
 * there is then no login link anywhere, and /login, /account and /auth/callback are not served.
 */
export const isAccountEnabled = authMethods.length > 0;

export function isOAuthMethod(value: string): value is OAuthMethod {
  return (value === "telegram" || value === "google") && (authMethods as string[]).includes(value);
}

/**
 * Where to send the customer after signing in. Only a same-site path that starts with a single "/"
 * followed by a site locale is accepted ("/uz/order?program=balance"); anything else (another host,
 * "//evil", "/\\evil", "/admin", control characters) falls back to the account page.
 */
export function safeNext(value: string | null | undefined, locale: Locale): string {
  const fallback = `/${locale}/account`;
  if (!value || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  // Control characters and spaces (a browser strips tabs/newlines from URLs, which could re-open "//").
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return fallback;
  }
  const first = value.slice(1).split(/[/?#]/, 1)[0];
  if (!isLocale(first)) return fallback;
  return value;
}
