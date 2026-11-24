"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { signOut, signOutOnly, updateProfile, type ProfileState } from "@/lib/account/actions";
import type { AuthMethod } from "@/lib/account/methods";
import { identifyUser, resetAnalytics } from "@/lib/analytics/client";

type T = Dictionary["account"];

/** The customer's name (the only profile field they edit; phone comes from Telegram, email from sign-in). */
export function NameForm({ locale, name, t }: { locale: Locale; name: string; t: T }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateProfile, {});
  return (
    <form action={action} className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <input type="hidden" name="locale" value={locale} />
      <div>
        <label htmlFor="account-name" className="label text-muted">
          {t.name}
        </label>
        <input
          id="account-name"
          name="name"
          maxLength={80}
          autoComplete="name"
          defaultValue={name}
          aria-describedby="account-name-status"
          className="field mt-2"
        />
      </div>
      <button type="submit" disabled={pending} className="btn btn-forest min-h-12 disabled:opacity-60">
        {pending ? t.saving : t.save}
      </button>
      <p
        id="account-name-status"
        role={state.error ? "alert" : "status"}
        className={`text-sm sm:col-span-2 ${state.error ? "font-semibold text-danger" : "text-muted"}`}
      >
        {state.error ?? state.ok ?? ""}
      </p>
    </form>
  );
}

/**
 * Analytics on the account page (renders nothing): ties this browser to the customer by their user id, and sends
 * signed_in when the browser was not this customer yet. A no-op without PostHog (src/lib/analytics/client.ts).
 * Once per sign-in: the page kept by Next.js and shown again (browser Back) does nothing, also after a sign-out.
 */
export function AccountAnalytics({
  userId,
  signedInAt,
  method,
  locale,
}: {
  userId: string;
  signedInAt: string;
  method: AuthMethod | null;
  locale: Locale;
}) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    const key = `${userId}|${signedInAt}`;
    if (done.current === key) return;
    done.current = key;
    identifyUser(userId, signedInAt, { method: method ?? "unknown", locale });
  }, [userId, signedInAt, method, locale]);
  return null;
}

/** How long sign-out waits for the browser to leave the page before it tries again (a stopped or stuck load). */
const LEAVE_TIMEOUT_MS = 8000;

/** True once the browser starts unloading the page (pagehide), false if it is still here after `ms`. */
function pageLeftWithin(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (left: boolean) => {
      window.removeEventListener("pagehide", onHide);
      clearTimeout(timer);
      resolve(left);
    };
    const onHide = () => finish(true);
    const timer = setTimeout(() => finish(false), ms);
    window.addEventListener("pagehide", onHide);
  });
}

/**
 * Sign-out ends with a full page load that replaces the account page's history entry, never with a client-side
 * navigation: Next.js keeps recently shown routes mounted but hidden (Cache Components, React <Activity>), and a page
 * loaded first keeps its server payload in inline scripts for the life of the document. After a soft navigation the
 * customer's name, phone, email and orders would stay in the document, readable on a shared device and shown again
 * for a moment on Back. A new document drops all of it, and Back goes to the page before the account page.
 */
export function SignOutButton({ locale, t }: { locale: Locale; t: T }) {
  // A browser that restores this page from its back/forward cache despite no-store (older Safari): load it again,
  // so the server decides (signed out → the login page). Only while the account page is mounted.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // The analytics id is forgotten on this browser, so whoever uses it next is a new anonymous visitor.
    resetAnalytics();
    // With JavaScript: not the form's own action, whose redirect would be a client-side navigation (see above).
    // The transition keeps the button in its "signing out" state (useFormStatus) until the browser leaves the page.
    event.preventDefault();
    startTransition(async () => {
      try {
        await signOutOnly();
      } catch {
        // Network error: the cookies may be unchanged, but the new page load shows whatever the server says.
      }
      window.location.replace(`/${locale}`);
      if (!(await pageLeftWithin(LEAVE_TIMEOUT_MS))) {
        // The load was stopped (Stop, Esc) or is stuck: once more. Stopped again → the page is handed back.
        window.location.replace(`/${locale}`);
        if (!(await pageLeftWithin(LEAVE_TIMEOUT_MS))) return;
      }
      // The page is going away: never settle, so nothing on it renders again in the meantime.
      await new Promise<never>(() => {});
    });
  }

  return (
    // Before hydration the plain form post still signs out: the action, then its redirect (a full page load).
    <form action={signOut.bind(null, locale)} onSubmit={onSubmit}>
      <SignOutSubmit t={t} />
    </form>
  );
}

function SignOutSubmit({ t }: { t: T }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-outline min-h-12 w-full text-forest disabled:opacity-60 sm:w-auto">
      {pending ? t.signingOut : t.signOut}
    </button>
  );
}
