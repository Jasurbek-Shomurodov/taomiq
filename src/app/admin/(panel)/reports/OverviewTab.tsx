import { Ban, CalendarDays, ReceiptText, ShoppingBag, UsersRound, Wallet } from "lucide-react";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, htmlLang } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { formatDayRange } from "@/lib/admin/finance/month";
import { loadOverviewReport } from "@/lib/admin/report-queries";
import { changeOf, shareOf, type OverviewReport } from "@/lib/admin/reports";
import { ChangeBadge, formatPercent } from "../../kit/ChangeBadge";
import { EmptyState } from "../../kit/EmptyState";
import { Panel } from "../../kit/Panel";
import { ProgressRow } from "../../kit/ProgressRow";
import { StatTile } from "../../kit/StatTile";
import { DASH, Money, sumText } from "../finance/figures";
import { ReportEmpty, ReportFailed, ReportLabeled, type TabProps } from "./parts";

/**
 * Overview: revenue, paid orders, average order and plan length, customers (new and returning) and cancellations,
 * each against the previous period of the same length (public.report_overview, migration 0021).
 */
export async function OverviewTab({ period, locale }: TabProps) {
  const { supabase } = await requireOwner();
  let report: OverviewReport | null = null;
  try {
    report = await loadOverviewReport(supabase, period.from, period.to);
  } catch (error) {
    console.error("reports overview failed", error instanceof Error ? error.message : error);
  }
  if (!report) return <ReportFailed tab="overview" period={period} locale={locale} />;

  const t = getAdminDictionary(locale);
  const o = t.reports.overview;
  const { current: now, previous: before } = report;
  if (now.orders === 0 && now.placed === 0) return <ReportEmpty tab="overview" period={period} locale={locale} />;

  const days = (value: number | null) =>
    value === null ? DASH : new Intl.NumberFormat(htmlLang[locale], { maximumFractionDigits: 1 }).format(value);
  const was = (text: string) => <span>{o.was(text)}</span>;
  const cancelledShare = shareOf(now.cancelled, now.placed);
  const cancelledBefore = shareOf(before.cancelled, before.placed);
  const customers = now.new_customers + now.returning_customers;

  return (
    <>
      <p className="adm-caption">
        <ReportLabeled topic="compare" locale={locale}>
          {o.compareLead(formatDayRange(report.previous_from, report.previous_to, locale))}
        </ReportLabeled>
      </p>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile
          label={<ReportLabeled topic="revenue" locale={locale}>{o.revenue}</ReportLabeled>}
          value={<Money value={now.revenue} t={t} />}
          icon={Wallet}
          footer={
            <>
              <ChangeBadge change={changeOf(now.revenue, before.revenue)} locale={locale} />
              {was(sumText(before.revenue, t))}
            </>
          }
        />
        <StatTile
          label={o.orders}
          value={now.orders}
          icon={ShoppingBag}
          footer={
            <>
              <ChangeBadge change={changeOf(now.orders, before.orders)} locale={locale} />
              {was(String(before.orders))}
            </>
          }
        />
        <StatTile
          label={<ReportLabeled topic="avgOrder" locale={locale}>{o.avgOrder}</ReportLabeled>}
          value={now.avg_order === null ? DASH : <Money value={now.avg_order} t={t} />}
          icon={ReceiptText}
          footer={
            <>
              <ChangeBadge change={changeOf(now.avg_order, before.avg_order)} locale={locale} />
              {was(before.avg_order === null ? DASH : sumText(before.avg_order, t))}
            </>
          }
        />
        <StatTile
          label={<ReportLabeled topic="avgDays" locale={locale}>{o.avgDays}</ReportLabeled>}
          value={now.avg_days === null ? DASH : o.avgDaysValue(days(now.avg_days))}
          icon={CalendarDays}
          footer={<span>{o.rationDays(formatSum(now.ration_days))}</span>}
        />
        <StatTile
          label={<ReportLabeled topic="customers" locale={locale}>{o.customers}</ReportLabeled>}
          value={now.customers}
          icon={UsersRound}
          footer={
            <>
              <ChangeBadge change={changeOf(now.customers, before.customers)} locale={locale} />
              <span>{o.customersHint(now.new_customers, now.returning_customers)}</span>
            </>
          }
        />
        <StatTile
          label={<ReportLabeled topic="cancelled" locale={locale}>{o.cancelled}</ReportLabeled>}
          value={now.cancelled}
          icon={Ban}
          tone={now.cancelled > 0 ? "caution" : "accent"}
          footer={
            <>
              <ChangeBadge change={changeOf(now.cancelled, before.cancelled)} locale={locale} goodWhen="down" />
              <span>
                {o.cancelledHint(cancelledShare === null ? DASH : formatPercent(cancelledShare, locale), now.placed)}
              </span>
              {cancelledBefore !== null && was(formatPercent(cancelledBefore, locale))}
            </>
          }
        />
      </div>

      <Panel title={o.customersTitle} description={o.customersLead}>
        {customers === 0 ? (
          <EmptyState icon={UsersRound}>{o.noCustomers}</EmptyState>
        ) : (
          <div className="grid gap-4">
            {(
              [
                { key: "new", label: o.newCustomers, count: now.new_customers, tone: "accent" },
                { key: "returning", label: o.returningCustomers, count: now.returning_customers, tone: "info" },
              ] as const
            ).map((row) => (
              <ProgressRow
                key={row.key}
                label={row.label}
                value={o.customerCount(row.count)}
                share={row.count / customers}
                tone={row.tone}
                detail={<span>{formatPercent(row.count / customers, locale)}</span>}
              />
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}
