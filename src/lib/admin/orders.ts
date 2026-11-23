import { htmlLang, type Locale } from "@/i18n/config";

/**
 * Order statuses and the allowed moves between them, shared by the admin pages (server and client)
 * and the order actions. The database only checks that a status is one of these values.
 */

export const ORDER_STATUSES = ["new", "confirmed", "paid", "active", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * The one forward step from each open status. The button texts and status names live in the admin
 * dictionaries (src/i18n/admin), keyed by these statuses.
 */
export const NEXT_STATUS = {
  new: "confirmed",
  confirmed: "paid",
  paid: "active",
  active: "completed",
} as const satisfies Partial<Record<OrderStatus, OrderStatus>>;
export type ForwardStatus = keyof typeof NEXT_STATUS;

export function hasNextStatus(status: OrderStatus): status is ForwardStatus {
  return Object.hasOwn(NEXT_STATUS, status);
}

/** Open orders can be cancelled; completed and cancelled ones are final. */
export function canCancel(status: OrderStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return (hasNextStatus(from) && NEXT_STATUS[from] === to) || (to === "cancelled" && canCancel(from));
}

export const STATUS_TONES: Record<OrderStatus, string> = {
  new: "bg-gold/25 text-forest",
  confirmed: "bg-sage/40 text-forest",
  paid: "bg-forest/15 text-forest",
  active: "bg-forest text-ivory",
  completed: "bg-ivory-deep text-muted",
  cancelled: "bg-danger/10 text-danger",
};

export const STAFF_NOTE_MAX = 2000;

export type Order = {
  id: string;
  number: number;
  status: OrderStatus;
  variant_id: string;
  program_name: string;
  kcal: number;
  days: number;
  weekdays_only: boolean;
  start_date: string;
  price_per_day: number;
  total: number;
  customer_name: string;
  phone: string;
  address: string;
  delivery_window: string;
  comment: string;
  exclusions: string;
  locale: Locale;
  source: Record<string, string>;
  staff_note: string;
  consent_at: string;
  created_at: string;
  updated_at: string;
};

/** Columns the list needs; the detail page reads everything except ip_hash. */
export type OrderRow = Pick<
  Order,
  | "id"
  | "number"
  | "status"
  | "program_name"
  | "kcal"
  | "days"
  | "weekdays_only"
  | "start_date"
  | "total"
  | "customer_name"
  | "phone"
  | "created_at"
>;

/** "+998901234567" → "+998 90 123-45-67". */
export function formatPhone(phone: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+998 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

/** Date formats per language; Russian by default (the Telegram order card is always Russian). */
const DATE_LOCALE: Record<Locale, string> = { ...htmlLang, ru: "ru-RU" };

/** Timestamp in Tashkent time: "23.11.2026, 14:05" (ru), "23/11/2026, 14:05" (uz). */
export function formatDateTime(iso: string, locale: Locale = "ru"): string {
  return new Date(iso).toLocaleString(DATE_LOCALE[locale], {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A calendar date (YYYY-MM-DD) with the weekday: "пн, 24.11.2026" (ru), "Dush, 24/11/2026" (uz). */
export function formatDay(date: string, locale: Locale = "ru"): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(DATE_LOCALE[locale], {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
