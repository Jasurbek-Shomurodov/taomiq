"use client";

import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { saveDish, setDishArchived, type FormState } from "@/lib/admin/actions";
import { ALLERGENS } from "@/lib/data/allergens";
import { localized } from "@/lib/data/localized";
import type { Dish } from "@/lib/data/types";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { TopBarActions } from "../../shell/TopBarSlot";
import { CyrillicField } from "../CyrillicField";

/** The editor form's id: the top bar's Save button submits it with form=. */
const FORM_ID = "dish-form";

/** Downscale a photo in the browser so uploads stay small on a phone connection. */
async function resizeImage(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("resize failed"))), "image/jpeg", 0.85),
  );
}

export function DishForm({ dish, locale }: { dish: Dish | null; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDish, {});
  const [archiveState, archiveAction, archiving] = useActionState<FormState, FormData>(setDishArchived, {});
  const archived = Boolean(dish?.archived_at);
  const t = getAdminDictionary(locale);
  const lang = t.common.fieldLang;

  const [photoUrl, setPhotoUrl] = useState(dish?.photo_url ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Live preview of one portion, so the cook can sanity-check the per-100 g numbers.
  const [weight, setWeight] = useState(String(dish?.default_weight_g ?? 300));
  const [per100, setPer100] = useState({
    kcal_100: String(dish?.kcal_100 ?? ""),
    protein_100: String(dish?.protein_100 ?? ""),
    fat_100: String(dish?.fat_100 ?? ""),
    carbs_100: String(dish?.carbs_100 ?? ""),
  });
  const portion = (value: string) => {
    const n = (Number(value.replace(",", ".")) * Number(weight)) / 100;
    return Number.isFinite(n) ? Math.round(n) : 0;
  };

  async function onPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const blob = await resizeImage(file);
      const path = `${crypto.randomUUID()}.jpg`;
      const supabase = createBrowserSupabase();
      const { error } = await supabase.storage.from("dish-photos").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      setPhotoUrl(supabase.storage.from("dish-photos").getPublicUrl(path).data.publicUrl);
    } catch {
      setUploadError(t.dish.uploadFailed);
    } finally {
      setUploading(false);
    }
  }

  const label = "adm-label";

  // A failed save is reported at the top of the form; Save sits in the top bar, so bring the message into view.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state]);

  const saveButton = (
    <button
      type="submit"
      form={FORM_ID}
      disabled={pending || uploading}
      aria-busy={pending || undefined}
      className="adm-btn adm-btn-primary"
    >
      {pending ? t.common.saving : t.common.save}
    </button>
  );

  return (
    <>
      {/* Save in the top bar submits the form by its id (form=), so Enter in a field submits it too. */}
      <TopBarActions>{saveButton}</TopBarActions>

      <form id={FORM_ID} action={action} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        {dish && <input type="hidden" name="id" value={dish.id} />}
        <input type="hidden" name="photo_url" value={photoUrl} />

        <div ref={errorRef} className="empty:hidden xl:col-span-2">
          {state.error && <Notice tone="negative">{state.error}</Notice>}
          {archived && !state.error && <Notice tone="caution">{t.dishArchive.archivedNotice}</Notice>}
        </div>

        <div className="grid min-w-0 content-start gap-5">
          <Panel title={t.dish.namesTitle}>
            <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className={label}>
                  {t.dish.name} ({lang.ru})
                  <input name="name_ru" required defaultValue={dish?.name_ru} className="adm-input" />
                </label>
                <label className={label}>
                  {t.dish.name} ({lang.uz})
                  <input name="name_uz" required defaultValue={dish?.name_uz} className="adm-input" />
                </label>
                <CyrillicField
                  name="name_uzc" latinName="name_uz" label={`${t.dish.name} (${lang.uzc})`}
                  defaultValue={dish?.name_uzc ?? ""} t={t.cyrillic}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className={label}>
                  {t.dish.ingredients} ({lang.ru})
                  <textarea name="ingredients_ru" rows={3} defaultValue={dish?.ingredients_ru} className="adm-input" />
                </label>
                <label className={label}>
                  {t.dish.ingredients} ({lang.uz})
                  <textarea name="ingredients_uz" rows={3} defaultValue={dish?.ingredients_uz} className="adm-input" />
                </label>
                <CyrillicField
                  name="ingredients_uzc" latinName="ingredients_uz" label={`${t.dish.ingredients} (${lang.uzc})`} rows={3}
                  defaultValue={dish?.ingredients_uzc ?? ""} t={t.cyrillic}
                />
              </div>
            </div>
          </Panel>

          <Panel title={t.dish.nutritionTitle} description={t.dish.nutrition}>
            <div className="grid gap-5">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                <label className={label}>
                  {t.dish.portion}
                  <input
                    name="default_weight_g" type="number" min="1" step="1" required inputMode="numeric"
                    value={weight} onChange={(e) => setWeight(e.target.value)} className="adm-input tabular-nums"
                  />
                </label>
                {(
                  [
                    ["kcal_100", t.dish.kcal],
                    ["protein_100", t.dish.protein],
                    ["fat_100", t.dish.fat],
                    ["carbs_100", t.dish.carbs],
                  ] as const
                ).map(([key, title]) => (
                  <label key={key} className={label}>
                    {title}
                    <input
                      name={key} type="number" min="0" step="0.1" required inputMode="decimal"
                      value={per100[key]} onChange={(e) => setPer100({ ...per100, [key]: e.target.value })}
                      className="adm-input tabular-nums"
                    />
                  </label>
                ))}
              </div>
              <p className="rounded-adm-control bg-adm-surface-muted p-3 text-sm tabular-nums text-adm-text" aria-live="polite">
                {t.dish.inPortion(weight || "0")}{" "}
                <b>
                  {portion(per100.kcal_100)} {t.common.kcal}
                </b>{" "}
                · {t.common.p} {portion(per100.protein_100)} · {t.common.f} {portion(per100.fat_100)} · {t.common.c}{" "}
                {portion(per100.carbs_100)}
              </p>
              <fieldset>
                <legend className="text-sm font-semibold text-adm-text">{t.dish.allergens}</legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  {ALLERGENS.map((allergen) => (
                    <label key={allergen.code} className="flex min-h-8 items-center gap-2">
                      <input
                        type="checkbox" name="allergens" value={allergen.code}
                        defaultChecked={dish?.allergens.includes(allergen.code)}
                      />
                      {allergen[locale]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </Panel>
        </div>

        <div className="grid min-w-0 content-start gap-5">
          <Panel title={t.dish.photo}>
            <div className="grid gap-3">
              <span className="relative block aspect-[4/3] w-full max-w-xs overflow-hidden rounded-adm-control bg-adm-surface-muted">
                {/* Plain <img>: the preview may be a just-uploaded file not yet known to the image optimizer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photoUrl && <img src={photoUrl} alt="" className="h-full w-full object-cover" />}
              </span>
              <div className="grid gap-2 text-sm">
                <input type="file" accept="image/*" onChange={onPhoto} disabled={uploading} aria-label={t.dish.photo} />
                <span className="text-adm-muted">{uploading ? t.dish.uploading : t.dish.photoHint}</span>
                {photoUrl && (
                  <button type="button" onClick={() => setPhotoUrl("")} className="adm-btn adm-btn-ghost adm-btn-danger adm-btn-sm w-fit -ml-3">
                    {t.dish.removePhoto}
                  </button>
                )}
                {uploadError && <span role="alert" className="text-adm-negative">{uploadError}</span>}
              </div>
            </div>
          </Panel>

          <Panel title={t.dish.visibilityTitle}>
            <div className="grid gap-3 text-sm">
              <label className="flex items-start gap-2">
                {/* An archived dish is never shown on the site (dishes_archived_not_active, 0023): restore it first. */}
                <input
                  type="checkbox" name="active" defaultChecked={archived ? false : (dish?.active ?? true)}
                  disabled={archived} className="mt-0.5"
                />
                <span>
                  {t.dish.active}
                  {archived && <span className="adm-caption block">{t.dishArchive.activeHint}</span>}
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="verified" defaultChecked={dish?.verified ?? false} className="mt-0.5" />
                {t.dish.verified}
              </label>
              {dish && (
                <Link href={`/tech-cards/${dish.id}`} className="adm-btn adm-btn-ghost adm-btn-sm -ml-3 w-fit">
                  <ClipboardList aria-hidden="true" />
                  {t.techCards.openCard}
                </Link>
              )}
            </div>
          </Panel>
        </div>

        <BeforeHydration>
          {/* Until the scripts run, the top bar has no Save: the form keeps its own. */}
          <div className="xl:col-span-2">{saveButton}</div>
        </BeforeHydration>
      </form>

      {dish && (
        <Panel title={t.dishArchive.title} description={archived ? t.dishArchive.archivedLead : t.dishArchive.lead}>
          <form action={archiveAction} className="grid gap-2">
            <input type="hidden" name="id" value={dish.id} />
            <input type="hidden" name="archive" value={archived ? "0" : "1"} />
            {archived ? (
              <button
                type="submit"
                disabled={archiving}
                aria-busy={archiving || undefined}
                className="adm-btn adm-btn-outline adm-btn-sm w-fit"
              >
                {archiving ? t.dishArchive.restoring : t.dishArchive.restore}
              </button>
            ) : (
              <ConfirmDialog
                trigger={t.dishArchive.archive}
                triggerClassName="adm-btn adm-btn-outline adm-btn-sm w-fit"
                disabled={archiving}
                title={t.dishArchive.confirmTitle(localized(dish, "name", locale))}
                description={t.dishArchive.confirmText}
                confirmLabel={t.dishArchive.archive}
                pendingLabel={t.dishArchive.archiving}
                cancelLabel={t.common.cancel}
                pending={archiving}
              />
            )}
            {archiveState.error && <p role="alert" className="text-sm text-adm-negative">{archiveState.error}</p>}
            {archiveState.ok && !archiving && <p role="status" className="text-sm text-adm-positive">{archiveState.ok}</p>}
          </form>
        </Panel>
      )}
    </>
  );
}
