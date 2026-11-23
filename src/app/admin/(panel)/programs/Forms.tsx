"use client";

import { useActionState } from "react";
import { saveDurations, saveProgram, type FormState } from "@/lib/admin/actions";
import type { Duration, Program } from "@/lib/data/types";
import { CyrillicField } from "../CyrillicField";

function Result({ state }: { state: FormState }) {
  if (state.ok) return <span role="status" className="text-sm text-forest">{state.ok}</span>;
  if (state.error) return <span role="alert" className="text-sm text-danger">{state.error}</span>;
  return null;
}

const label = "grid gap-1.5 text-sm font-semibold text-forest";

export function ProgramForm({ program }: { program: Program }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveProgram, {});

  return (
    <form action={action} className="rounded-2xl border border-line bg-white p-6">
      <input type="hidden" name="id" value={program.id} />
      <div className="flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-3 font-serif text-3xl text-forest">
          <span className="h-7 w-1.5 rounded-full" style={{ background: program.tag_color }} />
          {program.name}
        </h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={program.active} />
          Показывать на сайте
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className={`${label} content-start`}>
          Подзаголовок (русский)
          <input name="tagline_ru" defaultValue={program.tagline_ru} className="field font-normal" />
        </label>
        <label className={`${label} content-start`}>
          Подзаголовок (oʻzbekcha)
          <input name="tagline_uz" defaultValue={program.tagline_uz} className="field font-normal" />
        </label>
        <CyrillicField
          name="tagline_uzc" latinName="tagline_uz" label="Подзаголовок (ўзбекча)" defaultValue={program.tagline_uzc ?? ""}
        />
        <label className={`${label} content-start`}>
          Описание (русский)
          <textarea name="description_ru" rows={3} defaultValue={program.description_ru} className="field font-normal" />
        </label>
        <label className={`${label} content-start`}>
          Описание (oʻzbekcha)
          <textarea name="description_uz" rows={3} defaultValue={program.description_uz} className="field font-normal" />
        </label>
        <CyrillicField
          name="description_uzc" latinName="description_uz" label="Описание (ўзбекча)" rows={3}
          defaultValue={program.description_uzc ?? ""}
        />
      </div>

      <table className="mt-5 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="label py-2 text-muted">Калорийность</th>
            <th className="label py-2 text-muted">Цена за день, сум</th>
            <th className="label py-2 text-muted">Приёмов пищи</th>
            <th className="label py-2 text-muted">На сайте</th>
          </tr>
        </thead>
        <tbody>
          {program.variants.map((variant) => (
            <tr key={variant.id} className="border-b border-line last:border-0">
              <td className="py-2 font-semibold tabular-nums text-forest">
                <input type="hidden" name="variant_id" value={variant.id} />
                {variant.kcal} ккал
              </td>
              <td className="py-2 pr-3">
                <input
                  aria-label={`Цена за день, ${variant.kcal} ккал`}
                  name={`price_${variant.id}`} type="number" min="0" step="1000" required
                  defaultValue={variant.price_per_day} className="field max-w-40 tabular-nums"
                />
              </td>
              <td className="py-2 pr-3">
                <input
                  aria-label={`Приёмов пищи, ${variant.kcal} ккал`}
                  name={`meals_${variant.id}`} type="number" min="1" max="5" required
                  defaultValue={variant.meals_per_day} className="field max-w-24 tabular-nums"
                />
              </td>
              <td className="py-2">
                <input
                  aria-label={`Показывать ${variant.kcal} ккал`}
                  type="checkbox" name={`active_${variant.id}`} defaultChecked={variant.active}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 flex items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-forest !py-2.5 disabled:opacity-60">
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function DurationsForm({ durations }: { durations: Duration[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDurations, {});

  return (
    <form action={action} className="mt-4 rounded-2xl border border-line bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {durations.map((d) => (
          <label key={d.days} className={label}>
            <input type="hidden" name="days" value={d.days} />
            {d.days} дней{d.is_trial ? " (пробные)" : ""}
            <span className="flex items-center gap-2 font-normal text-muted">
              <input
                name={`markup_${d.days}`} type="number" step="0.5" required
                defaultValue={d.markup_pct} className="field tabular-nums"
              />
              %
            </span>
          </label>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-4">
        <button type="submit" disabled={pending} className="btn btn-forest !py-2.5 disabled:opacity-60">
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}
