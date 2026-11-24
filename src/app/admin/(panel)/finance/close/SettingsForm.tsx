"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { saveFinanceSettings } from "@/lib/admin/finance/actions";
import { FINANCE_SETTING_KEYS, type FinanceSettingName, type FinanceSettings } from "@/lib/admin/finance/settings";
import { FormMessage } from "../payroll/FormMessage";

const FIELDS: readonly FinanceSettingName[] = ["monthlyRent", "breakEvenDaily", "taxRatePct"];

/** A saved value as the field shows it: amounts grouped ("6 000 000"), the rate as typed ("4.5"); "" when not set. */
function shown(name: FinanceSettingName, value: number | null): string {
  if (value === null) return "";
  return name === "taxRatePct" ? String(value) : formatSum(value);
}

/**
 * The finance settings: rent plan, break-even target per day and estimated tax rate. An empty field clears that setting.
 * The server checks everything again (saveFinanceSettings); fields are held in state, so a refused save keeps what was
 * typed.
 */
export function SettingsForm({ settings, locale }: { settings: FinanceSettings; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveFinanceSettings, {});
  const t = getAdminDictionary(locale);
  const s = t.finance.settings;
  const id = useId();
  const [values, setValues] = useState<Record<FinanceSettingName, string>>({
    monthlyRent: shown("monthlyRent", settings.monthlyRent),
    breakEvenDaily: shown("breakEvenDaily", settings.breakEvenDaily),
    taxRatePct: shown("taxRatePct", settings.taxRatePct),
  });

  const [message, setMessage] = useState<FormState>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setMessage(state);
  }

  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((name) => (
          <label key={name} className="adm-label content-start" htmlFor={`${id}-${name}`}>
            {s.fields[name]}
            <input
              id={`${id}-${name}`}
              name={FINANCE_SETTING_KEYS[name]}
              type="text"
              inputMode={name === "taxRatePct" ? "decimal" : "numeric"}
              autoComplete="off"
              maxLength={20}
              placeholder={s.placeholders[name]}
              value={values[name]}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setValues((current) => ({ ...current, [name]: value }));
                if (message.ok || message.error) setMessage({});
              }}
              disabled={pending}
              aria-describedby={`${id}-${name}-hint`}
              className="adm-input tabular-nums"
            />
            <span id={`${id}-${name}-hint`} className="adm-caption font-normal">
              {s.hints[name]}
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <FormMessage message={message} pending={pending} />
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-outline">
          {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
          {pending ? s.saving : s.submit}
        </button>
      </div>
    </form>
  );
}
