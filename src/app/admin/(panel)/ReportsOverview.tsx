import { ChartColumn, ChartNoAxesCombined, CreditCard } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang, type Locale } from "@/i18n/config";
import { requireStaff } from "@/lib/admin/auth";
import { loadPaymentMethodsReport, loadTimeReport } from "@/lib/admin/report-queries";
import { hourTotals, timeGrid, type PaymentMethodsReport, type TimeReport } from "@/lib/admin/reports";
import { addDays, tashkentDay } from "@/lib/admin/stats";
import { BarChart, type ChartBar } from "../kit/BarChart";
import { EmptyState } from "../kit/EmptyState";
import { Notice } from "../kit/Notice";
import { Panel } from "../kit/Panel";
import { PaymentSplit } from "./reports/PaymentsTab";

/** The overview's window: the last 30 Tashkent days, today included (as the order chart above). */
const WINDOW_DAYS = 30;

const timeFormat = (locale: Locale) =>
  new Intl.DateTimeFormat(htmlLang[locale], {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

/**
 * The overview's owner block, second part (docs/plans/zarkebab-feature-port.md, slice 5): the payment-method split
 * and the ordering-hours strip of the last 30 days, read from the report functions of migration 0021 (owner only),
 * and the moment the figures were read. Rendered for owners only; anyone else gets nothing and no query runs. Each
 * read fails on its own: a failed one becomes a notice in its panel, never a made-up 0.
 */
export async function ReportsOverview({ locale }: { locale: Locale }) {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") return null;
  // Read the clock only after the session (a request-time read).
  const now = new Date();
  const today = tashkentDay(now)!;
  const from = addDays(today, -(WINDOW_DAYS - 1));

  const [payments, time] = await Promise.all([
    loadPaymentMethodsReport(supabase, from, today).catch((error: unknown): PaymentMethodsReport | null => {
      console.error("overview payments failed", error instanceof Error ? error.message : error);
      return null;
    }),
    loadTimeReport(supabase, from, today).catch((error: unknown): TimeReport | null => {
      console.error("overview hours failed", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);

  const t = getAdminDictionary(locale);
  const h = t.home;
  const tm = t.reports.time;
  const failed = (
    <Notice tone="negative" retry={{ href: "/", label: t.common.retry }}>
      {h.extrasFailed}
    </Notice>
  );

  const hours = time ? hourTotals(timeGrid(time)) : [];
  const bars: ChartBar[] = hours.map((value, hour) => ({
    key: String(hour),
    value,
    display: String(value),
    label: tm.hourRange(hour),
    axis: hour % 3 === 0 ? String(hour).padStart(2, "0") : undefined,
  }));

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={h.paymentsTitle} description={h.paymentsLead}>
          {!payments ? (
            failed
          ) : payments.orders === 0 ? (
            <EmptyState icon={CreditCard}>{h.paymentsEmpty}</EmptyState>
          ) : (
            <PaymentSplit report={payments} locale={locale} t={t} />
          )}
        </Panel>
        <Panel title={h.hoursTitle} description={h.hoursLead}>
          {!time ? (
            failed
          ) : time.orders === 0 ? (
            <EmptyState icon={ChartColumn}>{h.paymentsEmpty}</EmptyState>
          ) : (
            <BarChart
              bars={bars}
              caption={h.hoursCaption}
              headers={[h.hour, tm.orders]}
              maxLabel={tm.max(String(Math.max(...hours)))}
            />
          )}
        </Panel>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="adm-caption tabular-nums">
          <time dateTime={now.toISOString()}>{h.updatedAt(timeFormat(locale).format(now))}</time>
        </p>
        <Link href="/reports" className="adm-btn adm-btn-outline adm-btn-sm">
          <ChartNoAxesCombined aria-hidden="true" />
          {h.toReports}
        </Link>
      </div>
    </>
  );
}
