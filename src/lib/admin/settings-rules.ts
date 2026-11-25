import { CYCLE_DAYS } from "@/lib/data/types";
import { PHONE_RE, phoneDigits } from "@/lib/order/rules";
import { isCalendarDay } from "./finance/month";

/*
 * The business settings of the Settings screen (docs/plans/zarkebab-feature-port.md, slice 1): rows of public.settings,
 * readable by everyone, writable by the owner only (0001, 0003). The database checks the same rules
 * (private.check_catalogue_setting, migration 0017); keep them in step. Pure and not server-only: the screen's fields
 * use them to enable Save, and the actions (settings.ts) check again with them.
 *
 * The stored shapes are the ones submit_order (0007), the order form (lib/data/catalog.ts), the delivery sheet
 * (deliveries.ts) and the kitchen (kitchen.ts) already read:
 *   delivery_windows   ["06:00–08:00", …]  strings, en dash
 *   order_cutoff_hour  14                  a JSON number
 *   cycle_anchor       "2026-12-01"        a JSON string
 *   contact_phone      "+998901234567"     or ""
 *   contact_telegram   "taomiq_uz"         a username without "@", or ""
 */

export const SETTING_KEYS = {
  deliveryWindows: "delivery_windows",
  cutoffHour: "order_cutoff_hour",
  cycleAnchor: "cycle_anchor",
  contactPhone: "contact_phone",
  contactTelegram: "contact_telegram",
} as const;

export type BusinessSettingName = keyof typeof SETTING_KEYS;

export const SETTING_LIMITS = {
  windowsMax: 12,
  cutoffMin: 0,
  cutoffMax: 23,
} as const;

/** The dash between a window's start and end, as every reader of delivery_windows expects. */
export const WINDOW_DASH = "–";

export type BusinessSettings = {
  deliveryWindows: string[];
  cutoffHour: number;
  cycleAnchor: string;
  contactPhone: string;
  contactTelegram: string;
};

// ---------- delivery windows ----------

export type DeliveryWindow = { from: string; to: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "06:00–08:00" (an en dash, a hyphen or a minus between) → { from, to }; anything else → two empty times. */
export function splitWindow(window: string): DeliveryWindow {
  const match = /^\s*(\d{2}:\d{2})\s*[–—-]\s*(\d{2}:\d{2})\s*$/.exec(window);
  return match ? { from: match[1], to: match[2] } : { from: "", to: "" };
}

export function joinWindow({ from, to }: DeliveryWindow): string {
  return `${from}${WINDOW_DASH}${to}`;
}

export type WindowsError = "empty" | "tooMany" | "time" | "order" | "duplicate";

/** The first problem of a list of windows, or null when it can be saved. */
export function checkWindows(windows: readonly DeliveryWindow[]): WindowsError | null {
  if (windows.length === 0) return "empty";
  if (windows.length > SETTING_LIMITS.windowsMax) return "tooMany";
  const seen = new Set<string>();
  for (const window of windows) {
    if (!TIME_RE.test(window.from) || !TIME_RE.test(window.to)) return "time";
    // "HH:MM" strings sort in time order.
    if (window.from >= window.to) return "order";
    const text = joinWindow(window);
    if (seen.has(text)) return "duplicate";
    seen.add(text);
  }
  return null;
}

// ---------- cutoff hour ----------

/** "14" → 14; null when it is not a whole hour 0..23. */
export function readCutoffHour(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,2}$/.test(text)) return null;
  const hour = Number(text);
  return hour >= SETTING_LIMITS.cutoffMin && hour <= SETTING_LIMITS.cutoffMax ? hour : null;
}

// ---------- cycle anchor ----------

/** "2026-12-01" when it is a real calendar day, else null. */
export function readCycleAnchor(raw: string): string | null {
  const text = raw.trim();
  return isCalendarDay(text) ? text : null;
}

/** The day of the 30-day cycle served on `day` ("YYYY-MM-DD", Tashkent) with the cycle starting on `anchor`. */
export function cycleDayOn(day: string, anchor: string): number {
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000);
  return (((days % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS) + 1;
}

// ---------- contacts ----------

/**
 * "+998 90 123-45-67", "90 123 45 67", "998901234567" → "+998901234567"; "" stays "" (no phone). Null when it is not an
 * Uzbek number.
 */
export function readContactPhone(raw: string): string | null {
  if (raw.trim() === "") return "";
  // phoneDigits keeps at most 9 digits, so a number with extra digits is refused by comparing back.
  const all = raw.replace(/\D/g, "");
  const digits = phoneDigits(raw);
  if (all !== digits && all !== `998${digits}`) return null;
  const phone = `+998${digits}`;
  return PHONE_RE.test(phone) ? phone : null;
}

const TELEGRAM_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** "@taomiq_uz", "t.me/taomiq_uz", "https://t.me/taomiq_uz" → "taomiq_uz"; "" stays "". Null when not a username. */
export function readContactTelegram(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "");
  if (text === "") return "";
  return TELEGRAM_RE.test(text) ? text : null;
}
