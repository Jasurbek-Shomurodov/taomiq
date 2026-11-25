import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/i18n/config";
import {
  isOutboxStatus,
  readTelegramLocale,
  readTelegramSwitches,
  TELEGRAM_SETTING_KEYS,
  type OutboxStatus,
  type TelegramSwitches,
} from "./rules";

/*
 * Reads of the Settings screen's Telegram section (docs/plans/zarkebab-feature-port.md, slice 9a), through the owner's
 * session: the telegram_* settings are owner-only (migration 0026), and so is telegram_status().
 */

export type TelegramSettings = { switches: TelegramSwitches; locale: Locale };

/** The owner's switches and language, each at its default when not set. Throws when the read fails. */
export async function loadTelegramSettings(supabase: SupabaseClient): Promise<TelegramSettings> {
  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", [TELEGRAM_SETTING_KEYS.kinds, TELEGRAM_SETTING_KEYS.locale]);
  if (error) throw new Error(`telegram settings: ${error.code} ${error.message}`);
  const rows = (data ?? []) as { key: unknown; value: unknown }[];
  return {
    switches: readTelegramSwitches(rows.find((row) => row.key === TELEGRAM_SETTING_KEYS.kinds)?.value),
    locale: readTelegramLocale(rows.find((row) => row.key === TELEGRAM_SETTING_KEYS.locale)?.value),
  };
}

export type OutboxItem = {
  id: number;
  createdAt: string;
  kind: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  payload: Record<string, unknown>;
};

export type TelegramStatus = {
  /** Rows created in the last 7 days, by status. */
  counts: Record<OutboxStatus, number>;
  /** Every pending row, of any age: what "Start from now" would skip. */
  pending: number;
  /** Pending rows waiting for a later retry (they go with the next drain: a save, a resend or the morning run). */
  waitingRetry: number;
  /** The latest 20 rows, newest first. */
  recent: OutboxItem[];
};

/** Counts and the latest rows (public.telegram_status). Throws when the read fails. */
export async function loadTelegramStatus(supabase: SupabaseClient): Promise<TelegramStatus> {
  const { data, error } = await supabase.rpc("telegram_status");
  if (error) throw new Error(`telegram status: ${error.code} ${error.message}`);
  const raw = (data ?? {}) as { counts?: unknown; recent?: unknown; pending?: unknown; waiting_retry?: unknown };
  const count = (value: unknown) => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0);
  const counts: Record<OutboxStatus, number> = { pending: 0, sending: 0, sent: 0, failed: 0, uncertain: 0, skipped: 0 };
  if (raw.counts && typeof raw.counts === "object") {
    for (const [status, n] of Object.entries(raw.counts as Record<string, unknown>)) {
      if (isOutboxStatus(status) && Number.isSafeInteger(Number(n))) counts[status] = Number(n);
    }
  }
  const recent = (Array.isArray(raw.recent) ? raw.recent : []).flatMap((row): OutboxItem[] => {
    const r = row as Record<string, unknown>;
    const id = Number(r.id);
    if (!Number.isSafeInteger(id) || !isOutboxStatus(r.status) || typeof r.kind !== "string") return [];
    return [
      {
        id,
        createdAt: String(r.created_at ?? ""),
        kind: r.kind,
        status: r.status,
        attempts: Number(r.attempts) || 0,
        lastError: typeof r.last_error === "string" ? r.last_error : null,
        sentAt: typeof r.sent_at === "string" ? r.sent_at : null,
        payload: r.payload && typeof r.payload === "object" ? (r.payload as Record<string, unknown>) : {},
      },
    ];
  });
  return { counts, pending: count(raw.pending), waitingRetry: count(raw.waiting_retry), recent };
}
