import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { STATUS_TONES, type OrderStatus } from "@/lib/admin/orders";

export function StatusBadge({ status, locale }: { status: OrderStatus; locale: Locale }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONES[status]}`}>
      {getAdminDictionary(locale).orders.statuses[status]}
    </span>
  );
}
