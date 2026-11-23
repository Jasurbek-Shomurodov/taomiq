/**
 * Order statuses and the allowed moves between them, shared by the admin pages (server and client)
 * and the order actions. The database only checks that a status is one of these values.
 */

export const ORDER_STATUSES = ["new", "confirmed", "paid", "active", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  paid: "Оплачен",
  active: "Доставляется",
  completed: "Завершён",
  cancelled: "Отменён",
};

/** Tab titles on the orders list (plural). */
export const STATUS_TABS: Record<OrderStatus, string> = {
  new: "Новые",
  confirmed: "Подтверждённые",
  paid: "Оплаченные",
  active: "Доставляются",
  completed: "Завершённые",
  cancelled: "Отменённые",
};

/** The one forward step from each status, with the button text. */
export const NEXT_STATUS: Partial<Record<OrderStatus, { to: OrderStatus; action: string }>> = {
  new: { to: "confirmed", action: "Подтвердить" },
  confirmed: { to: "paid", action: "Отметить оплату" },
  paid: { to: "active", action: "Начать доставку" },
  active: { to: "completed", action: "Завершить" },
};

/** Open orders can be cancelled; completed and cancelled ones are final. */
export function canCancel(status: OrderStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT_STATUS[from]?.to === to || (to === "cancelled" && canCancel(from));
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
  locale: "uz" | "ru";
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

/** Timestamp in Tashkent time: "23.11.2026, 14:05". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A calendar date (YYYY-MM-DD) with the weekday: "пн, 24.11.2026". */
export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("ru-RU", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
