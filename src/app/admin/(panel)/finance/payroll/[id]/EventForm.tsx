"use client";

import { LoaderCircle } from "lucide-react";
import { startTransition, useActionState, useId, useState, type FormEvent } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { addSalaryEvent } from "@/lib/admin/finance/actions";
import { FINANCE_LIMITS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/admin/finance/categories";
import { PAYROLL_LIMITS, SALARY_EVENT_KINDS, type SalaryEventKind } from "@/lib/admin/finance/payroll";
import { FormMessage } from "../FormMessage";

/**
 * A payment, bonus, fine or absence for one person. A payment asks how it was paid, a fine for its reason (required),
 * an absence for the day only. The server checks everything again (addSalaryEvent). After a save the amount and the
 * comment clear; the kind and the date stay, for the next one.
 */
export function EventForm({ employeeId, locale, today }: { employeeId: string; locale: Locale; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addSalaryEvent, {});
  const t = getAdminDictionary(locale);
  const p = t.finance.payroll;
  const id = useId();

  const [kind, setKind] = useState<SalaryEventKind>("payment");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");

  const [message, setMessage] = useState<FormState>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setMessage(state);
    if (state.ok) {
      setAmount("");
      setNote("");
    }
  }

  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      if (message.ok || message.error) setMessage({});
    };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  const isFine = kind === "fine";

  return (
    <form onSubmit={submit} className="grid gap-5">
      <input type="hidden" name="employee_id" value={employeeId} />
      <input type="hidden" name="kind" value={kind} />

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-semibold text-adm-text">{p.kindLabel}</legend>
        <div className="adm-segmented w-full sm:w-auto">
          {SALARY_EVENT_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              disabled={pending}
              onClick={() => edit(setKind)(option)}
            >
              {p.kinds[option]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="adm-label" htmlFor={`${id}-date`}>
          {p.date}
          <input
            id={`${id}-date`}
            type="date"
            name="event_date"
            required
            min={FINANCE_LIMITS.firstDay}
            max={today}
            value={date}
            onChange={(event) => edit(setDate)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input tabular-nums"
          />
        </label>

        {kind !== "absence" && (
          <label className="adm-label" htmlFor={`${id}-amount`}>
            {p.amount}
            <input
              id={`${id}-amount`}
              name="amount"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              required
              maxLength={20}
              placeholder={p.amountPlaceholder}
              value={amount}
              onChange={(event) => edit(setAmount)(event.currentTarget.value)}
              disabled={pending}
              className="adm-input tabular-nums"
            />
          </label>
        )}

        {kind === "payment" && (
          <label className="adm-label" htmlFor={`${id}-method`}>
            {p.method}
            <select
              id={`${id}-method`}
              name="payment_method"
              required
              value={method}
              onChange={(event) => edit(setMethod)(event.currentTarget.value as PaymentMethod)}
              disabled={pending}
              className="adm-input"
            >
              {PAYMENT_METHODS.map((option) => (
                <option key={option} value={option}>
                  {t.finance.methods[option]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="adm-label sm:col-span-2 lg:col-span-3" htmlFor={`${id}-note`}>
          <span>
            {isFine ? p.fineReason : p.note}
            {!isFine && <span className="font-normal text-adm-muted"> ({p.optional})</span>}
          </span>
          <textarea
            id={`${id}-note`}
            name="note"
            rows={2}
            required={isFine}
            maxLength={PAYROLL_LIMITS.noteMax}
            value={note}
            onChange={(event) => edit(setNote)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input"
            data-ph-mask
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <FormMessage message={message} pending={pending} />
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-primary">
          {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {pending ? p.saving : p.eventSubmit[kind]}
        </button>
      </div>
    </form>
  );
}
