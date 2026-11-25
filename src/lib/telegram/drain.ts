import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import type { Locale } from "@/i18n/config";
import { createSecretClient } from "@/lib/supabase/secret";
import { isOwnerTelegramConfigured, telegramBotToken, telegramOwnerChatId } from "./config";
import { renderTelegramMessage } from "./render";
import { readTelegramLocale, TELEGRAM_SETTING_KEYS } from "./rules";
import { SEND_TIMEOUT_MS, sendTelegramText } from "./send";

/*
 * Delivery of the owner group's outbox (docs/plans/zarkebab-feature-port.md, slice 9a; migration 0026). Runs after the
 * response of the back-office actions that cause events (scheduleTelegramDrain) and from the daily endpoint, with the
 * server's secret key (the functions are granted to service_role only).
 *
 * One run:
 *   1. takes the "drain running" mark (telegram_drain_begin); while another drain holds it this run ends at once, and
 *      that drain picks up the new rows: telegram_drain_end reports what is due when it gives the mark back, and the
 *      holder goes on while there is anything due and it has time;
 *   2. claims due rows (telegram_claim: a 2-minute lease, skip locked; rows due for more than 24 hours are skipped
 *      there, so switching the chat on later never sends days of old events), sends each, and reports each with its
 *      claim token (telegram_finish);
 *   3. at most 20 messages, one every 3 seconds (Telegram allows a group about 20 a minute). On the first 429 it stops,
 *      sets that row's next attempt to Telegram's retry_after, and hands every other claimed row back (release, the
 *      attempt not counted). Near the end of its time it also hands back what it did not try.
 *
 * Retries: a row that asked for a retry comes back after 30 s, 2 min, 8 min, 32 min (telegram_finish). When a run ends
 * with a retry due within 30 seconds and time is left, the same after() waits for it and runs once more (once, never a
 * loop). Later retries (2, 8 and 32 minutes) ride on the next drain: the next save in the back office that queues or
 * changes something, a resend from Settings, or the morning run. That is a known limit of having no frequent schedule
 * on this plan (Hobby: the one daily schedule); Settings shows how many rows are waiting to retry.
 *
 * Without the owner's chat configured nothing is sent: the daily endpoint marks what is pending as skipped
 * (not_configured).
 */

const MAX_MESSAGES = 20;
const BATCH = 5;
/** Without a chat, rows are only marked skipped: no network, so more per run. */
const MAX_SKIPPED = 1000;
const SKIP_BATCH = 20;
/** At most one message every 3 seconds to the group. */
export const PACE_MS = 3000;
const RPC_TIMEOUT_MS = 5000;
/** The longest a run waits for a retry before its one follow-up run. */
const FOLLOW_UP_WAIT_MAX_MS = 30_000;
/**
 * What the drain after an action may use in all, its one follow-up included, after the response is sent. Server actions
 * run with the platform's default function duration (300 s with Vercel's Fluid compute), well above this.
 */
export const ACTION_DRAIN_BUDGET_MS = 60_000;

export type DrainSummary = {
  sent: number;
  retry: number;
  failed: number;
  uncertain: number;
  skipped: number;
  released: number;
  /** Telegram answered 429 and the run stopped. */
  rateLimited: boolean;
  /** Another drain held the mark, so this one did nothing. */
  busy: boolean;
  /** A follow-up run for a retry due within 30 seconds took place. */
  followUp: boolean;
  /** The run stopped on a database error (logged by code). */
  error: boolean;
};

type ClaimedRow = { id: number; kind: string; payload: unknown; lease: string };

