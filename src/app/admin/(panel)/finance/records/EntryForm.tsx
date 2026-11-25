"use client";

import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { addFinanceEntry } from "@/lib/admin/finance/actions";
import {
  ENTRY_KINDS,
  EXPENSE_CATEGORIES,
  FINANCE_LIMITS,
  PAYMENT_METHODS,
  type EntryKind,
  type ExpenseCategory,
  type PaymentMethod,
} from "@/lib/admin/finance/categories";
import { formatEntryDay } from "@/lib/admin/finance/month";
import { backdateEarliest } from "@/lib/admin/finance/settings";

/**
 * One record of the ledger: what it is (expense, investor money, other income), the date, the category (expenses
 * only), how it was paid, the amount, who was paid or who paid, and a comment. The server checks everything again
 * (addFinanceEntry). Every field is held in state and the form is submitted by hand, so a refused save keeps what was
 * typed; after a save the amount, the name and the comment clear and the rest stays, for the next record of the
 * same day.
 */
export function EntryForm({
  locale,
  today,
  backdateDays,
}: {
  locale: Locale;
  today: string;
  /** How many days back a record may be dated (finance_backdate_days); null when unknown (the database still checks). */
  backdateDays: number | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addFinanceEntry, {});
  const t = getAdminDictionary(locale);
  const r = t.finance.records;
  const id = useId();
  const amountRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<EntryKind>("expense");
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState<ExpenseCategory | "">("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [note, setNote] = useState("");

  // The message under the form: the last save's outcome, until a field changes again. A new state from the action
  // replaces it; a saved record clears the fields that differ from one record to the next.
  const [message, setMessage] = useState<FormState>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setMessage(state);
    if (state.ok) {
      setAmount("");
      setCounterparty("");
      setNote("");
    }
  }
  // After a saved record, the amount is where the next one starts.
  useEffect(() => {
    if (state.ok) amountRef.current?.focus();
  }, [state]);

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

  const isExpense = kind === "expense";
  const earliest = backdateDays === null ? FINANCE_LIMITS.firstDay : backdateEarliest(today, backdateDays);
  const counterpartyRequired = kind === "investor";

  return (
    <form onSubmit={submit} className="grid gap-5">
      <input type="hidden" name="kind" value={kind} />

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-semibold text-adm-text">{r.kind}</legend>
        <div className="adm-segmented w-full sm:w-auto">
          {ENTRY_KINDS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              disabled={pending}
              onClick={() => edit(setKind)(option)}
            >
              {t.finance.kinds[option]}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="adm-label" htmlFor={`${id}-date`}>
          {r.date}
          <input
            id={`${id}-date`}
            type="date"
            name="entry_date"
            required
            min={earliest}
            max={today}
            value={date}
            onChange={(event) => edit(setDate)(event.currentTarget.value)}
            disabled={pending}
            aria-describedby={backdateDays === null ? undefined : `${id}-date-hint`}
            className="adm-input tabular-nums"
          />
          {backdateDays !== null && (
            <span id={`${id}-date-hint`} className="adm-caption font-normal">
              {t.finance.backdate.hint(backdateDays, formatEntryDay(earliest, locale))}
            </span>
          )}
        </label>

        {isExpense && (
          <label className="adm-label" htmlFor={`${id}-category`}>
            {r.category}
            <select
              id={`${id}-category`}
              name="category"
              required
              value={category}
              onChange={(event) => edit(setCategory)(event.currentTarget.value as ExpenseCategory | "")}
              disabled={pending}
              className="adm-input"
            >
              <option value="" disabled>
                {r.chooseCategory}
              </option>
              {EXPENSE_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {t.finance.categories[option]}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="adm-label" htmlFor={`${id}-method`}>
          {r.method}
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

        <label className="adm-label" htmlFor={`${id}-amount`}>
          {r.amount}
          <input
            ref={amountRef}
            id={`${id}-amount`}
            name="amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required
            maxLength={20}
            placeholder={r.amountPlaceholder}
            value={amount}
            onChange={(event) => edit(setAmount)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input tabular-nums"
          />
        </label>

        <label className="adm-label" htmlFor={`${id}-counterparty`}>
          <span>
            {r.counterparty[kind]}
            {!counterpartyRequired && <span className="font-normal text-adm-muted"> ({r.optional})</span>}
          </span>
          <input
            id={`${id}-counterparty`}
            name="counterparty"
            type="text"
            autoComplete="off"
            required={counterpartyRequired}
            maxLength={FINANCE_LIMITS.counterpartyMax}
            placeholder={r.counterpartyPlaceholder[kind]}
            value={counterparty}
            onChange={(event) => edit(setCounterparty)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input"
            data-ph-mask
          />
        </label>

        <label className="adm-label sm:col-span-2 lg:col-span-3" htmlFor={`${id}-note`}>
          <span>
            {r.note}
            <span className="font-normal text-adm-muted"> ({r.optional})</span>
          </span>
          <textarea
            id={`${id}-note`}
            name="note"
            rows={2}
            maxLength={FINANCE_LIMITS.noteMax}
            value={note}
            onChange={(event) => edit(setNote)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input"
            data-ph-mask
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <div aria-live="polite" className="mr-auto min-w-0">
          {!pending && message.error && (
            <span role="alert" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-adm-negative">
              <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              {message.error}
            </span>
          )}
          {!pending && message.ok && (
            <span role="status" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-adm-positive">
              <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
              {message.ok}
            </span>
          )}
        </div>
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-primary">
          {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {pending ? r.submitting : r.submit}
        </button>
      </div>
    </form>
  );
}
