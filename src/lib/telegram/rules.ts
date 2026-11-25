import { isLocale, type Locale } from "@/i18n/config";

/*
 * The owner group's Telegram messages (docs/plans/zarkebab-feature-port.md, slice 9a): the kinds, the owner's switches
 * and language, and the outbox statuses. Pure, so the Settings controls (client) and the server share it. The database
 * checks the same values (migration 0026: private.check_telegram_setting, private.telegram_kind_on).
 */

/** The kinds the owner can switch on and off, in the order Settings lists them. */
export const TELEGRAM_KINDS = ["order", "finance", "investor", "purchase", "close", "digest", "payroll", "team"] as const;
export type TelegramKind = (typeof TELEGRAM_KINDS)[number];

/** Every kind an outbox row can have: the switchable ones and the test message. */
export type OutboxKind = TelegramKind | "test";

export type TelegramSwitches = Record<TelegramKind, boolean>;

/** On unless the owner switched it off; payroll and team are off until switched on (the same rule as the database). */
export const DEFAULT_TELEGRAM_SWITCHES: TelegramSwitches = {
  order: true,
  finance: true,
  investor: true,
  purchase: true,
  close: true,
  digest: true,
  payroll: false,
  team: false,
};

export const TELEGRAM_SETTING_KEYS = {
  kinds: "telegram_owner_kinds",
  locale: "telegram_owner_locale",
} as const;

/** The messages' language when the owner has not chosen one. */
export const DEFAULT_TELEGRAM_LOCALE: Locale = "ru";

export const OUTBOX_STATUSES = ["pending", "sending", "sent", "failed", "uncertain", "skipped"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export function isTelegramKind(value: unknown): value is TelegramKind {
  return typeof value === "string" && (TELEGRAM_KINDS as readonly string[]).includes(value);
}

export function isOutboxStatus(value: unknown): value is OutboxStatus {
  return typeof value === "string" && (OUTBOX_STATUSES as readonly string[]).includes(value);
}

export type OutboxReason =
  | "forbidden"
  | "refused"
  | "rateLimited"
  | "timeout"
  | "serverError"
  | "network"
  | "leaseExpired"
  | "notConfigured"
  | "expired"
  | "skippedByOwner"
  | "other";

/**
 * What an outbox row's last_error code (src/lib/telegram/send.ts, migration 0026) means for the owner. 400, 401, 403
 * and 404 are what Telegram answers for a wrong chat id, a bad token or a bot that is not in the group.
 */
export function outboxReason(code: string): OutboxReason {
  if (["http_400", "http_401", "http_403", "http_404"].includes(code)) return "forbidden";
  if (code === "http_429") return "rateLimited";
  if (/^http_4\d\d$/.test(code)) return "refused";
  if (/^http_5\d\d$/.test(code)) return "serverError";
  if (code === "timeout") return "timeout";
  if (code === "network" || code.startsWith("net_")) return "network";
  if (code === "lease_expired") return "leaseExpired";
  if (code === "not_configured") return "notConfigured";
  if (code === "expired") return "expired";
  if (code === "skipped_by_owner") return "skippedByOwner";
  return "other";
}

/** The stored switches (a JSON object of booleans), each missing or malformed kind at its default. */
export function readTelegramSwitches(value: unknown): TelegramSwitches {
  const switches = { ...DEFAULT_TELEGRAM_SWITCHES };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
      if (isTelegramKind(key) && typeof on === "boolean") switches[key] = on;
    }
  }
  return switches;
}

/** The stored language, else the default. */
export function readTelegramLocale(value: unknown): Locale {
  return typeof value === "string" && isLocale(value) ? value : DEFAULT_TELEGRAM_LOCALE;
}
