import { Phone } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { customerHref, type CustomerRow } from "@/lib/admin/customers";
import { telHref } from "@/lib/admin/deliveries";
import { formatDateTime, formatDay, formatPhone } from "@/lib/admin/orders";
import { Badge } from "../../kit/Badge";
import { Panel } from "../../kit/Panel";
import { CustomerStateBadge } from "./CustomerStateBadge";

/** The plan cell: the current plan's last day, else when the last one ended, else a dash. */
function PlanEnd({ row, locale, t }: { row: CustomerRow; locale: Locale; t: AdminDictionary }) {
  if (row.plan_ends) return <span className="tabular-nums">{formatDay(row.plan_ends, locale)}</span>;
  if (row.last_plan_end) {
    return <span className="tabular-nums text-adm-muted">{t.customers.endedOn(formatDay(row.last_plan_end, locale))}</span>;
  }
  return <span className="text-adm-muted">—</span>;
}

function NewMark({ t }: { t: AdminDictionary }) {
  return (
    <span className="inline-flex align-middle">
      <Badge tone="accent">{t.customers.newMark}</Badge>
    </span>
  );
}

/**
 * One page of customers: stacked blocks while the panel is narrow (phones, tablets; no sideways scroll), the table
 * once the panel itself is wide enough (a container query, so a folded sidebar counts). The name opens the customer
 * page; the phone calls. `showTotal` is the owner's money column (the database returns null to managers anyway).
 * Personal data: rendered only by the customers page (owners and managers).
 */
export function CustomersTable({ rows, showTotal, locale }: { rows: CustomerRow[]; showTotal: boolean; locale: Locale }) {
  const t = getAdminDictionary(locale);
  const c = t.customers;
  const total = (row: CustomerRow) => (row.total_paid === null ? "—" : formatSum(row.total_paid));

  return (
    <Panel flush className="@container">
      {/* Narrow: one stacked block per customer, the call button beside the link (never inside it). */}
      <ul className="@3xl:hidden">
        {rows.map((row) => (
          <li key={row.customer_key} className="adm-row flex items-start gap-2 pr-3">
            <Link href={customerHref(row.customer_key)} className="grid min-w-0 flex-1 gap-1 py-3 pl-4">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-words font-semibold text-adm-text" data-ph-mask>
                    {row.customer_name}
                  </span>
                  {row.is_new && <NewMark t={t} />}
                </span>
                <CustomerStateBadge state={row.state} locale={locale} />
              </span>
              <span className="whitespace-nowrap text-[13px] tabular-nums text-adm-muted" data-ph-mask>
                {formatPhone(row.phone)}
              </span>
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] text-adm-muted">
                <span className="tabular-nums">{c.ordersPaid(row.orders_count, row.paid_count)}</span>
                {showTotal && (
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-adm-text">
                    {row.total_paid === null ? "—" : `${formatSum(row.total_paid)} ${t.common.currency}`}
                  </span>
                )}
              </span>
              <span className="text-[13px] text-adm-muted">
                {c.planEnds}: <PlanEnd row={row} locale={locale} t={t} />
              </span>
            </Link>
            <a
              href={telHref(row.phone)}
              className="adm-btn adm-btn-outline mt-3 shrink-0 px-3"
              aria-label={c.callAria(row.customer_name)}
            >
              <Phone aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>

      {/* Wide (a panel of 48rem and more): the table. */}
      <div className="hidden overflow-x-auto @3xl:block">
        <table className="w-full text-left text-sm">
          <thead className="adm-table-head">
            <tr>
              <th className="px-4 py-2.5 font-medium">{c.customer}</th>
              <th className="px-4 py-2.5 font-medium">{c.phone}</th>
              <th className="px-4 py-2.5 text-right font-medium">{c.orders}</th>
              {showTotal && <th className="px-4 py-2.5 text-right font-medium">{c.totalPaid}</th>}
              <th className="px-4 py-2.5 font-medium">{c.lastOrder}</th>
              <th className="px-4 py-2.5 font-medium">{c.planEnds}</th>
              <th className="px-4 py-2.5 font-medium">{c.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.customer_key} className="adm-row">
                <td className="px-4 py-3">
                  <Link
                    href={customerHref(row.customer_key)}
                    className="font-semibold text-adm-accent-ink underline-offset-4 hover:underline"
                    data-ph-mask
                  >
                    {row.customer_name}
                  </Link>
                  {row.is_new && (
                    <>
                      {" "}
                      <NewMark t={t} />
                    </>
                  )}
                  {row.source && (
                    <span className="block text-[13px] text-adm-muted">
                      {c.source}: {row.source}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <a
                    href={telHref(row.phone)}
                    className="inline-flex items-center gap-1.5 tabular-nums text-adm-text underline-offset-4 hover:underline"
                    aria-label={c.callAria(row.customer_name)}
                    data-ph-mask
                  >
                    <Phone aria-hidden="true" className="size-3.5 text-adm-muted" />
                    {formatPhone(row.phone)}
                  </a>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {row.orders_count}
                  <span className="block text-[13px] text-adm-muted">{c.figures.paid(row.paid_count)}</span>
                </td>
                {showTotal && <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{total(row)}</td>}
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDateTime(row.last_order_at, locale)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <PlanEnd row={row} locale={locale} t={t} />
                </td>
                <td className="px-4 py-3">
                  <CustomerStateBadge state={row.state} locale={locale} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