type DrainOptions = {
  /** Milliseconds this drain may take from its start, the follow-up included. */
  budgetMs?: number;
  /** Send for real (default: whether the owner's chat is configured). False marks every due row skipped. */
  deliver?: boolean;
  /** Wait for a retry due within 30 seconds and run once more (default true). */
  followUp?: boolean;
  /** For checks without the network. */
  fetchImpl?: typeof fetch;
  client?: SupabaseClient;
  /** For checks: the gap between two messages (default PACE_MS). */
  paceMs?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown error");

const emptySummary = (): DrainSummary => ({
  sent: 0,
  retry: 0,
  failed: 0,
  uncertain: 0,
  skipped: 0,
  released: 0,
  rateLimited: false,
  busy: false,
  followUp: false,
  error: false,
});

function claimedRows(data: unknown): ClaimedRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = row as { id?: unknown; kind?: unknown; payload?: unknown; lease_until?: unknown };
    const id = Number(r.id);
    // The lease is passed back exactly as it came (a string with microseconds): it is the claim token.
    return Number.isSafeInteger(id) && typeof r.kind === "string" && typeof r.lease_until === "string"
      ? [{ id, kind: r.kind, payload: r.payload, lease: r.lease_until }]
      : [];
  });
}

/** The owner's chosen language for the messages; the default when it cannot be read. */
async function readLocale(supabase: SupabaseClient): Promise<Locale> {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", TELEGRAM_SETTING_KEYS.locale)
    .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS))
    .maybeSingle();
  if (error) console.error("telegram drain: locale read failed", error.code);
  return readTelegramLocale(data?.value);
}

async function rpc(supabase: SupabaseClient, fn: string, args: Record<string, unknown>) {
  try {
    const { data, error } = await supabase.rpc(fn, args).abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
    if (error) {
      console.error(`telegram drain: ${fn} failed`, error.code);
      return { ok: false as const, data: null };
    }
    return { ok: true as const, data };
  } catch (error) {
    console.error(`telegram drain: ${fn} failed`, errorName(error));
    return { ok: false as const, data: null };
  }
}

/** Reports one row with its claim token. A failed report keeps the lease: the row becomes uncertain, never resent. */
async function finish(
  supabase: SupabaseClient,
  row: ClaimedRow,
  status: string,
  code: string | null,
  retryAfter?: number,
): Promise<boolean> {
  const result = await rpc(supabase, "telegram_finish", {
    p_id: row.id,
    p_lease: row.lease,
    p_status: status,
    p_error: code,
    p_retry_after: retryAfter ?? null,
  });
  return result.ok && result.data === true;
}

type RunResult = { summary: DrainSummary; nextRetryInMs: number | null };

/** One run (steps 1–3 above) within `budgetMs` from `started`. */
async function runOnce(
  supabase: SupabaseClient,
  options: { deliver: boolean; locale: Locale; budgetMs: number; paceMs: number; fetchImpl?: typeof fetch },
): Promise<RunResult> {
  const started = Date.now();
  const summary = emptySummary();
  const { deliver, locale, budgetMs, paceMs } = options;
  // Room for one more pause, send and report before the time is up.
  const hasTime = () => Date.now() - started < budgetMs - paceMs - SEND_TIMEOUT_MS - RPC_TIMEOUT_MS;
  const limit = deliver ? MAX_MESSAGES : MAX_SKIPPED;
  let handled = 0;
  let lastSendAt: number | null = null;
  let nextRetryInMs: number | null = null;

  while (true) {
    const begun = await rpc(supabase, "telegram_drain_begin", { p_seconds: Math.ceil(budgetMs / 1000) + 10 });
    if (!begun.ok) {
      summary.error = true;
      break;
    }
    const token = typeof begun.data === "string" ? begun.data : null;
    if (!token) {
      // Another drain is running: it reports what is due when it ends and takes it then.
      summary.busy = handled === 0;
      break;
    }

    while (handled < limit && hasTime() && !summary.rateLimited) {
      const claimed = await rpc(supabase, "telegram_claim", {
        p_limit: Math.min(deliver ? BATCH : SKIP_BATCH, limit - handled),
      });
      if (!claimed.ok) {
        summary.error = true;
        break;
      }
      const rows = claimedRows(claimed.data);
      if (rows.length === 0) break;
      handled += rows.length;

      for (const row of rows) {
        if (!deliver) {
          if (await finish(supabase, row, "skipped", "not_configured")) summary.skipped++;
          continue;
        }
        if (summary.rateLimited || !hasTime()) {
          if (await finish(supabase, row, "release", null)) summary.released++;
          continue;
        }
        if (lastSendAt !== null) {
          const wait = lastSendAt + paceMs - Date.now();
          if (wait > 0) await sleep(wait);
        }
        lastSendAt = Date.now();
        const text = renderTelegramMessage(row.kind, row.payload, locale);
        const outcome = await sendTelegramText(telegramBotToken, telegramOwnerChatId, text, options.fetchImpl);
        if (outcome.result !== "sent") console.error("telegram drain: not sent", row.kind, outcome.result, outcome.code);
        if (outcome.code === "http_429") summary.rateLimited = true;
        if (await finish(supabase, row, outcome.result, outcome.code, outcome.retryAfter)) summary[outcome.result]++;
      }
    }

    const ended = await rpc(supabase, "telegram_drain_end", { p_token: token });
    const info = (ended.data ?? {}) as { due?: unknown; next_retry_in?: unknown };
    const nextIn = Number(info.next_retry_in);
    nextRetryInMs = info.next_retry_in != null && Number.isFinite(nextIn) ? Math.max(nextIn, 0) * 1000 : null;
    // Rows queued while the mark was held (their own drain found it taken): take them now, if there is room.
    const due = Number(info.due) || 0;
    if (!ended.ok || summary.error || summary.rateLimited || due === 0 || handled >= limit || !hasTime()) break;
  }

  return { summary, nextRetryInMs };
}

