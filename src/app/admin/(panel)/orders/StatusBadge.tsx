import { STATUS_LABELS, STATUS_TONES, type OrderStatus } from "@/lib/admin/orders";

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
