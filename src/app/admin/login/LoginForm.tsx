"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { signIn, type FormState } from "@/lib/admin/actions";

function NotStaffNotice() {
  const params = useSearchParams();
  if (params.get("error") !== "not-staff") return null;
  return (
    <p role="alert" className="mt-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
      У этой учётной записи нет доступа к панели. Обратитесь к владельцу.
    </p>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(signIn, {});

  return (
    <form action={action} className="mt-6 grid gap-4">
      <label className="grid gap-1.5 text-sm font-semibold text-forest">
        Почта
        <input name="email" type="email" required autoComplete="username" className="field font-normal" />
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-forest">
        Пароль
        <input name="password" type="password" required autoComplete="current-password" className="field font-normal" />
      </label>

      <Suspense>
        <NotStaffNotice />
      </Suspense>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-forest mt-2 disabled:opacity-60">
        {pending ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}
