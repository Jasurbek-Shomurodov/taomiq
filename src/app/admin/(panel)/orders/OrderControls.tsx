"use client";

import { useActionState, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { saveOrderNote, setOrderStatus, type FormState } from "@/lib/admin/actions";
import { NEXT_STATUS, STAFF_NOTE_MAX, canCancel, hasNextStatus, type OrderStatus } from "@/lib/admin/orders";

function Result({ state }: { state: FormState }) {
  if (state.ok) return <p role="status" className="text-sm text-forest">{state.ok}</p>;
  if (state.error) return <p role="alert" className="text-sm text-danger">{state.error}</p>;
  return null;
}

export function StatusControls({ id, status, locale }: { id: string; status: OrderStatus; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setOrderStatus, {});
  const t = getAdminDictionary(locale);
  const next = hasNextStatus(status) ? { to: NEXT_STATUS[status], action: t.orders.nextAction[status] } : null;
  const cancellable = canCancel(status);

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h2 className="label text-muted">{t.order.status}</h2>
      {!next && !cancellable ? (
        <p className="mt-3 text-sm text-muted">{t.order.closed}</p>
      ) : (
        <div className="mt-3 grid gap-2">
          {next && (
            <form action={action}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="from" value={status} />
              <input type="hidden" name="to" value={next.to} />
              <button type="submit" disabled={pending} className="btn btn-forest w-full !py-2.5 disabled:opacity-60">
                {pending ? t.common.saving : next.action}
              </button>
            </form>
          )}
          {cancellable && (
            <form action={action}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="from" value={status} />
              <input type="hidden" name="to" value="cancelled" />
              <button
                type="submit"
                disabled={pending}
                onClick={(event) => {
                  if (!window.confirm(t.order.cancelConfirm)) event.preventDefault();
                }}
                className="btn btn-outline w-full !py-2.5 text-danger disabled:opacity-60"
              >
                {t.order.cancel}
              </button>
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
    <form action={action} className="rounded-2xl border border-line bg-white p-5">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="staff_note" className="label text-muted">
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
        className="field mt-2"
      />
      <p className="mt-1 text-xs text-muted">{t.order.noteHidden}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-forest !py-2.5 disabled:opacity-60">
          {pending ? t.common.saving : t.common.save}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}
