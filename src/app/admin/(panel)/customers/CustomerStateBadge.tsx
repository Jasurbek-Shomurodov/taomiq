import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import type { CustomerState } from "@/lib/admin/customers";
import { Badge, type Tone } from "../../kit/Badge";

/**
 * A customer's state as a kit tone: a plan about to end needs a call (caution), a running plan is positive, a paid one
 * waiting to start is the accent, an open request is information, a customer who left is negative, the rest neutral.
 * The word is always shown.
 */
export const CUSTOMER_STATE_TONES: Record<CustomerState, Tone> = {
  ending: "caution",
  active: "positive",
  upcoming: "accent",
  pending: "info",
  lapsed: "negative",
  ended: "neutral",
  none: "neutral",
};

export function CustomerStateBadge({ state, locale }: { state: CustomerState; locale: Locale }) {
  return (
    <Badge status tone={CUSTOMER_STATE_TONES[state]}>
      {getAdminDictionary(locale).customers.states[state]}
    </Badge>
  );
}
