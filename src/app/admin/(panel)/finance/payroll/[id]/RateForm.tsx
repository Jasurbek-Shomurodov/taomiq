"use client";

import { LoaderCircle } from "lucide-react";
import { startTransition, useActionState, useId, useState, type FormEvent } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { addSalaryRate } from "@/lib/admin/finance/actions";
import { FINANCE_LIMITS } from "@/lib/admin/finance/categories";
import { PAYROLL_LIMITS, RATE_UNITS, type RateUnit } from "@/lib/admin/finance/payroll";
import { FormMessage } from "../FormMessage";

/**
 * A new rate for one person from a day on (today by default; a later day for an agreed raise, an earlier one to
 * correct the past). The days before it keep the rate before. The server checks everything again (addSalaryRate).
 */
export function RateForm({
  employeeId,
  defaultUnit,
  locale,
  today,
  latest,
}: {
  employeeId: string;
  defaultUnit: RateUnit;
  locale: Locale;
  today: string;
  /** The last day a rate may start (a year ahead). */
  latest: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(addSalaryRate, {});
  const t = getAdminDictionary(locale);
  const p = t.finance.payroll;
  const id = useId();

  const [from, setFrom] = useState(today);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<RateUnit>(defaultUnit);
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

  return (
    <form onSubmit={submit} className="grid gap-5">
      <input type="hidden" name="employee_id" value={employeeId} />
      <input type="hidden" name="rate_unit" value={unit} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="adm-label" htmlFor={`${id}-from`}>
          {p.effectiveFrom}
          <input
            id={`${id}-from`}
            type="date"
            name="effective_from"
            required
            min={FINANCE_LIMITS.firstDay}
            max={latest}
            value={from}
            onChange={(event) => edit(setFrom)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input tabular-nums"
          />
        </label>

        <label className="adm-label" htmlFor={`${id}-amount`}>
          {p.rateAmount}
          <input
            id={`${id}-amount`}
            name="amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required
            maxLength={20}
            placeholder={p.ratePlaceholder}
            value={amount}
            onChange={(event) => edit(setAmount)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input tabular-nums"
          />
        </label>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold text-adm-text">{p.rateUnit}</legend>
          <div className="adm-segmented w-full sm:w-auto">
            {RATE_UNITS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={unit === option}
                disabled={pending}
                onClick={() => edit(setUnit)(option)}
              >
                {p.units[option]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="adm-label sm:col-span-2 lg:col-span-3" htmlFor={`${id}-note`}>
          <span>
            {p.note}
            <span className="font-normal text-adm-muted"> ({p.optional})</span>
          </span>
          <input
            id={`${id}-note`}
            name="note"
            type="text"
            autoComplete="off"
            maxLength={PAYROLL_LIMITS.noteMax}
            value={note}
            onChange={(event) => edit(setNote)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <FormMessage message={message} pending={pending} />
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-outline">
          {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {pending ? p.saving : p.rateSubmit}
        </button>
      </div>
    </form>
  );
}
