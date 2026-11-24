import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { OrderStatus } from "@/lib/admin/orders";
import { Badge, type Tone } from "../../kit/Badge";

/**
 * What each order status means, as a kit tone: waiting on us is caution, confirmed is information, paid is the
 * accent, being delivered is positive, finished is neutral, cancelled is negative. The word is always shown.
 * (lib/admin/orders.ts STATUS_TONES keeps the brand classes for the customer's account page.)
 */
export const ORDER_STATUS_TONES: Record<OrderStatus, Tone> = {
  new: "caution",
  confirmed: "info",
  paid: "accent",
  active: "positive",
  completed: "neutral",
  cancelled: "negative",
};

export function StatusBadge({ status, locale }: { status: OrderStatus; locale: Locale }) {
  return (
    <Badge status tone={ORDER_STATUS_TONES[status]}>
      {getAdminDictionary(locale).orders.statuses[status]}
    </Badge>
  );
}
