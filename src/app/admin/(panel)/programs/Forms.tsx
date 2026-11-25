"use client";

import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import { useActionState, useId, useState, type ReactNode } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { saveDurations, saveProgram, type FormState } from "@/lib/admin/actions";
import type { Duration, Program } from "@/lib/data/types";
import { Panel } from "../../kit/Panel";
import { PhotoField } from "../../kit/PhotoField";
import { CyrillicField } from "../CyrillicField";

/**
 * One settings row: the label (and a hint) on the left, the control on the right. On phones the control drops
 * under its label at full width. `htmlFor` ties the label to a single control; without it the row is a group named
 * by its label (several fields, each with its own short label).
 */
function Row({ label, hint, htmlFor, children }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  const labelId = useId();
  const group = htmlFor ? {} : { role: "group", "aria-labelledby": labelId };
  return (
    <div {...group} className="adm-row flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
      <div className="min-w-0 basis-full sm:basis-48 sm:shrink-0 sm:pt-2.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-sm font-semibold text-adm-text">
            {label}
          </label>
        ) : (
          <p id={labelId} className="text-sm font-semibold text-adm-text">
            {label}
          </p>
        )}
        {hint && <p className="adm-caption mt-0.5">{hint}</p>}
      </div>
      <div className="min-w-0 flex-1 basis-full sm:basis-0">{children}</div>
    </div>
  );
}

/**
 * The foot of a panel: what the last save did (saved / failed, in words with an icon) and the panel's Save, which
 * shows the busy state while the write runs. "Saved" goes away as soon as a field changes again. `blocked` keeps
 * Save off while something the form needs is not ready yet (a photo still uploading).
 */
