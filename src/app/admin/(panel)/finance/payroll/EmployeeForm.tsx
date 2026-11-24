"use client";

import { LoaderCircle } from "lucide-react";
import { startTransition, useActionState, useId, useState, type FormEvent } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { addEmployee } from "@/lib/admin/finance/actions";
import { FINANCE_LIMITS } from "@/lib/admin/finance/categories";
import { PAYROLL_LIMITS, RATE_UNITS, type RateUnit } from "@/lib/admin/finance/payroll";
import { FormMessage } from "./FormMessage";

/**
 * A new person on the payroll: name, job title, first working day and the first rate (per month or per day), which
 * starts on that day. The server checks everything again (addEmployee). Fields are held in state, so a refused save
 * keeps what was typed; after a save they clear, except the date and the rate's unit.
 */
export function EmployeeForm({ locale, today }: { locale: Locale; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(addEmployee, {});
  const t = getAdminDictionary(locale);
  const p = t.finance.payroll;
  const id = useId();

  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [joined, setJoined] = useState(today);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<RateUnit>("monthly");

  const [message, setMessage] = useState<FormState>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setMessage(state);
    if (state.ok) {
      setName("");
      setJobTitle("");
      setAmount("");
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
      <input type="hidden" name="rate_unit" value={unit} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="adm-label" htmlFor={`${id}-name`}>
          {p.name}
          <input
            id={`${id}-name`}
            name="name"
            type="text"
            autoComplete="off"
            required
            maxLength={PAYROLL_LIMITS.nameMax}
            placeholder={p.namePlaceholder}
            value={name}
            onChange={(event) => edit(setName)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input"
            data-ph-mask
          />
        </label>

        <label className="adm-label" htmlFor={`${id}-job`}>
          <span>
            {p.jobTitle}
            <span className="font-normal text-adm-muted"> ({p.optional})</span>
          </span>
          <input
            id={`${id}-job`}
            name="job_title"
            type="text"
            autoComplete="off"
            maxLength={PAYROLL_LIMITS.jobTitleMax}
            placeholder={p.jobTitlePlaceholder}
            value={jobTitle}
            onChange={(event) => edit(setJobTitle)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input"
          />
        </label>

        <label className="adm-label" htmlFor={`${id}-joined`}>
          {p.joinedAt}
          <input
            id={`${id}-joined`}
            type="date"
            name="joined_at"
            required
            min={FINANCE_LIMITS.firstDay}
            max={today}
            value={joined}
            onChange={(event) => edit(setJoined)(event.currentTarget.value)}
            disabled={pending}
            className="adm-input tabular-nums"
          />
        </label>

        <label className="adm-label" htmlFor={`${id}-amount`}>
          {p.rateAmount}
          <input
            id={`${id}-amount`}
            name="rate_amount"
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
      </div>

      <p className="adm-caption">{p.addHint}</p>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <FormMessage message={message} pending={pending} />
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-primary">
          {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {pending ? p.adding : p.addSubmit}
        </button>
      </div>
    </form>
  );
}
