"use client";

import { useActionState, useId, useState } from "react";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { closeFinanceMonth, reopenFinanceMonth } from "@/lib/admin/finance/actions";
import { CLOSE_LIMITS } from "@/lib/admin/finance/settings";
import { FormMessage } from "../payroll/FormMessage";

/**
 * "Close <month>": asks first, naming the result the month will be frozen with, then closes it. The database counts
 * the figures itself (close_finance_month); `resultText` only tells the owner what to expect.
 */
export function CloseMonthForm({
  monthStart,
  monthName,
  resultText,
  locale,
}: {
  /** "YYYY-MM-01". */
  monthStart: string;
  monthName: string;
  /** The month's result counted now, as written ("−1 250 000 сум"). */
  resultText: string;
  locale: Locale;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(closeFinanceMonth, {});
  const t = getAdminDictionary(locale);
  const c = t.finance.close;

  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      <input type="hidden" name="month_start" value={monthStart} />
      <FormMessage message={state} pending={pending} />
      <ConfirmDialog
        trigger={c.closeButton(monthName)}
        triggerClassName="adm-btn adm-btn-primary"
        disabled={pending}
        title={c.closeConfirmTitle(monthName)}
        description={c.closeConfirmText(resultText)}
        confirmLabel={c.closeButton(monthName)}
        pendingLabel={c.closing}
        cancelLabel={t.common.cancel}
        pending={pending}
      />
    </form>
  );
}

/**
 * Reopens the latest closed month: a reason (at least CLOSE_LIMITS.reasonMin characters, kept in the close log), then
 * a confirmation. The reason stays typed when the database refuses, and clears after a reopen.
 */
export function ReopenMonthForm({
  monthStart,
  monthName,
  locale,
}: {
  monthStart: string;
  monthName: string;
  locale: Locale;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(reopenFinanceMonth, {});
  const t = getAdminDictionary(locale);
  const c = t.finance.close;
  const id = useId();
  const [reason, setReason] = useState("");

  const [message, setMessage] = useState<FormState>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setMessage(state);
    if (state.ok) setReason("");
  }

  const long = [...reason.trim()].length >= CLOSE_LIMITS.reasonMin;

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="month_start" value={monthStart} />
      <label className="adm-label" htmlFor={`${id}-reason`}>
        {c.reason}
        <textarea
          id={`${id}-reason`}
          name="reason"
          required
          rows={3}
          minLength={CLOSE_LIMITS.reasonMin}
          maxLength={CLOSE_LIMITS.reasonMax}
          placeholder={c.reasonPlaceholder}
          value={reason}
          onChange={(event) => {
            setReason(event.currentTarget.value);
            if (message.ok || message.error) setMessage({});
          }}
          disabled={pending}
          aria-describedby={`${id}-hint`}
          className="adm-input"
        />
        <span id={`${id}-hint`} className="adm-caption font-normal">
          {c.reasonHint(CLOSE_LIMITS.reasonMin)}
        </span>
      </label>
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <FormMessage message={message} pending={pending} />
        <ConfirmDialog
          trigger={c.reopenButton(monthName)}
          triggerClassName="adm-btn adm-btn-outline adm-btn-danger"
          disabled={pending || !long}
          title={c.reopenConfirmTitle(monthName)}
          description={c.reopenConfirmText}
          confirmLabel={c.reopenButton(monthName)}
          pendingLabel={c.reopening}
          cancelLabel={t.common.cancel}
          destructive
          pending={pending}
        />
      </div>
    </form>
  );
}
