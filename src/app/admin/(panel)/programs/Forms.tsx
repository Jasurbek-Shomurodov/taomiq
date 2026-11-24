"use client";

import { useActionState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { saveDurations, saveProgram, type FormState } from "@/lib/admin/actions";
import type { Duration, Program } from "@/lib/data/types";
import { CyrillicField } from "../CyrillicField";

function Result({ state }: { state: FormState }) {
  if (state.ok) return <span role="status" className="text-sm text-adm-positive">{state.ok}</span>;
  if (state.error) return <span role="alert" className="text-sm text-adm-negative">{state.error}</span>;
  return null;
}

const label = "adm-label";

export function ProgramForm({ program, locale }: { program: Program; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProgram, {});
  const t = getAdminDictionary(locale);
  const lang = t.common.fieldLang;

  return (
    <form action={action} className="adm-panel sm:p-6">
      <input type="hidden" name="id" value={program.id} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="adm-heading flex items-center gap-3 text-lg">
          <span className="h-7 w-1.5 rounded-full" style={{ background: program.tag_color }} />
          {program.name}
        </h2>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={program.active} />
          {t.programs.showOnSite}
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className={label}>
          {t.programs.tagline} ({lang.ru})
          <input name="tagline_ru" defaultValue={program.tagline_ru} className="adm-input" />
        </label>
        <label className={label}>
          {t.programs.tagline} ({lang.uz})
          <input name="tagline_uz" defaultValue={program.tagline_uz} className="adm-input" />
        </label>
        <CyrillicField
          name="tagline_uzc" latinName="tagline_uz" label={`${t.programs.tagline} (${lang.uzc})`}
          defaultValue={program.tagline_uzc ?? ""} t={t.cyrillic}
        />
        <label className={label}>
          {t.programs.description} ({lang.ru})
          <textarea name="description_ru" rows={3} defaultValue={program.description_ru} className="adm-input" />
        </label>
        <label className={label}>
          {t.programs.description} ({lang.uz})
          <textarea name="description_uz" rows={3} defaultValue={program.description_uz} className="adm-input" />
        </label>
        <CyrillicField
          name="description_uzc" latinName="description_uz" label={`${t.programs.description} (${lang.uzc})`} rows={3}
          defaultValue={program.description_uzc ?? ""} t={t.cyrillic}
        />
      </div>

      <div className="-mx-4 mt-5 overflow-x-auto sm:-mx-6">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead className="adm-table-head">
            <tr>
              <th className="px-4 py-2.5 font-medium sm:px-6">{t.programs.kcal}</th>
              <th className="px-4 py-2.5 font-medium">{t.programs.pricePerDay}</th>
              <th className="px-4 py-2.5 font-medium">{t.programs.meals}</th>
              <th className="px-4 py-2.5 font-medium sm:pr-6">{t.programs.onSite}</th>
            </tr>
          </thead>
          <tbody>
            {program.variants.map((variant) => (
              <tr key={variant.id} className="adm-row">
                <td className="whitespace-nowrap px-4 py-2 font-semibold tabular-nums sm:px-6">
                  <input type="hidden" name="variant_id" value={variant.id} />
                  {variant.kcal} {t.common.kcal}
                </td>
                <td className="px-4 py-2">
                  <input
                    aria-label={t.programs.priceAria(variant.kcal)}
                    name={`price_${variant.id}`} type="number" min="0" step="1000" required
                    defaultValue={variant.price_per_day} className="adm-input max-w-40 tabular-nums"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    aria-label={t.programs.mealsAria(variant.kcal)}
                    name={`meals_${variant.id}`} type="number" min="1" max="5" required
                    defaultValue={variant.meals_per_day} className="adm-input max-w-24 tabular-nums"
                  />
                </td>
                <td className="px-4 py-2 sm:pr-6">
                  <input
                    aria-label={t.programs.showAria(variant.kcal)}
                    type="checkbox" name={`active_${variant.id}`} defaultChecked={variant.active}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-primary">
          {pending ? t.common.saving : t.common.save}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function DurationsForm({ durations, locale }: { durations: Duration[]; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDurations, {});
  const t = getAdminDictionary(locale);

  return (
    <form action={action} className="adm-panel sm:p-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {durations.map((d) => (
          <label key={d.days} className={label}>
            <input type="hidden" name="days" value={d.days} />
            {`${t.programs.days(d.days)}${d.is_trial ? t.programs.trial : ""}`}
            <span className="flex items-center gap-2 font-normal text-adm-muted">
              <input
                name={`markup_${d.days}`} type="number" step="0.5" required
                defaultValue={d.markup_pct} className="adm-input tabular-nums"
              />
              %
            </span>
          </label>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-4">
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="adm-btn adm-btn-primary">
          {pending ? t.common.saving : t.common.save}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}
