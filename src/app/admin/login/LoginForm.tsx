"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { Turnstile } from "@/components/Turnstile";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { signIn, type FormState } from "@/lib/admin/actions";

function NotStaffNotice({ text }: { text: string }) {
  const params = useSearchParams();
  if (params.get("error") !== "not-staff") return null;
  return (
    <p role="alert" className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
      {text}
    </p>
  );
}

export function LoginForm({ locale }: { locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});
  const t = getAdminDictionary(locale).login;

  return (
    <form action={action} className="mt-6 grid gap-4">
      <label className="grid gap-1.5 text-sm font-semibold text-forest">
        {t.email}
        <input name="email" type="email" required autoComplete="username" className="field font-normal" />
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-forest">
        {t.password}
        <input name="password" type="password" required autoComplete="current-password" className="field font-normal" />
      </label>

      {/* Bot check: invisible unless Cloudflare asks for a click; each answer from the server starts a fresh one. */}
      <Turnstile action="admin-login" locale={locale} resetKey={state} />

      <Suspense>
        <NotStaffNotice text={t.notStaff} />
      </Suspense>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-forest mt-2 disabled:opacity-60">
        {pending ? t.submitting : t.submit}
      </button>
    </form>
  );
}
