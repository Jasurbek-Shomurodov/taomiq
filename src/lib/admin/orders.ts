import { htmlLang, type Locale } from "@/i18n/config";
import { PAYMENT_METHODS, isPaymentMethod, type PaymentMethod } from "./finance/categories";

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

// ---------- payment, cancelling and editing (migration 0018; private.check_order_status_fields) ----------

/** How an order was paid: the same three methods as finance records. */
export { PAYMENT_METHODS, isPaymentMethod, type PaymentMethod };

/**
 * A cancelled order carries a reason of at least this many non-whitespace characters (a reason of only spaces or
 * newlines is refused), at most the max in all. Same count as private.check_order_status_fields (0018).
 */
export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 500;

export function isCancelReason(reason: string): boolean {
  return reason.replace(/\s/g, "").length >= CANCEL_REASON_MIN && reason.trim().length <= CANCEL_REASON_MAX;
}

/** The payment method can be set or changed once an order is paid (also while delivering and after). */
export function canChangePaymentMethod(status: OrderStatus): boolean {
  return status === "paid" || status === "active" || status === "completed";
}

/** Contact and delivery fields can be edited while the order is open (new … active). */
export function canEdit(status: OrderStatus): boolean {
  return canCancel(status);
}

/**
 * The start date and weekdays-only can change only while nothing was delivered: a new or confirmed order always (it
 * is never delivered, even when its start date has passed), a paid one only while its first delivery day is after
 * `today` (Tashkent, "YYYY-MM-DD"), an active one never. Same rule as staff_edit_order (0018).
 */
export function canEditSchedule(order: Pick<Order, "status" | "start_date">, today: string): boolean {
  if (order.status === "new" || order.status === "confirmed") return true;
  return order.status === "paid" && order.start_date > today;
}

// ---------- history (public.order_events, written by the orders_log_event trigger) ----------

export const ORDER_EVENT_KINDS = ["created", "status", "edited", "payment_method", "note"] as const;
export type OrderEventKind = (typeof ORDER_EVENT_KINDS)[number];

/** The fields an edit event can name, in the order the history lists them. */
export const EDITED_FIELDS = [
  "customer_name",
  "phone",
  "address",
  "delivery_window",
  "comment",
  "exclusions",
  "start_date",
  "weekdays_only",
] as const;
export type EditedField = (typeof EDITED_FIELDS)[number];

export type OrderEvent = {
  id: number;
  at: string;
  actor: string | null;
  actor_name: string;
  kind: OrderEventKind;
  from_status: string | null;
  to_status: string | null;
  /**
   * created: { by: "site" | "staff" } · status: { payment_method } (to paid) or { reason } (to cancelled) ·
   * edited: { field: { from, to } }, or { pause: { action, from, to, source, end } } (0028) · payment_method: { from, to } · note: {}.
   */
  detail: Record<string, unknown>;
};

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
  /** The map point the customer shared on the order form (migration 0032): both set (inside Tashkent) or both null. */
  delivery_lat: number | null;
  delivery_lng: number | null;
  locale: Locale;
  source: Record<string, string>;
  staff_note: string;
  payment_method: PaymentMethod | null;
  cancel_reason: string;
  /** The staff account that added the order by hand; null when it was placed on the site. */
  created_by: string | null;
  /** The customer account the order is on (null: none). */
  user_id: string | null;
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
  | "payment_method"
  | "created_by"
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
