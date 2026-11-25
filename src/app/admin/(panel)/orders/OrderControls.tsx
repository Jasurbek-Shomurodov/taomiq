"use client";

import { useActionState, useId, useState } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { saveOrderNote, setOrderStatus, type FormState } from "@/lib/admin/actions";
import { changePaymentMethod } from "@/lib/admin/order-actions";
import {
  CANCEL_REASON_MAX,
  CANCEL_REASON_MIN,
  NEXT_STATUS,
  PAYMENT_METHODS,
  STAFF_NOTE_MAX,
  canCancel,
  hasNextStatus,
  isCancelReason,
  type OrderStatus,
  type PaymentMethod,
} from "@/lib/admin/orders";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";

function Result({ state }: { state: FormState }) {
  if (state.ok) return <p role="status" className="text-sm text-adm-positive">{state.ok}</p>;
  if (state.error) return <p role="alert" className="text-sm text-adm-negative">{state.error}</p>;
  return null;
}

/**
 * The three payment methods, one 44 px row each. Rendered inside a confirmation dialog, which sits outside the form:
 * the value lives in the caller's state and reaches the form as a hidden field (as the Team screen's role chooser).
 */
function MethodChoice({
  value,
  onChange,
  disabled,
  t,
}: {
  value: PaymentMethod | null;
  onChange: (method: PaymentMethod) => void;
  disabled: boolean;
  t: AdminDictionary;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold text-adm-text">{t.order.methodLegend}</legend>
      {PAYMENT_METHODS.map((method) => (
        <label
          key={method}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-adm-btn border border-adm-border px-3 py-2.5 has-checked:border-adm-accent has-checked:bg-adm-accent-tint has-disabled:cursor-default"
        >
          <input
            type="radio"
            name={name}
            value={method}
            checked={value === method}
            onChange={() => onChange(method)}
            className="size-4 shrink-0 accent-adm-accent"
          />
          <span className="text-sm font-semibold text-adm-text">{t.finance.methods[method]}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The status column: the one forward step and Cancel. Marking an order paid asks how it was paid; cancelling asks for
 * the reason, and its confirm button names the action. Other steps go at once.
 */
export function StatusControls({
  id,
  status,
  total,
  locale,
}: {
  id: string;
  status: OrderStatus;
  /** The order's total, formatted, for the mark-paid question. */
  total: string;
  locale: Locale;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(setOrderStatus, {});
  const t = getAdminDictionary(locale);
  const next = hasNextStatus(status) ? { to: NEXT_STATUS[status], action: t.orders.nextAction[status] } : null;
  const cancellable = canCancel(status);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const reasonHintId = useId();

  return (
    <section className="adm-panel">
      <h2 className="adm-heading">{t.order.status}</h2>
      {!next && !cancellable ? (
        <p className="adm-muted mt-3">{t.order.closed}</p>
      ) : (
        <div className="mt-3 grid gap-2">
          {next && next.to === "paid" && (
            <form action={action}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="from" value={status} />
              <input type="hidden" name="to" value="paid" />
              <input type="hidden" name="payment_method" value={method ?? ""} />
              <ConfirmDialog
                trigger={pending ? t.common.saving : next.action}
                triggerClassName="adm-btn adm-btn-primary w-full"
                disabled={pending}
                title={t.order.markPaidTitle}
                description={t.order.markPaidText(total)}
                confirmLabel={next.action}
                pendingLabel={t.common.saving}
                cancelLabel={t.common.cancel}
                pending={pending}
                onOpen={() => setMethod(null)}
                confirmDisabled={method === null}
              >
                <MethodChoice value={method} onChange={setMethod} disabled={pending} t={t} />
              </ConfirmDialog>
            </form>
          )}
          {next && next.to !== "paid" && (
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
              <input type="hidden" name="cancel_reason" value={reason} />
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
                onOpen={() => setReason("")}
                confirmDisabled={!isCancelReason(reason)}
              >
                <label htmlFor={reasonId} className="adm-label">
                  {t.order.cancelReason}
                  <textarea
                    id={reasonId}
                    rows={3}
                    maxLength={CANCEL_REASON_MAX}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    disabled={pending}
                    placeholder={t.order.cancelReasonPlaceholder}
                    aria-describedby={reasonHintId}
                    className="adm-input font-normal"
                  />
                  <span id={reasonHintId} className="adm-caption font-normal">
                    {t.order.cancelReasonHint(CANCEL_REASON_MIN)}
                  </span>
                </label>
              </ConfirmDialog>
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

/**
 * The payment method of a paid (delivering, completed) order and the button that sets or changes it. The change asks
 * which method in a dialog; the database records it in the order's history.
 */
export function PaymentMethodControl({
  id,
  method,
  locale,
}: {
  id: string;
  method: PaymentMethod | null;
  locale: Locale;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(changePaymentMethod, {});
  const t = getAdminDictionary(locale);
  const [choice, setChoice] = useState<PaymentMethod | null>(method);

  return (
    <div className="grid gap-1">
      <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="from" value={method ?? ""} />
        <input type="hidden" name="payment_method" value={choice ?? ""} />
        <span className={method ? "text-adm-text" : "text-adm-muted"}>
          {method ? t.finance.methods[method] : t.order.noPaymentMethod}
        </span>
        <ConfirmDialog
          trigger={method ? t.order.changeMethod : t.order.setMethod}
          triggerClassName="adm-btn adm-btn-outline adm-btn-sm"
          disabled={pending}
          title={t.order.changeMethodTitle}
          description={t.order.changeMethodText}
          confirmLabel={t.common.save}
          pendingLabel={t.common.saving}
          cancelLabel={t.common.cancel}
          pending={pending}
          onOpen={() => setChoice(method)}
          confirmDisabled={choice === null || choice === method}
        >
          <MethodChoice value={choice} onChange={setChoice} disabled={pending} t={t} />
        </ConfirmDialog>
      </form>
      <div aria-live="polite">
        <Result state={state} />
      </div>
    </div>
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
