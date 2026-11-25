"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { ConfirmDialog } from "@/app/admin/ConfirmDialog";
import type { FormState } from "@/lib/admin/actions";
import {
  EQUIPMENT_LIMITS,
  EQUIPMENT_PHOTO_BUCKET,
  checkEquipment,
  hasEquipmentErrors,
  type Equipment,
  type EquipmentErrors,
  type EquipmentField,
  type EquipmentInput,
} from "@/lib/admin/equipment";
import { saveEquipment, setEquipmentArchived, type EquipmentFormState } from "@/lib/admin/equipment-actions";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { PhotoField } from "../../kit/PhotoField";
import { TopBarActions } from "../../shell/TopBarSlot";

const FORM_ID = "equipment-form";

/** The message for a field's problem, in the reader's language. */
function equipmentProblem(field: EquipmentField, problem: EquipmentErrors[EquipmentField], t: AdminDictionary): string | null {
  const e = t.equipment.fieldErrors;
  switch (problem) {
    case undefined:
      return null;
    case "duplicate":
      return e.duplicate;
    case "too_long":
      return e.tooLong(field === "note" ? EQUIPMENT_LIMITS.noteMax : EQUIPMENT_LIMITS.nameMax);
    case "required":
      return e.required;
    case "invalid":
      return t.equipment.errors.countInvalid(EQUIPMENT_LIMITS.countMax);
  }
}

function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error: string | null; children: ReactNode }) {
  return (
    <label className="adm-label">
      {label}
      {children}
      {hint && <span className="adm-caption font-normal">{hint}</span>}
      {error && (
        <span role="alert" className="text-[13px] font-medium text-adm-negative">
          {error}
        </span>
      )}
    </label>
  );
}

type Values = EquipmentInput & { photo: string };

function readForm(form: HTMLFormElement, photo: string): Values {
  const data = new FormData(form);
  const get = (key: string) => String(data.get(key) ?? "");
  return { name: get("name"), note: get("note"), count: get("count"), photo };
}

const same = (a: Values, b: Values) =>
  a.name.trim() === b.name.trim() && a.note.trim() === b.note.trim() && a.count.trim() === b.count.trim() && a.photo === b.photo;

/**
 * The item editor: name, note, photo, and the first count of a new item (an existing one is counted with its own
 * control beside this form). Save in the top bar, disabled until something changed and while a photo uploads. Saving
 * goes back to the register.
 *
 * `shownPhoto` is the stored photo when it passes the bucket check (equipmentPhotoToShow), else null: the picker shows
 * only that. The stored URL still goes back as photo_url_prev, and the photo is written only when the picker was used
 * (photo_touched), so an item with a URL the page will not show can be renamed without losing or rechecking it.
 */
