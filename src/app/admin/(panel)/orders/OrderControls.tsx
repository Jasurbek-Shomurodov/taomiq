"use client";

import { useActionState, useState } from "react";
import { saveOrderNote, setOrderStatus, type FormState } from "@/lib/admin/actions";
import { NEXT_STATUS, STAFF_NOTE_MAX, canCancel, type OrderStatus } from "@/lib/admin/orders";

function Result({ state }: { state: FormState }) {
  if (state.ok) return <p role="status" className="text-sm text-forest">{state.ok}</p>;
  if (state.error) return <p role="alert" className="text-sm text-danger">{state.error}</p>;
  return null;
}

export function StatusControls({ id, status }: { id: string; status: OrderStatus }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setOrderStatus, {});
  const next = NEXT_STATUS[status];
  const cancellable = canCancel(status);

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h2 className="label text-muted">Статус</h2>
      {!next && !cancellable ? (
        <p className="mt-3 text-sm text-muted">Заказ закрыт, статус больше не меняется.</p>
      ) : (
        <div className="mt-3 grid gap-2">
          {next && (
            <form action={action}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="from" value={status} />
              <input type="hidden" name="to" value={next.to} />
              <button type="submit" disabled={pending} className="btn btn-forest w-full !py-2.5 disabled:opacity-60">
                {pending ? "Сохраняем…" : next.action}
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
                  if (!window.confirm("Отменить заказ? Вернуть его в работу будет нельзя.")) event.preventDefault();
                }}
                className="btn btn-outline w-full !py-2.5 text-danger disabled:opacity-60"
              >
                Отменить заказ
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

export function NoteForm({ id, note }: { id: string; note: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveOrderNote, {});
  // Controlled, so the text survives React's form reset when saving fails.
  const [value, setValue] = useState(note);

  return (
    <form action={action} className="rounded-2xl border border-line bg-white p-5">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="staff_note" className="label text-muted">
        Заметка для команды
      </label>
      <textarea
        id="staff_note"
        name="staff_note"
        rows={5}
        maxLength={STAFF_NOTE_MAX}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Договорились о времени, способ оплаты, особенности адреса…"
        className="field mt-2"
      />
      <p className="mt-1 text-xs text-muted">Клиент эту заметку не видит.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-forest !py-2.5 disabled:opacity-60">
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}
