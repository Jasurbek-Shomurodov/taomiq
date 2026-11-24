import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { formatDateTime, formatDay, formatPhone, type OrderRow } from "@/lib/admin/orders";
import { Panel } from "../../kit/Panel";
import { StatusBadge } from "./StatusBadge";

/**
 * One page of orders: stacked blocks while the panel is narrow (phones, tablets; no sideways scroll), the table
 * once the panel itself is wide enough for it (a container query, so a folded sidebar counts). Every row opens the
 * order. Personal data: rendered only by the owner-only orders page.
 */
export function OrdersTable({ orders, locale }: { orders: OrderRow[]; locale: Locale }) {
  const t = getAdminDictionary(locale);
  return (
    <Panel flush className="@container">
      {/* Narrow: one stacked block per order. */}
      <ul className="@3xl:hidden">
        {orders.map((order) => (
          <li key={order.id} className="adm-row">
            <Link href={`/orders/${order.id}`} className="grid gap-1 px-4 py-3">
              <span className="flex items-center justify-between gap-3">
                <span className="font-semibold tabular-nums text-adm-accent-ink">
                  {t.orders.number} {order.number}
                </span>
                <StatusBadge status={order.status} locale={locale} />
              </span>
              <span className="font-semibold text-adm-text">{order.customer_name}</span>
              <span className="whitespace-nowrap text-[13px] tabular-nums text-adm-muted">
                {formatPhone(order.phone)}
              </span>
              <span className="text-sm text-adm-text">
                {order.program_name} / <span className="tabular-nums">{order.kcal}</span> ·{" "}
                {t.orders.daysShort(order.days)}
                {order.weekdays_only ? t.orders.noWeekends : ""}
              </span>
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-adm-muted">
                <span className="tabular-nums">
                  {t.orders.start}: {formatDay(order.start_date, locale)}
                </span>
                <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-adm-text">
                  {formatSum(order.total)} {t.common.currency}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Wide (a panel of 48rem and more): the table. */}
      <div className="hidden overflow-x-auto @3xl:block">
        <table className="w-full text-left text-sm">
          <thead className="adm-table-head">
            <tr>
              <th className="px-4 py-2.5 font-medium">
                {t.orders.number} · {t.orders.created}
              </th>
              <th className="px-4 py-2.5 font-medium">{t.orders.customer}</th>
              <th className="px-4 py-2.5 font-medium">{t.orders.program}</th>
              <th className="px-4 py-2.5 font-medium">{t.orders.start}</th>
              <th className="px-4 py-2.5 text-right font-medium">{t.orders.sum}</th>
              <th className="px-4 py-2.5 font-medium">{t.orders.status}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="adm-row">
                <td className="px-4 py-3">
                  <Link
                    href={`/orders/${order.id}`}
                    className="font-semibold tabular-nums text-adm-accent-ink underline-offset-4 hover:underline"
                  >
                    {order.number}
                  </Link>
                  <span className="block whitespace-nowrap text-[13px] tabular-nums text-adm-muted">
                    {formatDateTime(order.created_at, locale)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/orders/${order.id}`} tabIndex={-1} className="block">
                    <span className="block font-semibold text-adm-text">{order.customer_name}</span>
                    <span className="block whitespace-nowrap text-[13px] tabular-nums text-adm-muted">
                      {formatPhone(order.phone)}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {order.program_name} / <span className="tabular-nums">{order.kcal}</span>
                  <span className="block text-[13px] text-adm-muted">
                    {t.orders.daysShort(order.days)}
                    {order.weekdays_only ? t.orders.noWeekends : ""}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDay(order.start_date, locale)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatSum(order.total)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={order.status} locale={locale} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
