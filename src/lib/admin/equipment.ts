import type { Locale } from "@/i18n/config";
import type { AdminDictionary } from "@/i18n/admin/ru";
import { supabaseUrl } from "@/lib/supabase/env";
import { readWholeNumber } from "./ingredients";
import { formatDateTime } from "./orders";

/*
 * The equipment register (docs/plans/zarkebab-feature-port.md, slice 13; migration 0025, public.equipment and
 * public.equipment_events). Pure and not server-only: the editor and the count control (client components) check with
 * these rules, the actions check again, and the table's checks are the authority. Keep the limits in step with the
 * migration.
 */

export const EQUIPMENT_LIMITS = {
  nameMax: 120,
  noteMax: 500,
  /** The table's check: 0 ≤ count ≤ 100 000. */
  countMax: 100_000,
} as const;

/** The public bucket the photos live in (migration 0025); PhotoField uploads there. */
export const EQUIPMENT_PHOTO_BUCKET = "equipment-photos";

/**
 * The start of every public URL in the equipment-photos bucket of this project, built the way supabase-js builds it
 * (getPublicUrl), so a trailing slash in the environment value does not matter. Empty without a project URL.
 */
function photoPrefix(): string {
  const base = supabaseUrl.trim();
  if (!base) return "";
  try {
    return new URL(`storage/v1/object/public/${EQUIPMENT_PHOTO_BUCKET}/`, base.endsWith("/") ? base : `${base}/`).href;
  } catch {
    return "";
  }
}

/**
 * The object name of a photo URL, or null when the URL is not a file at the top of this project's equipment-photos
 * bucket (PhotoField names files `<uuid>.jpg`). The save action accepts only such URLs, and the pages show a photo only
 * for one, so a stored URL from elsewhere can never be rendered. The table's check holds the same file-name pattern.
 */
export function equipmentPhotoObject(url: string | null | undefined): string | null {
  if (!url) return null;
  const prefix = photoPrefix();
  if (!prefix || !url.startsWith(prefix)) return null;
  const objectName = url.slice(prefix.length);
  return /^[A-Za-z0-9][A-Za-z0-9_-]*\.jpg$/.test(objectName) ? objectName : null;
}

/** The URL to render for an item's photo: the stored one when it passes equipmentPhotoObject, else null (no photo). */
export function equipmentPhotoToShow(url: string | null | undefined): string | null {
  return url && equipmentPhotoObject(url) ? url : null;
}

/** The register's two lists: in use and archived. */
export const EQUIPMENT_STATUSES = ["active", "archived"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export function isEquipmentStatus(value: unknown): value is EquipmentStatus {
  return typeof value === "string" && (EQUIPMENT_STATUSES as readonly string[]).includes(value);
}

export type Equipment = {
  id: string;
  name: string;
  count: number;
  note: string;
  photo_url: string | null;
  /** When the count was last set, stamped by the database. */
  counted_at: string;
  /** Who set it (the name kept at the time); "" when nobody signed in did (a migration, the secret key). */
  counted_by_name: string;
  archived_at: string | null;
  updated_at: string;
};

/** The history's kinds; the table's check holds the same list. */
export const EQUIPMENT_EVENT_KINDS = ["added", "counted", "confirmed", "renamed", "archived", "restored"] as const;
export type EquipmentEventKind = (typeof EQUIPMENT_EVENT_KINDS)[number];

export function isEquipmentEventKind(value: unknown): value is EquipmentEventKind {
  return typeof value === "string" && (EQUIPMENT_EVENT_KINDS as readonly string[]).includes(value);
}

export type EquipmentEvent = {
  id: number;
  at: string;
  actor: string | null;
  actor_name: string;
  kind: EquipmentEventKind;
  /** added / confirmed / archived / restored: { name, count } · counted: { name, from, to } · renamed: { from, to }. */
  detail: Record<string, unknown>;
};

/** How many events the item page shows (newest first). */
export const EQUIPMENT_HISTORY_LIMIT = 100;

export type EquipmentField = "name" | "note" | "count";
export type EquipmentProblem = "required" | "too_long" | "invalid" | "duplicate";
export type EquipmentErrors = Partial<Record<EquipmentField, EquipmentProblem>>;

export type EquipmentInput = {
  name: string;
  note: string;
  /** As typed; checked only when `withCount` (a new item: an existing one is counted with its own control). */
  count: string;
};

/** Length as Postgres char_length counts it: code points, not UTF-16 units. */
const length = (value: string) => [...value].length;

/** A count as typed ("12", "1 200"): the number, or null when it is empty or not a whole number in range. */
export function readCount(raw: string): number | null {
  const value = readWholeNumber(raw);
  if (value === null || value === "invalid" || value > EQUIPMENT_LIMITS.countMax) return null;
  return value;
}

export function checkEquipment(input: EquipmentInput, withCount: boolean): EquipmentErrors {
  const errors: EquipmentErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = "required";
  else if (length(name) > EQUIPMENT_LIMITS.nameMax) errors.name = "too_long";
  if (length(input.note.trim()) > EQUIPMENT_LIMITS.noteMax) errors.note = "too_long";
  if (withCount && readCount(input.count) === null) errors.count = "invalid";
  return errors;
}

export function hasEquipmentErrors(errors: EquipmentErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** "Посчитано 25.11.2026, 14:05 · Азиз": when the count was last set and by whom (Tashkent time). */
export function countedLine(item: Pick<Equipment, "counted_at" | "counted_by_name">, t: AdminDictionary, locale: Locale): string {
  const when = item.counted_at ? formatDateTime(item.counted_at, locale) : "—";
  const who = item.counted_by_name.trim();
  return who ? t.equipment.countedBy(when, who) : t.equipment.counted(when);
}

/** A count kept inside the table's range, for the − and + buttons. */
export function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(EQUIPMENT_LIMITS.countMax, Math.max(0, Math.round(value)));
}
