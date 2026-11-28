"use server";

import { refresh, updateTag } from "next/cache";
import { getAdminDictionary } from "@/i18n/admin";
import { CATALOG_TAG } from "@/lib/data/catalog";
import { notifySiteChange } from "@/lib/indexnow/ping";
import type { PublicSetting } from "@/lib/indexnow/shared";
import type { FormState } from "./actions";
import { requireOwner } from "./auth";
import {
  SETTING_KEYS,
  SETTING_LIMITS,
  checkWindows,
  joinWindow,
  readContactPhone,
  readContactTelegram,
  readCutoffHour,
  readCycleAnchor,
  type BusinessSettingName,
} from "./settings-rules";

/*
 * Writes of the Settings screen (docs/plans/zarkebab-feature-port.md, slice 1), owner only: one action per setting, so
 * each control saves on its own. Each checks the owner first (requireOwner redirects anyone else), then the value with
 * the rules in settings-rules.ts, which the database checks again (private.check_catalogue_setting, migration 0017).
 * The finance settings save through saveFinanceSetting (finance/actions.ts). Database errors are logged with their code
 * and shown as a sentence in the owner's language, never raw.
 */

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

type Session = Awaited<ReturnType<typeof requireOwner>>;

/**
 * Writes one row of public.settings. `publicSite`: the public site reads this key through the catalogue cache
 * (lib/data/catalog.ts), so that cache is expired and the next visitor gets the new value.
 */
async function write(
  { supabase, staff }: Session,
  name: BusinessSettingName,
  value: string | number | string[],
  publicSite: boolean,
): Promise<FormState> {
  const t = getAdminDictionary(staff.locale).settings;
  const key = SETTING_KEYS[name];
  const { error } = await supabase.from("settings").upsert({ key, value }, { onConflict: "key" });
  if (error) {
    console.error("settings: save failed", key, error.code, error.message);
    if (error.code === "42501") return { error: t.errors.denied };
    if (error.code === "23514") return { error: t.errors.invalid };
    return { error: t.errors.saveFailed };
  }
  if (publicSite) {
    updateTag(CATALOG_TAG);
    if (isPublicSetting(name)) notifySiteChange({ kind: "setting", name });
  }
  refresh();
  return { ok: t.saved };
}

const PUBLIC_SETTINGS: readonly string[] = ["deliveryWindows", "cutoffHour", "cycleAnchor"] satisfies PublicSetting[];
const isPublicSetting = (name: BusinessSettingName): name is BusinessSettingName & PublicSetting =>
  PUBLIC_SETTINGS.includes(name);

/** The delivery windows offered on the order form, in the order given: `from` and `to` fields, one pair per window. */
export async function saveDeliveryWindows(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireOwner();
  const e = getAdminDictionary(session.staff.locale).settings.errors;
  const froms = form.getAll("from").map((v) => String(v).trim());
  const tos = form.getAll("to").map((v) => String(v).trim());
  if (froms.length !== tos.length) return { error: e.windowsTime };
  const windows = froms.map((from, i) => ({ from, to: tos[i] }));
  const problem = checkWindows(windows);
  if (problem === "empty") return { error: e.windowsEmpty };
  if (problem === "tooMany") return { error: e.windowsTooMany(SETTING_LIMITS.windowsMax) };
  if (problem === "time") return { error: e.windowsTime };
  if (problem === "order") return { error: e.windowsOrder };
  if (problem === "duplicate") return { error: e.windowsDuplicate };
  return write(session, "deliveryWindows", windows.map(joinWindow), true);
}

/** The Tashkent hour before which an order can start the next day. */
export async function saveCutoffHour(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireOwner();
  const e = getAdminDictionary(session.staff.locale).settings.errors;
  const hour = readCutoffHour(text(form, "value"));
  if (hour === null) return { error: e.cutoff };
  return write(session, "cutoffHour", hour, true);
}

/** The first day of the 30-day menu cycle: it decides which cycle day is served on any date. */
export async function saveCycleAnchor(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireOwner();
  const e = getAdminDictionary(session.staff.locale).settings.errors;
  const anchor = readCycleAnchor(text(form, "value"));
  if (anchor === null) return { error: e.anchor };
  return write(session, "cycleAnchor", anchor, true);
}

/** The business phone (empty: none). Stored now; the public site shows it from slice 12 on. */
export async function saveContactPhone(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireOwner();
  const e = getAdminDictionary(session.staff.locale).settings.errors;
  const phone = readContactPhone(text(form, "value"));
  if (phone === null) return { error: e.phone };
  return write(session, "contactPhone", phone, false);
}

/** The business Telegram username, without "@" (empty: none). Stored now; shown publicly from slice 12 on. */
export async function saveContactTelegram(_prev: FormState, form: FormData): Promise<FormState> {
  const session = await requireOwner();
  const e = getAdminDictionary(session.staff.locale).settings.errors;
  const username = readContactTelegram(text(form, "value"));
  if (username === null) return { error: e.telegram };
  return write(session, "contactTelegram", username, false);
}
