"use client";

import { useActionState, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { saveOrderNote, setOrderStatus, type FormState } from "@/lib/admin/actions";
import { NEXT_STATUS, STAFF_NOTE_MAX, canCancel, hasNextStatus, type OrderStatus } from "@/lib/admin/orders";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";

function Result({ state }: { state: FormState }) {
  if (state.ok) return <p role="status" className="text-sm text-adm-positive">{state.ok}</p>;
  if (state.error) return <p role="alert" className="text-sm text-adm-negative">{state.error}</p>;
  return null;
}

export function StatusControls({ id, status, locale }: { id: string; status: OrderStatus; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setOrderStatus, {});
  const t = getAdminDictionary(locale);
  const next = hasNextStatus(status) ? { to: NEXT_STATUS[status], action: t.orders.nextAction[status] } : null;
  const cancellable = canCancel(status);

  return (
    <section className="adm-panel">
      <h2 className="adm-heading">{t.order.status}</h2>
      {!next && !cancellable ? (
        <p className="adm-muted mt-3">{t.order.closed}</p>
      ) : (
        <div className="mt-3 grid gap-2">
          {next && (
            <form action={action}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="from" value={status} />
              <input type="hidden" name="to" value={next.to} />
              <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-primary w-full">
                {pending ? t.common.saving : next.action}
              </button>
            </form>
          )}
          {cancellable && (
            <form action={action}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="from" value={status} />
              <input type="hidden" name="to" value="cancelled" />
              <ConfirmDialog
                trigger={t.order.cancel}
                triggerClassName="adm-btn adm-btn-outline adm-btn-danger w-full"
                disabled={pending}
                title={t.order.cancelTitle}
                description={t.order.cancelText}
                confirmLabel={t.order.cancel}
                pendingLabel={t.common.saving}
                cancelLabel={t.order.cancelKeep}
                destructive
                pending={pending}
              />
            </form>
          )}
        </div>
      )}
      <div className="mt-3" aria-live="polite">
        <Result state={state} />
      </div>
    </section>
  );
}

export function NoteForm({ id, note, locale }: { id: string; note: string; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveOrderNote, {});
  const t = getAdminDictionary(locale);
  // Controlled, so the text survives React's form reset when saving fails.
  const [value, setValue] = useState(note);

  return (
    <form action={action} className="adm-panel">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="staff_note" className="adm-heading block">
        {t.order.note}
      </label>
      <textarea
        id="staff_note"
        name="staff_note"
        rows={5}
        maxLength={STAFF_NOTE_MAX}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t.order.notePlaceholder}
        className="adm-input mt-3"
      />
      <p className="adm-caption mt-1">{t.order.noteHidden}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-primary">
          {pending ? t.common.saving : t.common.save}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}
