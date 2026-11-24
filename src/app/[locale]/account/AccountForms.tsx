"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { signOut, updateProfile, type ProfileState } from "@/lib/account/actions";
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

export function SignOutButton({ locale, t }: { locale: Locale; t: T }) {
  return (
    // onSubmit runs before the action: the analytics id is forgotten on this browser, so whoever uses it next is a
    // new anonymous visitor. Before hydration the form still signs out (the action alone).
    <form action={signOut.bind(null, locale)} onSubmit={() => resetAnalytics()}>
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
