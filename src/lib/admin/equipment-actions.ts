"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminDictionary } from "@/i18n/admin";
import type { FormState } from "./actions";
import { requireStockAccess } from "./auth";
import {
  EQUIPMENT_LIMITS,
  EQUIPMENT_PHOTO_BUCKET,
  checkEquipment,
  equipmentPhotoObject,
  hasEquipmentErrors,
  readCount,
  type EquipmentErrors,
  type EquipmentInput,
} from "./equipment";

/*
 * Equipment register writes (docs/plans/zarkebab-feature-port.md, slice 13; migration 0025). Owners and managers
 * (requireStockAccess; the table's policies check the same role). Items are archived, never deleted. Who counted and
 * when is stamped by the database, never sent from here. Database errors are logged with their code and shown as a
 * sentence in the staff member's language.
 */

export type EquipmentFormState = { fields?: EquipmentErrors; error?: string; ok?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

/**
 * Adds (no id) or saves an item: name, note and photo, plus the first count of a new one (an existing item is counted
 * with its own control). Then goes back to the register.
 */
export async function saveEquipment(_prev: EquipmentFormState, form: FormData): Promise<EquipmentFormState> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).equipment;
  const id = text(form, "id");
  if (id && !UUID_RE.test(id)) return { error: t.errors.notFound };

  const input: EquipmentInput = { name: text(form, "name"), note: text(form, "note"), count: text(form, "count") };
  const fields = checkEquipment(input, !id);
  if (hasEquipmentErrors(fields)) return { fields };

  const photoUrl = text(form, "photo_url");
  // The photo the form was loaded with (as stored, even when the page could not show it). The photo is written only
  // when the photo picker was used and this save changes it, and only if the row still holds the photo the form started
  // from: a stale form would otherwise put back a file already removed. A stored URL that no longer passes the check
  // (another project URL) does not stop a rename: only a new photo is checked.
  const loadedPhoto = text(form, "photo_url_prev");
  const photoChanged = (!id || text(form, "photo_touched") === "1") && photoUrl !== loadedPhoto;
  if (photoChanged && photoUrl && !equipmentPhotoObject(photoUrl)) return { error: t.errors.photoInvalid };

  if (!id) {
    const { error } = await supabase
      .from("equipment")
      .insert({
        name: input.name,
        note: input.note,
        count: readCount(input.count) ?? 0,
        photo_url: photoChanged && photoUrl ? photoUrl : null,
      })
      .select("id");
    if (error) {
      if (error.code === "23505") return { fields: { name: "duplicate" } };
      if (error.code === "23514") return { error: t.errors.photoInvalid };
      console.error("equipment: add failed", error.code);
      return { error: t.errors.failed };
    }
    redirect("/equipment");
  }

  const row = photoChanged
    ? { name: input.name, note: input.note, photo_url: photoUrl || null }
    : { name: input.name, note: input.note };
  let update = supabase.from("equipment").update(row).eq("id", id);
  if (photoChanged) update = loadedPhoto ? update.eq("photo_url", loadedPhoto) : update.is("photo_url", null);
  const { data, error } = await update.select("id");
  if (error) {
    if (error.code === "23505") return { fields: { name: "duplicate" } };
    if (error.code === "23514") return { error: t.errors.photoInvalid };
    console.error("equipment: save failed", error.code);
    return { error: t.errors.failed };
  }
  if (!data?.length) {
    if (!photoChanged) return { error: t.errors.notFound };
    const { data: still } = await supabase.from("equipment").select("id").eq("id", id).maybeSingle();
    return { error: still ? t.errors.photoStale : t.errors.notFound };
  }

  // The row now points at the new photo (or none): remove the file it replaced, only a file of this bucket. A failed
  // removal leaves an orphan file and does not fail the save.
  const oldObject = photoChanged ? equipmentPhotoObject(loadedPhoto) : null;
  if (oldObject) {
    const { error: removeError } = await supabase.storage.from(EQUIPMENT_PHOTO_BUCKET).remove([oldObject]);
    if (removeError) console.error("equipment: removing the replaced photo failed", removeError.message);
  }

  redirect("/equipment");
}

/**
 * The quick count control: sets an item's count. `loaded` is the count the control showed; when someone else changed
 * it since, nothing is written and the control is told the new count (the page refreshes to show it). The database
 * stamps who counted and when.
 */
export async function saveEquipmentCount(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).equipment;
  const id = text(form, "id");
  if (!UUID_RE.test(id)) return { error: t.errors.notFound };
  const count = readCount(text(form, "count"));
  if (count === null) return { error: t.errors.countInvalid(EQUIPMENT_LIMITS.countMax) };
  const loaded = readCount(text(form, "loaded"));

  let update = supabase.from("equipment").update({ count }).eq("id", id).is("archived_at", null);
  if (loaded !== null) update = update.eq("count", loaded);
  const { data, error } = await update.select("id");
  if (error) {
    console.error("equipment: count failed", error.code);
    return { error: t.errors.failed };
  }
  if (!data?.length) {
    const { data: current } = await supabase
      .from("equipment")
      .select("count, archived_at")
      .eq("id", id)
      .maybeSingle();
    if (!current) return { error: t.errors.notFound };
    refresh();
    if (current.archived_at) return { error: t.errors.countArchived };
    return { error: t.errors.countChanged(Number(current.count)) };
  }
  refresh();
  return { ok: t.countSaved };
}

/**
 * "Counted, still N": a recount found the number the control shows. The database stamps who counted and when without
 * changing the count (public.equipment_confirm_count), and refuses when the count is no longer `loaded`.
 */
export async function confirmEquipmentCount(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).equipment;
  const id = text(form, "id");
  if (!UUID_RE.test(id)) return { error: t.errors.notFound };
  const loaded = readCount(text(form, "loaded"));
  if (loaded === null) return { error: t.errors.countInvalid(EQUIPMENT_LIMITS.countMax) };

  const { error } = await supabase.rpc("equipment_confirm_count", { p_id: id, p_loaded: loaded });
  if (error) {
    console.error("equipment: confirm failed", error.code, error.message);
    if (error.code === "P0002") return { error: t.errors.notFound };
    if (error.message === "archived") {
      refresh();
      return { error: t.errors.countArchived };
    }
    if (error.message === "stale") {
      refresh();
      const now = readCount(String(error.details ?? ""));
      return { error: now === null ? t.errors.failed : t.errors.countChanged(now) };
    }
    return { error: t.errors.failed };
  }
  refresh();
  return { ok: t.countConfirmed };
}

/** Archives (archive=1) or restores an item. The page refreshes and says which. */
export async function setEquipmentArchived(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireStockAccess();
  const t = getAdminDictionary(staff.locale).equipment;
  const id = text(form, "id");
  const archive = text(form, "archive") === "1";
  if (!UUID_RE.test(id)) return { error: t.errors.notFound };

  // The database stamps its own clock on archived_at; any non-null value archives.
  const { data, error } = await supabase
    .from("equipment")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id");
  if (error) {
    console.error("equipment: archive failed", error.code);
    if (error.code === "23505") return { error: t.errors.duplicateRestore };
    return { error: t.errors.failed };
  }
  if (!data?.length) return { error: t.errors.notFound };
  refresh();
  return { ok: archive ? t.archived : t.restored };
}
