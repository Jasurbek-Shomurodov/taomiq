"use client";

import { useId, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

export type PhotoFieldLabels = {
  /** The fieldset legend. Left out when the form labels the picker itself (see `inputId`). */
  title?: string;
  /** Shown under the picker and in the empty box: what kind of photo to upload. */
  hint: string;
  /** Inside the empty preview box. */
  noPhoto: string;
  uploading: string;
  remove: string;
  uploadFailed: string;
};

/** Downscale a photo in the browser so uploads stay small on a phone connection. */
async function resizeImage(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("resize failed"))), "image/jpeg", 0.85),
  );
}

/**
 * One photo for a form: pick a file, the browser downscales it (JPEG, longest side 1600 px) and uploads it at
 * once to a public Storage bucket with the staff member's own session (the bucket's policies decide who may),
 * then shows a preview. The public URL goes into a hidden input called `name`, so the form's server action
 * saves it like any other field; an empty value means "no photo". A failed upload keeps the previous photo.
 *
 * Same resize-and-upload steps as the dish form (src/app/admin/(panel)/dishes/DishForm.tsx), which is to move
 * onto this component later.
 */
export function PhotoField({
  bucket,
  name,
  defaultUrl,
  aspect = "3 / 2",
  labels,
  inputId,
  onUploadingChange,
  onChange,
}: {
  bucket: string;
  name: string;
  defaultUrl: string | null;
  /** CSS aspect ratio of the preview, the shape the site shows the photo in. */
  aspect?: string;
  labels: PhotoFieldLabels;
  /**
   * The file picker's id, for a form that labels the picker with its own `<label htmlFor>` (a settings row). The
   * field then renders without a fieldset and legend, so the photo is not named twice.
   */
  inputId?: string;
  /** Lets the form disable its Save button while a file is still uploading. */
  onUploadingChange?: (uploading: boolean) => void;
  /**
   * Called with the new URL ("" for none) after an upload or a removal. The hidden input changes without an
   * input event, so a form that tracks edits hears of it here.
   */
  onChange?: (url: string) => void;
}) {
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const hintId = useId();

  function change(next: string) {
    setUrl(next);
    onChange?.(next);
  }

  function busy(value: boolean) {
    setUploading(value);
    onUploadingChange?.(value);
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    busy(true);
    setError("");
    try {
      const blob = await resizeImage(file);
      const path = `${crypto.randomUUID()}.jpg`;
      const supabase = createBrowserSupabase();
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, blob, { contentType: "image/jpeg" });
      if (uploadError) throw uploadError;
      change(supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl);
    } catch {
      setError(labels.uploadFailed);
    } finally {
      // Clear the picker so choosing the same file again (after a failure) fires a change.
      input.value = "";
      busy(false);
    }
  }

  const body = (
    <>
      <input type="hidden" name={name} value={url} />
      <div className="grid gap-4 sm:grid-cols-[14rem_1fr] sm:items-start">
        <span
          className={`relative block w-full max-w-56 overflow-hidden rounded-adm-control ${
            url ? "bg-adm-surface-muted" : "border border-dashed border-adm-border"
          }`}
          style={{ aspectRatio: aspect }}
        >
          {url ? (
            // Plain <img>: the preview may be a just-uploaded file not yet known to the image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center p-3 text-center text-sm text-adm-muted">
              {labels.noPhoto}
            </span>
          )}
        </span>
        <div className="grid gap-2 text-sm">
          <input
            id={inputId} type="file" accept="image/*" onChange={onFile} disabled={uploading}
            aria-busy={uploading || undefined} aria-describedby={hintId}
          />
          <span id={hintId} className="text-adm-muted" aria-live="polite">{uploading ? labels.uploading : labels.hint}</span>
          {url && !uploading && (
            <button
              type="button"
              onClick={() => change("")}
              className="adm-btn adm-btn-ghost adm-btn-danger adm-btn-sm w-fit -ml-3"
            >
              {labels.remove}
            </button>
          )}
          {error && <span role="alert" className="text-adm-negative">{error}</span>}
        </div>
      </div>
    </>
  );

  if (inputId) return <div className="grid gap-3">{body}</div>;
  return (
    <fieldset className="grid gap-3">
      {labels.title && <legend className="text-sm font-semibold text-adm-text">{labels.title}</legend>}
      {body}
    </fieldset>
  );
}