function merge(a: DrainSummary, b: DrainSummary): DrainSummary {
  return {
    sent: a.sent + b.sent,
    retry: a.retry + b.retry,
    failed: a.failed + b.failed,
    uncertain: a.uncertain + b.uncertain,
    skipped: a.skipped + b.skipped,
    released: a.released + b.released,
    rateLimited: a.rateLimited || b.rateLimited,
    busy: a.busy,
    followUp: true,
    error: a.error || b.error,
  };
}

/** Delivers (or, without a chat, skips) what is due, with at most one follow-up run for a near retry. Never throws. */
export async function drainTelegramOutbox(options: DrainOptions = {}): Promise<DrainSummary> {
  const started = Date.now();
  const budget = options.budgetMs ?? ACTION_DRAIN_BUDGET_MS;
  const deliver = options.deliver ?? isOwnerTelegramConfigured;
  const paceMs = options.paceMs ?? PACE_MS;
  const remaining = () => budget - (Date.now() - started);

  try {
    const supabase = options.client ?? createSecretClient();
    const locale = deliver ? await readLocale(supabase) : "ru";
    const run = { deliver, locale, paceMs, fetchImpl: options.fetchImpl };
    const first = await runOnce(supabase, { ...run, budgetMs: remaining() });

    // One follow-up for a retry due within 30 seconds (a 429's retry_after, or the first 30-second backoff), when the
    // wait and one more send still fit. Once, never a loop.
    const wait = first.nextRetryInMs;
    const minRun = paceMs + SEND_TIMEOUT_MS + 3 * 5000;
    if (
      deliver &&
      (options.followUp ?? true) &&
      !first.summary.error &&
      wait !== null &&
      wait <= FOLLOW_UP_WAIT_MAX_MS &&
      remaining() - wait - 500 >= minRun
    ) {
      await sleep(wait + 500);
      const second = await runOnce(supabase, { ...run, budgetMs: remaining() });
      return merge(first.summary, second.summary);
    }
    return first.summary;
  } catch (error) {
    console.error("telegram drain: failed", errorName(error));
    return { ...emptySummary(), error: true };
  }
}

/**
 * Delivers what the action just queued, after the response is sent: a Telegram outage never slows or fails the save.
 * Does nothing unless the owner's chat is configured (then the rows wait, and the daily endpoint skips them). Never
 * throws.
 */
export function scheduleTelegramDrain(): void {
  if (!isOwnerTelegramConfigured) return;
  try {
    after(async () => {
      await drainTelegramOutbox();
    });
  } catch (error) {
    console.error("telegram drain: not scheduled", errorName(error));
  }
}
