import { createHash, timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { tashkentDay } from "@/lib/admin/stats";
import { createSecretClient, isOrderingConfigured } from "@/lib/supabase/secret";
import { cronSecret, isOwnerTelegramConfigured } from "@/lib/telegram/config";
import { drainTelegramOutbox } from "@/lib/telegram/drain";

/**
 * The daily run of the owner group's Telegram messages (docs/plans/zarkebab-feature-port.md, slice 9a): once a day at
 * 08:00 Tashkent, by the schedule "telegram-daily" in vercel.json. It
 *   1. skips pending messages due for more than 24 hours (telegram_expire), so switching the chat on later never floods
 *      it with old news;
 *   2. queues the morning digest for the Tashkent day, once per day however often it is called (dedupe_key
 *      digest:<day>; nothing when the owner switched the digest off or no chat is configured);
 *   3. delivers what is due (at most 20 messages, one every 3 seconds), or, without a chat configured, marks it skipped.
 *
 * Served as taomiq.uz/api/telegram/daily: src/proxy.ts never sees /api/* (its matcher skips it), so the path is not
 * redirected to a locale. Protected by CRON_SECRET, which Vercel sends as "Authorization: Bearer <CRON_SECRET>": 503
 * while the secret is not configured, 401 for any other header (compared in constant time). GET (the schedule) and
 * POST both run it. The answer holds counts only.
 */

/*
 * What the scheduler must send: GET https://taomiq.uz/api/telegram/daily with the header
 *   Authorization: Bearer <the value of CRON_SECRET in the Production environment>
 * Vercel adds that header itself when CRON_SECRET is set (schedule "telegram-daily", a path target). A 401 in the
 * schedule's execution history means the secret or the header is wrong (the variable missing from Production, set after
 * the last deployment, or different from what is sent); a 503 means CRON_SECRET is not set at all.
 */

/** The whole run, from the request's start, stays inside this. */
export const maxDuration = 60;
/** All the work of one call, counted from the request's start: expire, digest and the drain. */
const RUN_BUDGET_MS = 50_000;

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } as const;

const json = (body: unknown, status: number) => Response.json(body, { status, headers: HEADERS });

/** Constant-time: both sides are hashed first, so neither the length nor a prefix of the secret leaks. */
function authorized(header: string | null, secret: string): boolean {
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const given = createHash("sha256").update(header ?? "").digest();
  return timingSafeEqual(expected, given);
}

async function run(request: Request): Promise<Response> {
  const started = Date.now();
  await connection();
  if (!cronSecret) return json({ error: "not_configured" }, 503);
  if (!authorized(request.headers.get("authorization"), cronSecret)) return json({ error: "unauthorized" }, 401);
  if (!isOrderingConfigured) return json({ error: "database_not_configured" }, 503);

  const supabase = createSecretClient();
  const day = tashkentDay(new Date())!;

  let expired: number | null = null;
  const expire = await supabase.rpc("telegram_expire").abortSignal(AbortSignal.timeout(10_000));
  if (expire.error) console.error("telegram daily: expire failed", expire.error.code);
  else expired = Number(expire.data) || 0;

  let digest: string = "not_configured";
  if (isOwnerTelegramConfigured) {
    const queued = await supabase
      .rpc("telegram_queue_digest", { p_day: day })
      .abortSignal(AbortSignal.timeout(15_000));
    if (queued.error) {
      console.error("telegram daily: digest failed", queued.error.code);
      digest = "failed";
    } else {
      digest = typeof queued.data === "string" ? queued.data : "unknown";
    }
  }

  // What is left of the run's time after the expire and digest calls, so the function never outlives maxDuration.
  const drained = await drainTelegramOutbox({ budgetMs: RUN_BUDGET_MS - (Date.now() - started), client: supabase });
  const failed = expire.error !== null || digest === "failed" || drained.error;
  return json({ day, expired, digest, drained }, failed ? 500 : 200);
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}