function SaveFoot({
  state,
  pending,
  changed,
  blocked = false,
  label,
  savingLabel,
}: {
  state: FormState;
  pending: boolean;
  changed: boolean;
  blocked?: boolean;
  label: string;
  savingLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-adm-border bg-adm-page px-4 py-3 sm:px-5">
      {!pending && state.error && (
        <span role="alert" className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-adm-negative">
          <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
          {state.error}
        </span>
      )}
      {!pending && state.ok && !changed && (
        <span role="status" className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-adm-positive">
          <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
          {state.ok}
        </span>
      )}
      <button type="submit" disabled={pending || blocked} aria-busy={pending || undefined} className="adm-btn adm-btn-primary">
        {pending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
        {pending ? savingLabel : label}
      </button>
    </div>
  );
}

/**
 * Whether the form changed after the last save started, so "Saved" never shows for a form that has moved on
 * (an edit while the save was running, or after it). Typing, "Fill from Latin" and a photo uploaded or removed
 * all count.
 */
function useChangedSinceSubmit() {
  const [edits, setEdits] = useState(0);
  const [editsAtSubmit, setEditsAtSubmit] = useState(0);
  return {
    changed: edits !== editsAtSubmit,
    markEdited: () => setEdits((n) => n + 1),
    markSubmitted: () => setEditsAtSubmit(edits),
  };
}

export function ProgramForm({ program, locale }: { program: Program; locale: Locale }) {
  // The photo as this form last loaded or saved it (photo_url_prev): saveProgram replaces the photo only while the
  // row still holds this one. Not taken from later server renders, which would move it forward under an open form
  // and let a stale photo replace a colleague's; a successful save moves it to the photo this form sent, which the
  // row then holds (the form stays mounted after a save).
  const [loadedPhoto, setLoadedPhoto] = useState(program.photo_url ?? "");
  const [state, action, pending] = useActionState<FormState, FormData>(async (prev, form) => {
    const result = await saveProgram(prev, form);
    if (result.ok) setLoadedPhoto(String(form.get("photo_url") ?? "").trim());
    return result;
  }, {});
  const { changed, markEdited, markSubmitted } = useChangedSinceSubmit();
  const [uploading, setUploading] = useState(false);
  const t = getAdminDictionary(locale);
  const p = t.programs;
  const lang = t.common.fieldLang;
  const id = program.id;

  return (
    <Panel
      flush
      title={
        <span className="flex min-w-0 items-center gap-3">
          {/* The program's own tag colour, from the database. */}
          <span aria-hidden="true" className="h-6 w-1.5 shrink-0 rounded-full" style={{ background: program.tag_color }} />
          <span className="min-w-0 truncate">{program.name}</span>
        </span>
      }
    >
      <form action={action} onChange={markEdited} onSubmit={markSubmitted}>
        <input type="hidden" name="id" value={program.id} />
        <div>
          <Row label={p.showOnSite} hint={p.showOnSiteHint} htmlFor={`program-active-${id}`}>
            <span className="flex min-h-11 items-center">
              <input id={`program-active-${id}`} type="checkbox" name="active" defaultChecked={program.active} className="size-4" />
            </span>
          </Row>

          <Row label={p.photo} htmlFor={`program-photo-${id}`}>
            {/* What this form was loaded with: saveProgram refuses to replace a photo that changed elsewhere. */}
            <input type="hidden" name="photo_url_prev" value={loadedPhoto} />
            <PhotoField
              bucket="program-photos"
              name="photo_url"
              inputId={`program-photo-${id}`}
              defaultUrl={program.photo_url}
              aspect="3 / 2"
              labels={{
                hint: p.photoHint,
                noPhoto: p.noPhoto,
                uploading: p.uploading,
                remove: p.removePhoto,
                uploadFailed: p.uploadFailed,
              }}
              onUploadingChange={setUploading}
              onChange={markEdited}
            />
          </Row>

          <Row label={p.tagline}>
            <div className="grid gap-4 lg:grid-cols-3">
              <label className="adm-label">
                {lang.ru}
                <input name="tagline_ru" defaultValue={program.tagline_ru} className="adm-input" />
              </label>
              <label className="adm-label">
                {lang.uz}
                <input name="tagline_uz" defaultValue={program.tagline_uz} className="adm-input" />
              </label>
              <CyrillicField
                name="tagline_uzc" latinName="tagline_uz" label={lang.uzc}
                defaultValue={program.tagline_uzc ?? ""} t={t.cyrillic} onFill={markEdited}
              />
            </div>
          </Row>

          <Row label={p.description}>
            <div className="grid gap-4 lg:grid-cols-3">
              <label className="adm-label">
                {lang.ru}
                <textarea name="description_ru" rows={3} defaultValue={program.description_ru} className="adm-input" />
              </label>
              <label className="adm-label">
                {lang.uz}
                <textarea name="description_uz" rows={3} defaultValue={program.description_uz} className="adm-input" />
              </label>
              <CyrillicField
                name="description_uzc" latinName="description_uz" label={lang.uzc} rows={3}
                defaultValue={program.description_uzc ?? ""} t={t.cyrillic} onFill={markEdited}
              />
            </div>
          </Row>
        </div>

        {/* Calorie levels: one row each, price per day, meals and whether the site shows it. */}
        <h3 className="adm-table-head border-t border-adm-border px-4 py-2.5 sm:px-5">{p.variantsTitle}</h3>
        <div>
          {program.variants.map((variant) => (
            <Row
              key={variant.id}
              label={
                <span className="tabular-nums">
                  {variant.kcal} {t.common.kcal}
                </span>
              }
            >
              <input type="hidden" name="variant_id" value={variant.id} />
              <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                <label className="adm-label w-40">
                  <span className="adm-caption font-medium">{p.pricePerDay}</span>
                  <input
                    aria-label={p.priceAria(variant.kcal)}
                    name={`price_${variant.id}`} type="number" min="0" step="1000" required
                    defaultValue={variant.price_per_day} className="adm-input tabular-nums"
                  />
                </label>
                <label className="adm-label w-28">
                  <span className="adm-caption font-medium">{p.meals}</span>
                  <input
                    aria-label={p.mealsAria(variant.kcal)}
                    name={`meals_${variant.id}`} type="number" min="1" max="5" required
                    defaultValue={variant.meals_per_day} className="adm-input tabular-nums"
                  />
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm text-adm-text">
                  <input
                    aria-label={p.showAria(variant.kcal)}
                    type="checkbox" name={`active_${variant.id}`} defaultChecked={variant.active} className="size-4"
                  />
                  {p.onSite}
                </label>
              </div>
            </Row>
          ))}
        </div>

        <SaveFoot
          state={state} pending={pending} changed={changed} blocked={uploading}
          label={p.saveProgram} savingLabel={t.common.saving}
        />
      </form>
    </Panel>
  );
}

export function DurationsForm({ durations, locale }: { durations: Duration[]; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDurations, {});
  const { changed, markEdited, markSubmitted } = useChangedSinceSubmit();
  const t = getAdminDictionary(locale);
  const p = t.programs;

  return (
    <Panel flush title={p.durations} description={p.durationsHint}>

      <form action={action} onChange={markEdited} onSubmit={markSubmitted}>
        <div>
          {durations.map((d) => {
            const period = `${p.days(d.days)}${d.is_trial ? p.trial : ""}`;
            return (
              <Row key={d.days} label={period} htmlFor={`markup-${d.days}`}>
                <input type="hidden" name="days" value={d.days} />
                <span className="flex w-36 items-center gap-2 text-sm text-adm-muted">
                  <input
                    id={`markup-${d.days}`}
                    aria-label={p.markupAria(period)}
                    name={`markup_${d.days}`} type="number" step="0.5" required
                    defaultValue={d.markup_pct} className="adm-input tabular-nums"
                  />
                  %
                </span>
              </Row>
            );
          })}
        </div>

        <SaveFoot state={state} pending={pending} changed={changed} label={p.saveDurations} savingLabel={t.common.saving} />
      </form>
    </Panel>
  );
}
