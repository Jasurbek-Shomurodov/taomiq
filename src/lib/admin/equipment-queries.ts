import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EQUIPMENT_HISTORY_LIMIT,
  isEquipmentEventKind,
  type Equipment,
  type EquipmentEvent,
} from "./equipment";
import { readCapped } from "./stats";

/*
 * Reads of the equipment register of migration 0025, through the signed-in session. Owners and managers only: RLS
 * returns nothing to anyone else. Each throws on a failed read; the pages turn that into a notice.
 */

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

const EQUIPMENT_COLUMNS = "id, name, count, note, photo_url, counted_at, counted_by_name, archived_at, updated_at";

function toEquipment(raw: Record<string, unknown>): Equipment {
  return {
    id: String(raw.id),
    name: str(raw.name),
    count: num(raw.count),
    note: str(raw.note),
    photo_url: typeof raw.photo_url === "string" && raw.photo_url ? raw.photo_url : null,
    counted_at: str(raw.counted_at),
    counted_by_name: str(raw.counted_by_name),
    archived_at: typeof raw.archived_at === "string" ? raw.archived_at : null,
    updated_at: str(raw.updated_at),
  };
}

/** The most items the register reads (a kitchen owns a few hundred things at most). */
const EQUIPMENT_CAP = 5000;

/**
 * Every item, active and archived (the register is small; the screen filters it). Read page by page through range()
 * (the API returns at most 1000 rows per request), with `id` breaking ties so pages neither repeat nor skip.
 */
export async function listEquipment(supabase: SupabaseClient): Promise<Equipment[]> {
  const page = async (start: number, end: number): Promise<Equipment[]> => {
    const { data, error } = await supabase
      .from("equipment")
      .select(EQUIPMENT_COLUMNS)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(start, end);
    if (error) {
      if (error.code === "PGRST103") return [];
      throw new Error(`equipment: ${error.code} ${error.message}`);
    }
    return ((data ?? []) as Record<string, unknown>[]).map(toEquipment);
  };
  const { rows, partial } = await readCapped(page, EQUIPMENT_CAP);
  if (partial) console.error(`equipment: more than ${EQUIPMENT_CAP}, the list is cut`);
  return rows;
}

export async function getEquipment(supabase: SupabaseClient, id: string): Promise<Equipment | null> {
  const { data, error } = await supabase.from("equipment").select(EQUIPMENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    // A malformed id is "no such item", not a failure.
    if (error.code === "22P02") return null;
    throw new Error(`equipment: ${error.code} ${error.message}`);
  }
  return data ? toEquipment(data as Record<string, unknown>) : null;
}

/** An item's history, newest first (public.equipment_events, written by the database on every change). */
export async function listEquipmentEvents(supabase: SupabaseClient, id: string): Promise<EquipmentEvent[]> {
  const { data, error } = await supabase
    .from("equipment_events")
    .select("id, at, actor, actor_name, kind, detail")
    .eq("equipment_id", id)
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(EQUIPMENT_HISTORY_LIMIT);
  if (error) throw new Error(`equipment_events: ${error.code} ${error.message}`);
  const events: EquipmentEvent[] = [];
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    if (!isEquipmentEventKind(raw.kind)) continue;
    const detail = raw.detail;
    events.push({
      id: num(raw.id),
      at: str(raw.at),
      actor: typeof raw.actor === "string" ? raw.actor : null,
      actor_name: str(raw.actor_name),
      kind: raw.kind,
      detail: detail && typeof detail === "object" && !Array.isArray(detail) ? (detail as Record<string, unknown>) : {},
    });
  }
  return events;
}
