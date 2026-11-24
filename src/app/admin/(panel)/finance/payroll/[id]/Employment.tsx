"use client";

import { useActionState, useId, useState } from "react";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { endEmployment, resumeEmployment } from "@/lib/admin/finance/actions";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { FormMessage } from "../FormMessage";

/**
 * A person's employment: while they work, their last working day and "Record leaving" (asked first); once they have
 * left, "Back on staff" (asked first, since pay then runs again from the day after the old end).
 */
export function Employment({
  employeeId,
  name,
  joinedAt,
  endedAt,
  locale,
  today,
}: {
  employeeId: string;
  name: string;
  joinedAt: string;
  endedAt: string | null;
  locale: Locale;
  today: string;
}) {
  return endedAt ? (
    <Resume employeeId={employeeId} locale={locale} />
  ) : (
    <End employeeId={employeeId} name={name} joinedAt={joinedAt} locale={locale} today={today} />
  );
}

function End({
  employeeId,
  name,
  joinedAt,
  locale,
  today,
}: {
  employeeId: string;
  name: string;
  joinedAt: string;
  locale: Locale;
  today: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(endEmployment, {});
  const t = getAdminDictionary(locale);
  const p = t.finance.payroll;
  const id = useId();
  const [day, setDay] = useState(today);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="employee_id" value={employeeId} />
      <label className="adm-label max-w-xs" htmlFor={`${id}-ended`}>
        {p.endedAt}
        <input
          id={`${id}-ended`}
          type="date"
          name="ended_at"
          required
          min={joinedAt}
          max={today}
          value={day}
          onChange={(event) => setDay(event.currentTarget.value)}
          disabled={pending}
          className="adm-input tabular-nums"
        />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <FormMessage message={state} pending={pending} />
        <ConfirmDialog
          trigger={p.endSubmit}
          triggerClassName="adm-btn adm-btn-outline adm-btn-danger"
          disabled={pending || !day}
          title={p.endConfirmTitle}
          description={<span data-ph-mask>{p.endConfirmText(name, day ? formatEntryDay(day, locale) : "")}</span>}
          confirmLabel={p.endSubmit}
          pendingLabel={p.saving}
          cancelLabel={t.common.cancel}
          destructive
          pending={pending}
        />
      </div>
    </form>
  );
}

function Resume({ employeeId, locale }: { employeeId: string; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(resumeEmployment, {});
  const t = getAdminDictionary(locale);
  const p = t.finance.payroll;

  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      <input type="hidden" name="employee_id" value={employeeId} />
      <FormMessage message={state} pending={pending} />
      <ConfirmDialog
        trigger={p.resume}
        triggerClassName="adm-btn adm-btn-outline"
        disabled={pending}
        title={p.resumeConfirmTitle}
        description={p.resumeConfirmText}
        confirmLabel={p.resume}
        pendingLabel={p.saving}
        cancelLabel={t.common.cancel}
        pending={pending}
      />
    </form>
  );
}
