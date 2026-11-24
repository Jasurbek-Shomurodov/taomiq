"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { GoogleIcon } from "@/components/GoogleIcon";
import { Turnstile } from "@/components/Turnstile";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { signIn, signInWithGoogle, type FormState } from "@/lib/admin/actions";

type T = AdminDictionary["login"];

/**
 * Sign-in for staff. With Google switched on (ADMIN_GOOGLE_LOGIN, src/lib/admin/google.ts): the Google button
 * first, an "or" divider, then email and password. Switched off: the email and password form alone.
 * Two separate forms, since forms cannot nest. Neither path grants access by itself: both check the staff table,
 * record anyone else as an access request and send them back here with ?error=requested (or ?error=not-staff when
 * they were declined or the request could not be stored).
 */
export function LoginForm({ locale, turnstileKey, google }: { locale: Locale; turnstileKey: string; google: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  const t = getAdminDictionary(locale).login;
  // Notices that arrive in the address (a refused or failed Google sign-in, or a signed-in account that is not
  // staff) sit above the first button: the Google one when it is shown, otherwise "Sign in".
  const redirectNotice = (
    <Suspense>
      <RedirectNotice t={t} />
    </Suspense>
  );

  return (
    <div className="mt-8 grid gap-6">
      {google && (
        <>
          <form action={signInWithGoogle} className="grid gap-4">
            {redirectNotice}
            <GoogleButton label={t.google} pendingLabel={t.redirecting} />
          </form>
          <div className="label flex items-center gap-4 text-adm-muted" aria-hidden>
            <span className="h-px flex-1 bg-adm-border" />
            {t.or}
            <span className="h-px flex-1 bg-adm-border" />
          </div>
        </>
      )}

      <form action={action} className="grid gap-5">
        <label className="grid gap-2 text-sm font-medium text-adm-brand-ink">
          {t.email}
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            className="field min-h-12 font-normal focus:ring-2 focus:ring-adm-highlight"
          />
        </label>
        <PasswordField t={t} />

        {/* Bot check: invisible unless Cloudflare asks for a click; each answer from the server starts a fresh one. */}
        <Turnstile siteKey={turnstileKey} action="admin-login" locale={locale} resetKey={state} />

        <div className="mt-1 grid gap-4">
          {!google && redirectNotice}
          {state.error && <Notice text={state.error} />}
          <button type="submit" disabled={pending} className="btn min-h-12 w-full bg-adm-accent text-adm-on-accent hover:bg-(--adm-accent-hover) disabled:opacity-60">
            {pending ? t.submitting : t.submit}
          </button>
        </div>
      </form>
    </div>
  );
}

function GoogleButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  // Back from Google's account picker can restore this page from the browser's back/forward cache with the
  // button still pending (the redirecting action never finishes): load the page fresh instead.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-outline min-h-12 w-full border-adm-border bg-adm-surface text-adm-brand-ink hover:bg-adm-hover disabled:opacity-60"
    >
      <GoogleIcon />
      {pending ? pendingLabel : label}
    </button>
  );
}

/**
 * Password with a show/hide toggle. The toggle keeps one accessible name ("Show password") and reports its state
 * with aria-pressed; the tooltip says what a press will do. It is a plain button (type="button"), after the input
 * in tab order, 44 px square.
 */
function PasswordField({ t }: { t: T }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-2">
      <label htmlFor="admin-password" className="text-sm font-medium text-adm-brand-ink">
        {t.password}
      </label>
      <div className="relative">
        <input
          id="admin-password"
          name="password"
          type={visible ? "text" : "password"}
          required
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="field min-h-12 pr-13 font-normal focus:ring-2 focus:ring-adm-highlight"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={t.showPassword}
          aria-pressed={visible}
          title={visible ? t.hidePassword : t.showPassword}
          className="press absolute right-0.5 top-1/2 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-adm-muted hover:text-adm-brand-ink"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function RedirectNotice({ t }: { t: T }) {
  const error = useSearchParams().get("error");
  if (error === "requested") return <Notice text={t.requested} tone="info" />;
  if (error === "not-staff") return <Notice text={t.notStaff} />;
  if (error === "google") return <Notice text={t.googleFailed} />;
  return null;
}

/** An error (red, announced at once) or, with tone "info", a neutral note such as "request sent". */
function Notice({ text, tone = "error" }: { text: string; tone?: "error" | "info" }) {
  const info = tone === "info";
  return (
    <p
      role={info ? "status" : "alert"}
      className={`flex items-start gap-2.5 rounded-xl p-3 text-sm ${info ? "bg-adm-accent/8 text-adm-accent-ink" : "bg-adm-negative/10 text-adm-negative"}`}
    >
      <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-px shrink-0">
        <circle cx="12" cy="12" r="9.5" />
        {info ? (
          <>
            <path d="M12 11v5.5" strokeLinecap="round" />
            <circle cx="12" cy="7.5" r="0.6" fill="currentColor" />
          </>
        ) : (
          <>
            <path d="M12 7.5v5.5" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="0.6" fill="currentColor" />
          </>
        )}
      </svg>
      <span>{text}</span>
    </p>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.3 6.9C3.9 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.4-.5 4.7-1.3" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
