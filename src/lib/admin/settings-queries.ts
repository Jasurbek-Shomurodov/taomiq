import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authMethods } from "@/lib/account/methods";
import { posthogKey } from "@/lib/analytics/config";
import { DEMO_ANCHOR } from "@/lib/data/demo";
import { DEFAULT_CUTOFF_HOUR, DEFAULT_DELIVERY_WINDOWS } from "@/lib/order/rules";
import { isOrderAlertConfigured } from "@/lib/order/telegram";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isOrderingConfigured } from "@/lib/supabase/secret";
import { isDailyEndpointConfigured, isOwnerTelegramConfigured } from "@/lib/telegram/config";
import { isTurnstileConfigured } from "@/lib/turnstile/config";
import { isCalendarDay } from "./finance/month";
import { isAdminGoogleLoginOn } from "./google";
import { SETTING_KEYS, type BusinessSettings } from "./settings-rules";

/*
 * Reads of the Settings screen (docs/plans/zarkebab-feature-port.md, slice 1), through the owner's session.
 */

/**
 * The settings from public.settings rows ({ key, value }). A missing or malformed value falls back the way the public
 * site does (lib/data/catalog.ts: the default windows and cutoff; kitchen.ts: the demo anchor), and contacts to "".
 */
export function parseBusinessSettings(rows: readonly { key: unknown; value: unknown }[]): BusinessSettings {
  const settings: BusinessSettings = {
    deliveryWindows: DEFAULT_DELIVERY_WINDOWS,
    cutoffHour: DEFAULT_CUTOFF_HOUR,
    cycleAnchor: DEMO_ANCHOR,
    contactPhone: "",
    contactTelegram: "",
  };
  for (const { key, value } of rows) {
    if (key === SETTING_KEYS.deliveryWindows) {
      if (Array.isArray(value) && value.length > 0 && value.every((w) => typeof w === "string")) {
        settings.deliveryWindows = value as string[];
      }
    } else if (key === SETTING_KEYS.cutoffHour) {
      const hour = Number(value);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 24) settings.cutoffHour = hour;
    } else if (key === SETTING_KEYS.cycleAnchor) {
      if (typeof value === "string" && isCalendarDay(value)) settings.cycleAnchor = value;
    } else if (key === SETTING_KEYS.contactPhone) {
      if (typeof value === "string") settings.contactPhone = value;
    } else if (key === SETTING_KEYS.contactTelegram) {
      if (typeof value === "string") settings.contactTelegram = value;
    }
  }
  return settings;
}

/** Delivery windows, cutoff hour, cycle start and contacts. Throws when the read fails. */
export async function loadBusinessSettings(supabase: SupabaseClient): Promise<BusinessSettings> {
  const { data, error } = await supabase.from("settings").select("key, value").in("key", Object.values(SETTING_KEYS));
  if (error) throw new Error(`settings: ${error.code} ${error.message}`);
  return parseBusinessSettings((data ?? []) as { key: unknown; value: unknown }[]);
}

export type AppliedMigrations = { count: number; latest: string | null };

/**
 * The applied migrations as Supabase records them (public.applied_migrations_summary, migration 0017): their number
 * and the latest one's name. Null when the database keeps no record (a local test database). Throws when the read
 * fails, including before 0017 is applied.
 */
export async function loadAppliedMigrations(supabase: SupabaseClient): Promise<AppliedMigrations | null> {
  const { data, error } = await supabase.rpc("applied_migrations_summary");
  if (error) throw new Error(`applied migrations: ${error.code} ${error.message}`);
  if (!data || typeof data !== "object") return null;
  const row = data as { count?: unknown; latest_version?: unknown; latest_name?: unknown };
  const count = Number(row.count);
  if (!Number.isSafeInteger(count) || count < 0) return null;
  const name = typeof row.latest_name === "string" && row.latest_name ? row.latest_name : null;
  const version = typeof row.latest_version === "string" && row.latest_version ? row.latest_version : null;
  return { count, latest: name ?? version };
}

export type IntegrationKey =
  | "database"
  | "ordering"
  | "telegramAlert"
  | "turnstile"
  | "analytics"
  | "customerSignIn"
  | "staffGoogle"
  | "telegramOwner"
  | "dailyRun";

export type Integration = {
  key: IntegrationKey;
  /** The environment variables it needs: names only, never values. */
  env: readonly string[];
  on: boolean;
  /** For customer sign-in: the methods switched on. */
  detail?: string;
};

/**
 * Which optional integrations this deployment has configured, from the same flags the features themselves use. Only
 * whether each is on leaves the server; no value is ever read out.
 */
export function integrations(): Integration[] {
  return [
    { key: "database", env: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"], on: isSupabaseConfigured },
    { key: "ordering", env: ["SUPABASE_SECRET_KEY"], on: isOrderingConfigured },
    { key: "telegramAlert", env: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_STAFF_CHAT_ID"], on: isOrderAlertConfigured },
    { key: "turnstile", env: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"], on: isTurnstileConfigured },
    { key: "analytics", env: ["NEXT_PUBLIC_POSTHOG_KEY"], on: Boolean(posthogKey) },
    {
      key: "customerSignIn",
      env: ["NEXT_PUBLIC_AUTH_METHODS"],
      on: authMethods.length > 0,
      detail: authMethods.length > 0 ? authMethods.join(", ") : undefined,
    },
    { key: "staffGoogle", env: ["ADMIN_GOOGLE_LOGIN"], on: isAdminGoogleLoginOn() },
    // Slice 9a (migration 0026): the owner group's messages also need the secret key, as "ordering" does.
    { key: "telegramOwner", env: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_CHAT_ID"], on: isOwnerTelegramConfigured },
    { key: "dailyRun", env: ["CRON_SECRET"], on: isDailyEndpointConfigured },
  ];
}
