"use client";

import { useActionState, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { deleteDish, saveDish, type FormState } from "@/lib/admin/actions";
import { ALLERGENS } from "@/lib/data/allergens";
import { localized } from "@/lib/data/localized";
import type { Dish } from "@/lib/data/types";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import { CyrillicField } from "../CyrillicField";

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
  const [deleteState, deleteAction, deleting] = useActionState<FormState, FormData>(deleteDish, {});
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

  const label = "grid content-start gap-1.5 text-sm font-semibold text-forest";

  return (
    <>
      <form action={action} className="mt-6 grid gap-6 rounded-2xl border border-line bg-white p-6">
        {dish && <input type="hidden" name="id" value={dish.id} />}
        <input type="hidden" name="photo_url" value={photoUrl} />

        <div className="grid gap-4 sm:grid-cols-3">
          <label className={label}>
            {t.dish.name} ({lang.ru})
            <input name="name_ru" required defaultValue={dish?.name_ru} className="field font-normal" />
          </label>
          <label className={label}>
            {t.dish.name} ({lang.uz})
            <input name="name_uz" required defaultValue={dish?.name_uz} className="field font-normal" />
          </label>
          <CyrillicField
            name="name_uzc" latinName="name_uz" label={`${t.dish.name} (${lang.uzc})`}
            defaultValue={dish?.name_uzc ?? ""} t={t.cyrillic}
          />
        </div>

        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold text-forest">{t.dish.photo}</legend>
          <div className="flex flex-wrap items-center gap-4">
            <span className="relative block h-28 w-36 overflow-hidden rounded-xl bg-ivory-deep">
              {/* Plain <img>: the preview may be a just-uploaded file not yet known to the image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photoUrl && <img src={photoUrl} alt="" className="h-full w-full object-cover" />}
            </span>
            <div className="grid gap-2 text-sm">
              <input type="file" accept="image/*" onChange={onPhoto} disabled={uploading} />
              <span className="text-muted">{uploading ? t.dish.uploading : t.dish.photoHint}</span>
              {photoUrl && (
                <button type="button" onClick={() => setPhotoUrl("")} className="w-fit cursor-pointer text-danger">
                  {t.dish.removePhoto}
                </button>
              )}
              {uploadError && <span role="alert" className="text-danger">{uploadError}</span>}
            </div>
          </div>
        </fieldset>

        <fieldset className="grid gap-3">
          <legend className="text-sm font-semibold text-forest">{t.dish.nutrition}</legend>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <label className={label}>
              {t.dish.portion}
              <input
                name="default_weight_g" type="number" min="1" step="1" required inputMode="numeric"
                value={weight} onChange={(e) => setWeight(e.target.value)} className="field font-normal tabular-nums"
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
                  className="field font-normal tabular-nums"
                />
              </label>
            ))}
          </div>
          <p className="rounded-lg bg-ivory p-3 text-sm tabular-nums text-graphite">
            {t.dish.inPortion(weight || "0")}{" "}
            <b>
              {portion(per100.kcal_100)} {t.common.kcal}
            </b>{" "}
            · {t.common.p} {portion(per100.protein_100)} · {t.common.f} {portion(per100.fat_100)} · {t.common.c}{" "}
            {portion(per100.carbs_100)}
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className={label}>
            {t.dish.ingredients} ({lang.ru})
            <textarea name="ingredients_ru" rows={3} defaultValue={dish?.ingredients_ru} className="field font-normal" />
          </label>
          <label className={label}>
            {t.dish.ingredients} ({lang.uz})
            <textarea name="ingredients_uz" rows={3} defaultValue={dish?.ingredients_uz} className="field font-normal" />
          </label>
          <CyrillicField
            name="ingredients_uzc" latinName="ingredients_uz" label={`${t.dish.ingredients} (${lang.uzc})`} rows={3}
            defaultValue={dish?.ingredients_uzc ?? ""} t={t.cyrillic}
          />
        </div>

        <fieldset>
          <legend className="text-sm font-semibold text-forest">{t.dish.allergens}</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {ALLERGENS.map((allergen) => (
              <label key={allergen.code} className="flex items-center gap-2">
                <input
                  type="checkbox" name="allergens" value={allergen.code}
                  defaultChecked={dish?.allergens.includes(allergen.code)}
                />
                {allergen[locale]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="verified" defaultChecked={dish?.verified ?? false} />
            {t.dish.verified}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={dish?.active ?? true} />
            {t.dish.active}
          </label>
        </div>

        {state.error && <p role="alert" className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{state.error}</p>}

        <div>
          <button type="submit" disabled={pending || uploading} className="btn btn-forest disabled:opacity-60">
            {pending ? t.common.saving : t.common.save}
          </button>
        </div>
      </form>

      {dish && (
        <form action={deleteAction} className="mt-4">
          <input type="hidden" name="id" value={dish.id} />
          <ConfirmDialog
            trigger={t.dish.delete}
            triggerClassName="cursor-pointer text-sm text-danger hover:underline"
            disabled={deleting}
            title={t.dish.deleteTitle(localized(dish, "name", locale))}
            description={t.dish.deleteText}
            confirmLabel={t.dish.deleteButton}
            pendingLabel={t.common.deleting}
            cancelLabel={t.common.cancel}
            destructive
            pending={deleting}
          />
          {deleteState.error && <p role="alert" className="mt-2 text-sm text-danger">{deleteState.error}</p>}
        </form>
      )}
    </>
  );
}
