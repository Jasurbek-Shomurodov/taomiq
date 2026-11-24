"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDictionary } from "@/i18n";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { site } from "@/lib/site";
import { createSessionClient } from "@/lib/supabase/server";
import { TURNSTILE_FIELD } from "@/lib/turnstile/shared";
import { getCustomer } from "./auth";
import { authMethods, isAccountEnabled, isOAuthMethod, safeNext } from "./methods";
import { syncProfile } from "./profile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[0-9]{6}$/;
const NAME_MAX = 80;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const localeFrom = (value: unknown): Locale => (typeof value === "string" && isLocale(value) ? value : defaultLocale);

/** The login page with a one-sentence error, keeping where the customer wanted to go. */
function loginWithError(locale: Locale, next: string, error: "failed" | "cancelled" | "rate_limited"): never {
  redirect(`/${locale}/login?error=${error}&next=${encodeURIComponent(next)}`);
}

/**
 * Telegram or Google. Supabase prepares the provider URL (PKCE: the code verifier goes into a cookie on
 * this site) and the customer comes back to /auth/callback, which finishes the sign-in.
 * Kept behind this one function so the Telegram flow can be replaced without touching the page
 * (see the plan's risks: Supabase's custom OIDC provider is not yet proven with Telegram).
 */
export async function startOAuth(provider: string, rawLocale: string, rawNext: string): Promise<void> {
  const locale = localeFrom(rawLocale);
  const next = safeNext(rawNext, locale);
  if (!isAccountEnabled || !isOAuthMethod(provider)) loginWithError(locale, next, "failed");

  const callback = new URL("/auth/callback", site.url);
  callback.searchParams.set("locale", locale);
  callback.searchParams.set("next", next);

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider === "telegram" ? "custom:telegram" : "google",
    options: { redirectTo: callback.toString() },
  });
  if (error || !data.url) {
    console.error("account: OAuth start failed", provider, error?.message);
    loginWithError(locale, next, error?.status === 429 ? "rate_limited" : "failed");
  }
  redirect(data.url);
}

export type EmailCodeState = {
  step: "email" | "code";
  email?: string;
  /** Milliseconds since the epoch when the last code was sent, for the 60-second "send again" wait. */
  sentAt?: number;
  error?: string;
};

/** Step 1 of the email sign-in: send a 6-digit code (the Supabase email template prints {{ .Token }}). */
export async function requestEmailCode(prev: EmailCodeState, form: FormData): Promise<EmailCodeState> {
  const locale = localeFrom(form.get("locale"));
  const t = getDictionary(locale).account;
  const email = text(form, "email").toLowerCase();
  if (!isAccountEnabled || !authMethods.includes("email")) return { step: "email", email, error: t.errors.failed };
  if (!EMAIL_RE.test(email) || email.length > 254) return { step: "email", email, error: t.errors.email };

  // Turnstile token from the form, checked by Supabase itself once its CAPTCHA protection is on (ignored until
  // then). Not checked here as well: a token can be redeemed only once. The code check (verifyOtp) and the
  // Google/Telegram redirects take no token: Supabase does not ask for one there.
  const captchaToken = text(form, TURNSTILE_FIELD);
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, ...(captchaToken ? { captchaToken } : {}) },
  });
  if (error) {
    // "Send again" posts from the code step: an error there keeps the customer on it.
    const stay = { step: prev.step, email, sentAt: prev.step === "code" ? prev.sentAt : undefined };
    if (error.code === "captcha_failed") return { ...stay, error: t.errors.captcha };
    const limited = error.status === 429 || error.code === "over_email_send_rate_limit";
    if (!limited) console.error("account: email code send failed", error.code, error.message);
    return { ...stay, error: limited ? t.errors.rateLimited : t.errors.failed };
  }
  return { step: "code", email, sentAt: Date.now() };
}

/** Step 2: check the code. Signed in → profile sync → on to `next`. */
export async function verifyEmailCode(_prev: EmailCodeState, form: FormData): Promise<EmailCodeState> {
  const locale = localeFrom(form.get("locale"));
  const next = safeNext(text(form, "next"), locale);
  const t = getDictionary(locale).account;
  const email = text(form, "email").toLowerCase();
  const sentAt = Number(form.get("sentAt")) || undefined;
  const token = text(form, "code").replace(/\s/g, "");
  if (!isAccountEnabled || !authMethods.includes("email") || !EMAIL_RE.test(email)) {
    return { step: "email", email, error: t.errors.failed };
  }
  if (!CODE_RE.test(token)) return { step: "code", email, sentAt, error: t.errors.code };

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) {
    const limited = error?.status === 429;
    if (error && !limited && error.code !== "otp_expired") {
      console.error("account: email code check failed", error.code, error.message);
    }
    return { step: "code", email, sentAt, error: limited ? t.errors.rateLimited : t.errors.wrongCode };
  }

  await syncProfile(data.user.id, locale);
  redirect(next);
}

export type ProfileState = { error?: string; ok?: string };

/** The customer's own name. RLS and the column grant (migration 0006) allow only name and locale on their own row. */
export async function updateProfile(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const locale = localeFrom(form.get("locale"));
  const t = getDictionary(locale).account;
  const customer = await getCustomer();
  if (!customer) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account`)}`);

  const name = text(form, "name").replace(/\s+/g, " ");
  if (name.length > NAME_MAX) return { error: t.nameTooLong };

  const supabase = await createSessionClient();
  const { data, error } = await supabase.from("profiles").update({ name }).eq("id", customer.id).select("id");
  if (error || !data?.length) {
    console.error("account: name save failed", error?.message ?? "no row");
    return { error: t.saveFailed };
  }
  refresh();
  return { ok: t.saved };
}

/** Ends the session on this device and clears its auth cookies. */
async function endSession(): Promise<void> {
  if (!isAccountEnabled) return;
  const supabase = await createSessionClient();
  // This device only: the default ("global") would also end the customer's other devices and,
  // for staff signed in with the same account, their back-office session.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.error("account: sign out failed", error.message);
}

/**
 * Sign-out by the plain form post (before the page has hydrated): the redirect is then a full page load already.
 * With JavaScript the button calls signOutOnly instead and leaves the page itself (SignOutButton): a redirect from an
 * action called by the client is a client-side navigation, which would keep the account page in the document.
 */
export async function signOut(rawLocale: string): Promise<void> {
  const locale = localeFrom(rawLocale);
  await endSession();
  redirect(`/${locale}`);
}

/** Sign-out for the button's JavaScript path: no redirect; the browser then loads the home page as a new document. */
export async function signOutOnly(): Promise<void> {
  await endSession();
}
