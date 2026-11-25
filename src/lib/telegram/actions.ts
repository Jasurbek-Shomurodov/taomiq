"use server";

import { refresh } from "next/cache";
import { getAdminDictionary } from "@/i18n/admin";
import { isLocale } from "@/i18n/config";
import type { FormState } from "@/lib/admin/actions";
import { requireOwner } from "@/lib/admin/auth";
import { isOwnerTelegramConfigured } from "./config";
import { scheduleTelegramDrain } from "./drain";
import { TELEGRAM_KINDS, TELEGRAM_SETTING_KEYS, type TelegramSwitches } from "./rules";

/*
 * Writes of the Settings screen's Telegram section (docs/plans/zarkebab-feature-port.md, slice 9a), owner only
 * (requireOwner redirects anyone else; the settings write policy and the telegram_* functions check the owner again).
 * Each control saves on its own. Database errors are logged with their code and shown as a sentence.
 */

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

type Session = Awaited<ReturnType<typeof requireOwner>>;

async function writeSetting({ supabase, staff }: Session, key: string, value: unknown): Promise<FormState> {
  const t = getAdminDictionary(staff.locale).settings;
  const { error } = await supabase.from("settings").upsert({ key, value }, { onConflict: "key" });
  if (error) {
    console.error("telegram settings: save failed", key, error.code, error.message);
    if (error.code === "42501") return { error: t.errors.denied };
    if (error.code === "23514") return { error: t.errors.invalid };
    return { error: t.errors.saveFailed };
  }
  refresh();
  return { ok: t.saved };
}

/** Which kinds of messages the group gets: the form sends one `on` value per kind switched on; the rest are off. */
export async function saveTelegramSwitches(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireOwner();
  const on = new Set(form.getAll("on").map((value) => String(value)));
  const switches = Object.fromEntries(TELEGRAM_KINDS.map((kind) => [kind, on.has(kind)])) as TelegramSwitches;
  return writeSetting(session, TELEGRAM_SETTING_KEYS.kinds, switches);
}

/** The language of the group's messages. */
export async function saveTelegramLocale(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireOwner();
  const value = text(form, "value");
  if (!isLocale(value)) return { error: getAdminDictionary(session.staff.locale).settings.errors.invalid };
  return writeSetting(session, TELEGRAM_SETTING_KEYS.locale, value);
}

/** Queues one test message (at most one per 30 seconds) and delivers it after the response. */
export async function sendTelegramTest(): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const tg = getAdminDictionary(staff.locale).settings.tg;
  if (!isOwnerTelegramConfigured) return { error: tg.testOff };
  const { data, error } = await supabase.rpc("telegram_test");
  if (error) {
    console.error("telegram: test failed", error.code);
    return { error: error.code === "42501" ? tg.denied : tg.failed };
  }
  refresh();
  if (data !== true) return { error: tg.testAgain };
  scheduleTelegramDrain();
  return { ok: tg.testQueued };
}

/** A failed or uncertain message back in the queue, delivered after the response. */
export async function resendTelegram(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const tg = getAdminDictionary(staff.locale).settings.tg;
  const id = Number(text(form, "id"));
  if (!Number.isSafeInteger(id) || id <= 0) return { error: tg.resendGone };
  const { data, error } = await supabase.rpc("telegram_resend", { p_id: id });
  if (error) {
    console.error("telegram: resend failed", error.code);
    return { error: error.code === "42501" ? tg.denied : tg.failed };
  }
  refresh();
  if (data !== true) return { error: tg.resendGone };
  scheduleTelegramDrain();
  return { ok: tg.resent };
}

/** "Start from now": every pending message is skipped, so switching the chat on does not send what queued before. */
export async function skipTelegramBacklog(): Promise<FormState> {
  const { supabase, staff } = await requireOwner();
  const tg = getAdminDictionary(staff.locale).settings.tg;
  const { data, error } = await supabase.rpc("telegram_skip_pending");
  if (error) {
    console.error("telegram: skip pending failed", error.code);
    return { error: error.code === "42501" ? tg.denied : tg.failed };
  }
  refresh();
  return { ok: tg.backlog.done(Number(data) || 0) };
}
