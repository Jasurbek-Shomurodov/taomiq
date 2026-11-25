import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { requireStaff, requireStockAccess } from "@/lib/admin/auth";
import { formatDayRange } from "@/lib/admin/finance/month";
import { purchasesHref } from "@/lib/admin/purchase-links";
import {
  PURCHASE_TABS,
  isPaymentMethod,
  isPurchaseTab,
  type PaymentMethod,
  type PurchaseTab,
} from "@/lib/admin/purchases";
import {
  REPORT_FIRST_DAY,
  REPORT_MAX_DAYS,
  REPORT_PRESETS,
  daysBetween,
  resolveReportPeriod,
  type ReportPeriod,
} from "@/lib/admin/reports";
import { tashkentDay } from "@/lib/admin/stats";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { Notice } from "../../kit/Notice";
import { PeriodPicker } from "../../kit/PeriodPicker";
import { DashboardOrdersSkeleton, PageSkeleton } from "../../kit/Skeleton";
import { TopBarTabs } from "../../shell/TopBarSlot";
import { AnalyticsTab } from "./AnalyticsTab";
import { loadPurchaseFormData } from "./form-data";
import { HistoryTab } from "./HistoryTab";
import { PurchaseForm } from "./PurchaseForm";
import { SheetTab } from "./SheetTab";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireStaff();
  return { title: getAdminDictionary(staff.locale).purchases.title };
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Purchases (owners and managers; docs/plans/zarkebab-feature-port.md, slice 6). `?tab=` picks New (the receipt form,
 * the default), History, Analytics or Sheet; the last three read a period (`?period=` or `?from=&to=`, as on Reports,
 * the last 30 days by default). Every read goes through the purchase functions of migration 0022, which refuse anyone
 * but owners and managers. A receipt saved here is also one ingredients expense in Finance, written by the database.
 */
export default async function PurchasesPage({ searchParams }: PageProps<"/admin/purchases">) {
  const { staff } = await requireStockAccess();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const tp = t.purchases;
  const params = await searchParams;
  // Read the clock only after the session and the address (request-time reads).
  const today = tashkentDay(new Date())!;
  const tabParam = one(params.tab);
  const tab: PurchaseTab = isPurchaseTab(tabParam) ? tabParam : "new";
  const period = resolveReportPeriod({ period: one(params.period), from: one(params.from), to: one(params.to) }, today);

  const tabs = (
    <nav aria-label={tp.tabsAria} className="adm-tabs">
      {PURCHASE_TABS.map((key) => (
        <Link
          key={key}
          href={purchasesHref({ tab: key, period: tab === "new" ? null : period })}
          aria-current={key === tab ? "page" : undefined}
          scroll={false}
        >
          {tp.tabs[key]}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="adm-page">
      <TopBarTabs>{tabs}</TopBarTabs>
      <BeforeHydration>{tabs}</BeforeHydration>

      {tab === "new" ? (
        <Suspense fallback={<PageSkeleton layout="form" />}>
          <NewTab today={today} locale={locale} />
        </Suspense>
      ) : (
        <>
          <PeriodBar tab={tab} period={period} today={today} locale={locale} params={params} />
          {period.fellBack && <Notice tone="caution">{t.reports.period.fellBack(REPORT_MAX_DAYS)}</Notice>}
          {tab === "history" && one(params.deleted) === "1" && <Notice tone="positive">{tp.deleted}</Notice>}
          <Suspense key={`${tab}:${period.from}:${period.to}:${JSON.stringify(params)}`} fallback={<DashboardOrdersSkeleton />}>
            {tab === "history" ? (
              <HistoryTab
                period={period}
                filters={{
                  q: (one(params.q) ?? "").slice(0, 100),
                  category: UUID_RE.test(one(params.category) ?? "") ? one(params.category)! : null,
                  method: isPaymentMethod(one(params.method)) ? (one(params.method) as PaymentMethod) : null,
                  page: pageParam(one(params.page)),
                }}
                locale={locale}
              />
            ) : tab === "analytics" ? (
              <AnalyticsTab period={period} locale={locale} />
            ) : (
              <SheetTab period={period} today={today} locale={locale} />
            )}
          </Suspense>
        </>
      )}
    </div>
  );
}

function pageParam(value: string | undefined): number {
  if (!value || !/^\d{1,5}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

/** The period picker of History, Analytics and Sheet, keeping the tab (and the History filters) in its form. */
function PeriodBar({
  tab,
  period,
  today,
  locale,
  params,
}: {
  tab: PurchaseTab;
  period: ReportPeriod;
  today: string;
  locale: Locale;
  params: Record<string, string | string[] | undefined>;
}) {
  const t = getAdminDictionary(locale);
  const r = t.reports;
  const hidden: Record<string, string> = { tab };
  if (tab === "history") {
    for (const key of ["q", "category", "method"]) {
      const value = one(params[key]);
      if (value) hidden[key] = value.slice(0, 100);
    }
  }
  return (
    <div className="grid gap-2">
      <PeriodPicker
        action="/purchases"
        presets={REPORT_PRESETS.map((key) => ({
          key,
          label: r.period.presets[key],
          href: purchasesHref({
            tab,
            period: { from: "", to: "", preset: key },
            filters:
              tab === "history"
                ? {
                    q: hidden.q,
                    category: hidden.category ?? null,
                    method: isPaymentMethod(hidden.method) ? hidden.method : null,
                  }
                : {},
          }),
        }))}
        value={period.preset}
        from={period.from}
        to={period.to}
        min={REPORT_FIRST_DAY}
        max={today}
        hidden={hidden}
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
        )}
      </p>
    </div>
  );
}

/**
 * The New tab: the receipt form. The form makes its own request id in the browser and says "saved" itself, so a
 * server render of this page never remounts it or loses what is typed.
 */
async function NewTab({ today, locale }: { today: string; locale: Locale }) {
  const { supabase } = await requireStockAccess();
  const t = getAdminDictionary(locale);
  const tp = t.purchases;

  let data: Awaited<ReturnType<typeof loadPurchaseFormData>>;
  try {
    data = await loadPurchaseFormData(supabase, t, locale);
  } catch (error) {
    console.error("purchases: form data failed", error instanceof Error ? error.message : error);
    return (
      <Notice tone="negative" retry={{ href: "/purchases", label: t.common.retry }}>
        {tp.errors.loadFailed}
      </Notice>
    );
  }

  return (
    <>
      <PurchaseForm
        purchase={null}
        ingredients={data.ingredients}
        categories={data.categories}
        buyers={data.buyers}
        today={today}
        lockedThrough={data.lockedThrough}
        readOnly={false}
        locale={locale}
      />
    </>
  );
}
