import { ReceiptText } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, type Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { formatDay, isOrderStatus } from "@/lib/admin/orders";
import { loadOrdersReport } from "@/lib/admin/report-queries";
import { reportsHref, type OrdersReport, type ReportOrderRow } from "@/lib/admin/reports";
import { Badge } from "../../kit/Badge";
import { EmptyState } from "../../kit/EmptyState";
import { Panel } from "../../kit/Panel";
import { StatusBadge } from "../orders/StatusBadge";
import { sumText } from "../finance/figures";
import { ExcelLink, ReportEmpty, ReportFailed, type TabProps } from "./parts";

function Method({ row, t }: { row: ReportOrderRow; t: AdminDictionary }) {
  return row.payment_method ? (
    <>{t.finance.methods[row.payment_method]}</>
  ) : (
    <span className="text-adm-muted">{t.reports.payments.notRecorded}</span>
  );
}

function Program({ row, t }: { row: ReportOrderRow; t: AdminDictionary }) {
  return (
    <>
      {row.program_name}
      {row.kcal !== null && (
        <span className="text-adm-muted">
          {" "}
          / {row.kcal} {t.common.kcal}
        </span>
      )}
    </>
  );
}

function StaffMark({ row, t }: { row: ReportOrderRow; t: AdminDictionary }) {
  if (!row.by_staff) return null;
  return (
    <span className="inline-flex align-middle">
      <Badge tone="neutral">{t.reports.orders.byStaff}</Badge>
    </span>
  );
}

/**
 * Order history: the period's paid orders (cash basis), newest payment first, 50 a page (report_orders). No name,
 * phone or address: number, paid day, program, days, total and method, with a link to the order. Its own Excel button
 * exports the whole list (?what=orders).
 */
export async function OrdersTab({ period, locale, page }: TabProps & { page: number }) {
  const { supabase } = await requireOwner();
  let report: OrdersReport | null = null;
  try {
    report = await loadOrdersReport(supabase, period.from, period.to, page);
  } catch (error) {
    console.error("reports orders failed", error instanceof Error ? error.message : error);
  }
  if (!report) return <ReportFailed tab="orders" period={period} locale={locale} />;

  const t = getAdminDictionary(locale);
  const o = t.reports.orders;
  if (report.count === 0) {
    return (
      <ReportEmpty tab="orders" period={period} locale={locale}>
        {o.empty}
      </ReportEmpty>
    );
  }

  return (
    <>
      <Panel
        flush
        className="@container"
        title={o.title}
        description={<span className="tabular-nums">{o.lead(report.count, sumText(report.revenue, t))}</span>}
        actions={<ExcelLink kind="orders" period={period} what={t.reports.excelOrders} locale={locale} small />}
      >
        {report.rows.length === 0 ? (
          <EmptyState icon={ReceiptText}>{o.pageEmpty}</EmptyState>
        ) : (
          <OrderRows rows={report.rows} locale={locale} t={t} />
        )}
      </Panel>

      {report.pages > 1 && (
        <nav aria-label={t.orders.pagesAria} className="flex items-center justify-between gap-4 text-sm">
          {report.page > 1 ? (
            <Link href={reportsHref({ tab: "orders", period, page: report.page - 1 })} className="adm-btn adm-btn-outline">
              {t.orders.newer}
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular-nums text-adm-muted">{t.orders.pageOf(report.page, report.pages)}</span>
          {report.page < report.pages ? (
            <Link href={reportsHref({ tab: "orders", period, page: report.page + 1 })} className="adm-btn adm-btn-outline">
              {t.orders.older}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

/** Stacked blocks while the panel is narrow, a table once it is wide enough (a container query, as on Customers). */
function OrderRows({ rows, locale, t }: { rows: ReportOrderRow[]; locale: Locale; t: AdminDictionary }) {
  const o = t.reports.orders;
  const days = (row: ReportOrderRow) => `${t.orders.daysShort(row.days)}${row.weekdays_only ? t.orders.noWeekends : ""}`;
  return (
    <>
      <ul className="@3xl:hidden">
        {rows.map((row) => (
          <li key={row.id} className="adm-row">
            <Link href={`/orders/${row.id}`} className="grid gap-1 px-4 py-3" aria-label={o.open(row.number)}>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 font-semibold text-adm-text">
                  <span className="tabular-nums">№{row.number}</span>
                  <StaffMark row={row} t={t} />
                </span>
                <span className="whitespace-nowrap font-semibold tabular-nums text-adm-text">{sumText(row.total, t)}</span>
              </span>
              <span className="text-[13px] text-adm-muted">
                <Program row={row} t={t} /> · {days(row)}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-adm-muted">
                <span className="tabular-nums">
                  {formatDay(row.paid_day, locale)} · <Method row={row} t={t} />
                </span>
                {isOrderStatus(row.status) && <StatusBadge status={row.status} locale={locale} />}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto @3xl:block">
        <table className="w-full text-left text-sm">
          <thead className="adm-table-head">
            <tr>
              <th className="px-4 py-2.5 font-medium">{o.number}</th>
              <th className="px-4 py-2.5 font-medium">{o.paidDay}</th>
              <th className="px-4 py-2.5 font-medium">{o.program}</th>
              <th className="px-4 py-2.5 font-medium">{o.days}</th>
              <th className="px-4 py-2.5 text-right font-medium">{o.total}</th>
              <th className="px-4 py-2.5 font-medium">{o.method}</th>
              <th className="px-4 py-2.5 font-medium">{t.orders.status}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="adm-row">
                <td className="whitespace-nowrap px-4 py-3">
                  <Link
                    href={`/orders/${row.id}`}
                    aria-label={o.open(row.number)}
                    className="font-semibold tabular-nums text-adm-accent-ink underline-offset-4 hover:underline"
                  >
                    №{row.number}
                  </Link>{" "}
                  <StaffMark row={row} t={t} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatDay(row.paid_day, locale)}</td>
                <td className="px-4 py-3">
                  <Program row={row} t={t} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums">{days(row)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatSum(row.total)}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Method row={row} t={t} />
                </td>
                <td className="px-4 py-3">{isOrderStatus(row.status) && <StatusBadge status={row.status} locale={locale} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