export function EquipmentForm({
  item,
  shownPhoto,
  locale,
}: {
  item: Equipment | null;
  shownPhoto: string | null;
  locale: Locale;
}) {
  const [state, action, pending] = useActionState<EquipmentFormState, FormData>(saveEquipment, {});
  const t = getAdminDictionary(locale);
  const te = t.equipment;
  const formRef = useRef<HTMLFormElement>(null);
  const isNew = item === null;
  const [initial] = useState<Values>(() => ({
    name: item?.name ?? "",
    note: item?.note ?? "",
    count: isNew ? "0" : "",
    photo: shownPhoto ?? "",
  }));
  const [photoTouched, setPhotoTouched] = useState(false);
  const [photo, setPhoto] = useState(initial.photo);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(isNew);
  const [local, setLocal] = useState<EquipmentErrors>({});
  const [server, setServer] = useState<EquipmentErrors>({});
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setServer(state.fields ?? {});
  }
  const errors: EquipmentErrors = { ...local, ...server };

  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error || state.fields) noticeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state]);

  function recheck(nextPhoto = photo) {
    const form = formRef.current;
    if (!form) return;
    setDirty(isNew || !same(readForm(form, nextPhoto), initial));
    if (Object.keys(server).length) setServer({});
  }

  const button = (
    <button
      type="submit"
      form={FORM_ID}
      disabled={pending || uploading || !dirty}
      aria-busy={pending || undefined}
      className="adm-btn adm-btn-primary"
    >
      {pending ? t.common.saving : t.common.save}
    </button>
  );
  const problem = (field: EquipmentField) => equipmentProblem(field, errors[field], t);

  return (
    <>
      <TopBarActions>{button}</TopBarActions>
      <form
        id={FORM_ID}
        ref={formRef}
        action={action}
        noValidate
        onInput={() => recheck()}
        onChange={() => recheck()}
        onSubmit={(event) => {
          const checked = checkEquipment(readForm(event.currentTarget, photo), isNew);
          setLocal(checked);
          if (hasEquipmentErrors(checked) || uploading) event.preventDefault();
        }}
        className="grid min-w-0 content-start gap-5"
      >
        {item && <input type="hidden" name="id" value={item.id} />}
        <input type="hidden" name="photo_url_prev" value={item?.photo_url ?? ""} />
        <input type="hidden" name="photo_touched" value={photoTouched ? "1" : ""} />
        <div ref={noticeRef} className="empty:hidden">
          {(state.error || hasEquipmentErrors(errors)) && <Notice tone="negative">{state.error ?? te.problems}</Notice>}
        </div>

        <Panel title={te.detailsTitle}>
          <div className="grid gap-4">
            <div className={`grid gap-4 ${isNew ? "sm:grid-cols-[minmax(0,1fr)_10rem]" : ""}`}>
              <Field label={te.name} error={problem("name")}>
                <input
                  name="name"
                  required
                  maxLength={EQUIPMENT_LIMITS.nameMax}
                  defaultValue={initial.name}
                  placeholder={te.namePlaceholder}
                  aria-invalid={Boolean(errors.name) || undefined}
                  className="adm-input font-normal"
                />
              </Field>
              {isNew && (
                <Field label={te.countLabel} hint={te.countHint} error={problem("count")}>
                  <input
                    name="count"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={7}
                    defaultValue={initial.count}
                    aria-invalid={Boolean(errors.count) || undefined}
                    className="adm-input font-normal tabular-nums"
                  />
                </Field>
              )}
            </div>
            <Field label={te.note} hint={te.noteHint(EQUIPMENT_LIMITS.noteMax)} error={problem("note")}>
              <textarea
                name="note"
                rows={3}
                maxLength={EQUIPMENT_LIMITS.noteMax}
                defaultValue={initial.note}
                aria-invalid={Boolean(errors.note) || undefined}
                className="adm-input font-normal"
              />
            </Field>
          </div>
        </Panel>

        <Panel title={te.photoTitle}>
          <PhotoField
            bucket={EQUIPMENT_PHOTO_BUCKET}
            name="photo_url"
            defaultUrl={initial.photo || null}
            aspect="4 / 3"
            labels={te.photo}
            onUploadingChange={setUploading}
            onChange={(url) => {
              setPhoto(url);
              setPhotoTouched(true);
              recheck(url);
            }}
          />
        </Panel>

        <BeforeHydration>
          <div>{button}</div>
        </BeforeHydration>
      </form>
    </>
  );
}

/** Archive or restore, each asked first in a dialog that names the item and the action. */
export function EquipmentArchive({ item, locale }: { item: Equipment; locale: Locale }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setEquipmentArchived, {});
  const t = getAdminDictionary(locale);
  const te = t.equipment;
  const id = useId();
  const archived = item.archived_at !== null;

  return (
    <Panel title={te.archiveTitle} description={archived ? te.restoreLead : te.archiveLead}>
      <form action={action} className="grid justify-items-start gap-2">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="archive" value={archived ? "0" : "1"} />
        <ConfirmDialog
          trigger={archived ? te.restore : te.archive}
          triggerClassName="adm-btn adm-btn-outline"
          disabled={pending}
          title={archived ? te.restoreConfirmTitle(item.name) : te.archiveConfirmTitle(item.name)}
          description={archived ? te.restoreConfirmText : te.archiveConfirmText}
          confirmLabel={archived ? te.restore : te.archive}
          pendingLabel={archived ? te.restoring : te.archiving}
          cancelLabel={t.common.cancel}
          pending={pending}
        />
        <p id={id} aria-live="polite" className="empty:hidden">
          {state.error ? (
            <span role="alert" className="text-sm font-medium text-adm-negative">
              {state.error}
            </span>
          ) : state.ok ? (
            <span className="text-sm text-adm-positive">{state.ok}</span>
          ) : null}
        </p>
      </form>
    </Panel>
  );
}
