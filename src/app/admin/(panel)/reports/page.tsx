import type { Metadata } from "next";
import { Suspense } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import { requireOwner } from "@/lib/admin/auth";
import { formatDayRange } from "@/lib/admin/finance/month";
import {
  REPORT_FIRST_DAY,
  REPORT_MAX_DAYS,
  REPORT_PRESETS,
  daysBetween,
  isReportTab,
  reportsHref,
  resolveReportPeriod,
  type ReportTab,
} from "@/lib/admin/reports";
import { tashkentDay } from "@/lib/admin/stats";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { Notice } from "../../kit/Notice";
import { PeriodPicker } from "../../kit/PeriodPicker";
import { DashboardOrdersSkeleton } from "../../kit/Skeleton";
import { TopBarActions, TopBarTabs } from "../../shell/TopBarSlot";
import { OrdersTab } from "./OrdersTab";
import { OverviewTab } from "./OverviewTab";
import { ExcelLink, type TabProps } from "./parts";
import { PaymentsTab } from "./PaymentsTab";
import { ProgramsTab } from "./ProgramsTab";
import { RenewalsTab } from "./RenewalsTab";
import { ReportsTabs } from "./ReportsTabs";
import { SourcesTab } from "./SourcesTab";
import { StaffTab } from "./StaffTab";
import { TimeTab } from "./TimeTab";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  return { title: getAdminDictionary(staff.locale).nav.reports };
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A history page from the address: a whole number from 1, anything else is page 1. */
function pageParam(value: string | undefined): number {
  if (!value || !/^\d{1,5}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

function TabBody({ tab, page, ...props }: TabProps & { tab: ReportTab; page: number }) {
  switch (tab) {
    case "overview":
      return <OverviewTab {...props} />;
    case "programs":
      return <ProgramsTab {...props} />;
    case "time":
      return <TimeTab {...props} />;
    case "sources":
      return <SourcesTab {...props} />;
    case "payments":
      return <PaymentsTab {...props} />;
    case "renewals":
      return <RenewalsTab {...props} />;
    case "staff":
      return <StaffTab {...props} />;
    case "orders":
      return <OrdersTab {...props} page={page} />;
  }
}

/**
 * Reports (owner only; docs/plans/zarkebab-feature-port.md, slice 5). `?tab=` picks one of eight reports, `?period=`
 * a preset or `?from=&to=` a custom period (Tashkent days, at most 366; anything not allowed falls back to the last 30
 * days and says so), `?page=` the order history's page. Each tab reads one report function of migration 0021, which
 * refuse anyone but the owner. The Excel button downloads every report of the period (reports/export/route.ts).
 */
export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const { staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const r = t.reports;
  const params = await searchParams;
  // Read the clock only after the session and the address (request-time reads).
  const today = tashkentDay(new Date())!;
  const tabParam = one(params.tab);
  const tab: ReportTab = isReportTab(tabParam) ? tabParam : "overview";
  const period = resolveReportPeriod({ period: one(params.period), from: one(params.from), to: one(params.to) }, today);
  const page = pageParam(one(params.page));

  const tabs = <ReportsTabs tab={tab} period={period} locale={locale} />;
  const excel = <ExcelLink kind="reports" period={period} what={r.excelReports} locale={locale} />;

  return (
    <div className="adm-page">
      <TopBarTabs>{tabs}</TopBarTabs>
      <TopBarActions>{excel}</TopBarActions>
      {/* The top bar fills only once the scripts run; until then the same tabs and button sit on the page. */}
      <BeforeHydration>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {tabs}
          {excel}
        </div>
      </BeforeHydration>

      <div className="grid gap-2">
        <PeriodPicker
          action="/reports"
          presets={REPORT_PRESETS.map((key) => ({
            key,
            label: r.period.presets[key],
            href: reportsHref({ tab, period: { from: "", to: "", preset: key } }),
          }))}
          value={period.preset}
          from={period.from}
          to={period.to}
          min={REPORT_FIRST_DAY}
          max={today}
          hidden={tab === "overview" ? {} : { tab }}
          labels={{
            group: r.period.aria,
            presets: r.period.presetsAria,
            custom: r.period.customAria,
            from: r.period.from,
            to: r.period.to,
            show: r.period.show,
          }}
        />
        <p className="adm-caption">
          {r.period.range(
            `${formatDayRange(period.from, period.to, locale)} (${r.period.days(daysBetween(period.from, period.to))})`,
          )}{" "}
          {r.lead}
        </p>
      </div>

      {period.fellBack && <Notice tone="caution">{r.period.fellBack(REPORT_MAX_DAYS)}</Notice>}

      <Suspense key={`${tab}:${period.from}:${period.to}:${page}`} fallback={<DashboardOrdersSkeleton />}>
        <TabBody tab={tab} page={page} period={period} locale={locale} />
      </Suspense>
    </div>
  );
}
