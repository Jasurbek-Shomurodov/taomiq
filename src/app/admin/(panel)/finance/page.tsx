import {
  ChartColumn,
  NotebookPen,
  PiggyBank,
  Receipt,
  Scale,
  Settings2,
  TrendingDown,
  TrendingUp,
  UserRound,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createElement } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { formatSum, htmlLang, type Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { categoryIcon, isExpenseCategory } from "@/lib/admin/finance/categories";
import {
  breakEvenCoverage,
  categoryShares,
  changePct,
  daysCounted,
  isEmptyPeriod,
  marginPct,
  monthEstimate,
  monthIndicators,
  payrollSummary,
  periodFigures,
  remainingDays,
  type FinancePeriod,
  type LargestPayment,
  type PayrollRow,
  type PeriodFigures,
} from "@/lib/admin/finance/math";
import { comparisonRange, financeMonth, formatDayRange, formatEntryDay, type FinanceMonth } from "@/lib/admin/finance/month";
import { loadFinanceSettings, loadMonthClose, loadPayroll, loadPeriod, loadTotals } from "@/lib/admin/finance/queries";
import { NO_FINANCE_SETTINGS, type FinanceSettings } from "@/lib/admin/finance/settings";
import { tashkentDay } from "@/lib/admin/stats";
import { BarChart, type ChartBar } from "../../kit/BarChart";
import { BeforeHydration } from "../../kit/BeforeHydration";
import { ChangeBadge } from "../../kit/ChangeBadge";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { ProgressRow } from "../../kit/ProgressRow";
import { StatTile } from "../../kit/StatTile";
import { FinanceMonthSwitcher } from "./FinanceMonthSwitcher";
import { FinanceTabs } from "./FinanceTabs";
import { DASH, Indicator, Labeled, Money, pct, resultClass, resultTone, sumText } from "./figures";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).finance;
  return { title: `${t.tabs.month} · ${t.title}` };
}

const BASE_PATH = "/finance";

/** The spending-by-category row of salary payments (payroll), next to the ledger's categories. */
const SALARIES_ROW = "__salaries";

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const monthHref = (monthParam: string | null) => (monthParam ? `${BASE_PATH}?m=${monthParam}` : BASE_PATH);

/** "YYYY-MM-DD" as a Date at UTC midnight, formatted in UTC: the calendar day as written, in any server zone. */
function dayDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

async function settle<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`finance month: ${what} failed`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Finance → Month (docs/plans/finance-investor-payroll.md, slice 2). `?m=YYYY-MM` picks the month (the current one by
 * default, never a future one). Figures come from public.finance_period over the month (the current month: up to
 * today) and are compared with the month before; while a month is still running, only with the same days of the month
 * before (month.comparisonRange). A failed comparison read only drops the changes (the caption says so); a failed read
 * of the month itself shows one notice with a retry and no figures. In the launch month the revenue per day counts
 * from the first paid order (finance_totals); if that read fails, every day of the month counts.
 *
 * Slice 4: the running month gets an estimate to the month's end (math.monthEstimate, with the payroll's whole-month pay
 * and the finance settings); a break-even target, when set, shows as a coverage figure and a line on the daily chart;
 * a closed month says so. The settings, the payroll and the close are read on their own: a failure hides only what
 * needs them.
 */
export default async function FinanceMonthPage({ searchParams }: PageProps<"/admin/finance">) {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const f = t.finance;
  const params = await searchParams;
  // Read the clock only after the session and the address (request-time reads).
  const today = tashkentDay(new Date())!;
  const month = financeMonth(one(params.m), today);
  const to = month.isCurrent ? today : month.to;
  const compare = comparisonRange(month, today);
  const selfHref = monthHref(month.isCurrent ? null : month.key);

  const [current, previous, totals, settings, payroll, close] = await Promise.all([
    settle("period", () => loadPeriod(supabase, month.from, to)),
    compare ? settle("comparison", () => loadPeriod(supabase, compare.from, compare.to)) : Promise.resolve(null),
    // Only for the first paid order's day (the launch month's revenue per day); without it, every day counts.
    settle("totals", () => loadTotals(supabase)),
    // Without the settings, the estimate runs without rent plan and tax, and no break-even is shown.
    settle("settings", () => loadFinanceSettings(supabase)),
    // The whole month's pay, for the running month's estimate only.
    month.isCurrent ? settle("payroll", () => loadPayroll(supabase, today)) : Promise.resolve(null),
    month.isCurrent ? Promise.resolve(null) : settle("close", () => loadMonthClose(supabase, month.from)),
  ]);

  return (
    <div className="adm-page">
      {/* The top bar fills only once the scripts run; until then the same tabs sit on the page. */}
      <BeforeHydration>
        <FinanceTabs locale={locale} />
      </BeforeHydration>

      <div className="grid gap-2">
        <FinanceMonthSwitcher month={month} today={today} locale={locale} hrefFor={monthHref} />
        <p className="adm-caption">
          {f.month.lead(formatDayRange(month.from, to, locale))}{" "}
          {!compare
            ? f.month.noCompare
            : previous
              ? f.month.compare(formatDayRange(compare.from, compare.to, locale))
              : f.month.compareFailed}
        </p>
      </div>

      {!current ? (
        <Notice tone="negative" retry={{ href: selfHref, label: t.common.retry }}>
          {f.loadFailed}
        </Notice>
      ) : (
        <>
          {close && (
            <Notice tone="info">
              {f.month.closedNote(formatEntryDay(tashkentDay(new Date(close.closed_at)) ?? month.to, locale))}
            </Notice>
          )}
          <MonthBody
            period={current}
            previous={previous}
            month={month}
            days={daysCounted(month.from, month.to, today, totals?.first_order_day ?? null)}
            today={today}
            settings={settings ?? NO_FINANCE_SETTINGS}
            payroll={payroll}
            locale={locale}
            t={t}
          />
        </>
      )}
    </div>
  );
}

function MonthBody({
  period,
  previous,
  month,
  days,
  today,
  settings,
  payroll,
  locale,
  t,
}: {
  period: FinancePeriod;
  previous: FinancePeriod | null;
  month: FinanceMonth;
  days: number;
  today: string;
  settings: FinanceSettings;
  /** The running month's payroll (null for a past month, or when the read failed). */
  payroll: PayrollRow[] | null;
  locale: Locale;
  t: AdminDictionary;
}) {
  const f = t.finance;
  const now = periodFigures(period);
  const before = previous ? periodFigures(previous) : null;
  const indicators = monthIndicators(now, days);
  const coverage = breakEvenCoverage(indicators.avgRevenuePerDay, settings.breakEvenDaily);
  const marginBefore = before ? marginPct(before) : null;
  const monthParam = month.isCurrent ? null : month.key;
  const expensesHref = `/finance/records?${monthParam ? `m=${monthParam}&` : ""}type=expense`;

  if (isEmptyPeriod(now)) {
    return (
      <Panel>
        <EmptyState
          icon={NotebookPen}
          action={
            <Link href="/finance/records" className="adm-btn adm-btn-primary">
              {f.toRecords}
            </Link>
          }
        >
          {f.emptyMonth}
        </EmptyState>
      </Panel>
    );
  }

  const was = (text: string) => <span>{f.month.was(text)}</span>;

  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile
          label={<Labeled topic="revenue" locale={locale}>{f.revenue}</Labeled>}
          value={<Money value={now.revenue} t={t} />}
          icon={Wallet}
          footer={
            <>
              <ChangeBadge change={changePct(now.revenue, before?.revenue ?? null)} locale={locale} />
              <span>{f.revenueHint(now.order_count)}</span>
            </>
          }
        />
        <StatTile
          label={<Labeled topic="spent" locale={locale}>{f.spent}</Labeled>}
          value={<Money value={now.spent} t={t} />}
          icon={Receipt}
          footer={
            before ? (
              <>
                <ChangeBadge change={changePct(now.spent, before.spent)} locale={locale} goodWhen="down" />
                {was(sumText(before.spent, t))}
              </>
            ) : (
              <span>{f.spentHint}</span>
            )
          }
        />
        <StatTile
          label={<Labeled topic="result" locale={locale}>{f.result}</Labeled>}
          value={<Money value={now.result} t={t} className={resultClass(now.result)} />}
          icon={now.result < 0 ? TrendingDown : TrendingUp}
          tone={resultTone(now.result)}
          footer={
            before ? (
              <>
                <ChangeBadge change={changePct(now.result, before.result)} locale={locale} />
                {was(sumText(before.result, t))}
              </>
            ) : (
              <span>{f.resultHint}</span>
            )
          }
        />
        <StatTile
          label={<Labeled topic="margin" locale={locale}>{f.month.margin}</Labeled>}
          value={<span className={resultClass(indicators.marginPct)}>{pct(indicators.marginPct, locale)}</span>}
          icon={Scale}
          tone={resultTone(indicators.marginPct)}
          footer={before ? was(pct(marginBefore, locale)) : undefined}
        />
      </div>

      {now.investor_support > 0 && <Notice tone="info">{f.investorNote(sumText(now.investor_support, t))}</Notice>}

      {month.isCurrent && (
        <EstimatePanel
          figures={now}
          period={period}
          days={days}
          today={today}
          settings={settings}
          payroll={payroll}
          locale={locale}
          t={t}
        />
      )}

      <Panel title={f.month.indicators}>
        <dl className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
          <Indicator
            topic="avgPerDay"
            label={f.month.avgPerDay}
            value={indicators.avgRevenuePerDay === null ? DASH : sumText(indicators.avgRevenuePerDay, t)}
            hint={f.month.avgPerDayHint(days)}
            locale={locale}
          />
          <Indicator
            topic="avgCheck"
            label={f.month.avgCheck}
            value={indicators.avgCheck === null ? DASH : sumText(indicators.avgCheck, t)}
            hint={f.revenueHint(now.order_count)}
            locale={locale}
          />
          <Indicator
            topic="foodCost"
            label={f.month.foodCost}
            value={pct(indicators.foodCostPct, locale)}
            hint={f.month.foodCostHint(sumText(now.ingredients, t))}
            locale={locale}
          />
          <Indicator
            topic="payrollShare"
            label={f.month.payrollShare}
            value={pct(indicators.payrollSharePct, locale)}
            hint={f.month.payrollShareHint(sumText(now.salaries + now.salary_one_time, t))}
            locale={locale}
          />
          <Indicator
            topic="otherIncome"
            label={f.month.otherIncome}
            value={sumText(now.other_income, t)}
            hint={f.month.otherIncomeHint}
            locale={locale}
          />
          <Indicator
            topic="investorDependence"
            label={f.month.investorDependence}
            value={pct(indicators.investorDependencePct, locale)}
            valueClass={indicators.investorDependencePct ? "text-adm-info" : ""}
            hint={f.month.investorDependenceHint(sumText(now.investor_support, t))}
            locale={locale}
          />
          <Indicator
            topic="shortfall"
            label={f.month.shortfall}
            value={sumText(indicators.shortfall, t)}
            valueClass={indicators.shortfall > 0 ? "text-adm-negative" : ""}
            hint={indicators.shortfall > 0 ? f.month.shortfallHint : f.month.covered}
            locale={locale}
          />
          {settings.breakEvenDaily !== null && settings.breakEvenDaily > 0 && (
            <Indicator
              topic="breakEven"
              label={f.month.breakEven}
              value={coverage === null ? DASH : f.month.breakEvenValue(pct(coverage, locale))}
              valueClass={coverage === null ? "" : coverage >= 100 ? "text-adm-positive" : "text-adm-negative"}
              hint={f.month.breakEvenHint(sumText(settings.breakEvenDaily, t))}
              locale={locale}
            />
          )}
        </dl>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={f.month.byCategory} description={f.month.byCategoryLead}>
          <CategoryBreakdown figures={now} period={period} locale={locale} t={t} />
        </Panel>
        <Panel
          flush
          title={f.month.largest}
          description={f.month.largestLead}
          actions={
            <Link href={expensesHref} className="adm-btn adm-btn-outline adm-btn-sm">
              {f.month.allRecords}
            </Link>
          }
        >
          {period.largest.length === 0 ? (
            <EmptyState icon={Receipt}>{f.month.noExpenses}</EmptyState>
          ) : (
            <ul>
              {period.largest.map((entry) => (
                <LargestRow key={entry.id} entry={entry} locale={locale} t={t} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <RevenueChart period={period} today={today} breakEven={settings.breakEvenDaily} locale={locale} t={t} />

      <p className="adm-caption">{f.month.note}</p>
    </>
  );
}

function CategoryBreakdown({
  figures,
  period,
  locale,
  t,
}: {
  figures: PeriodFigures;
  period: FinancePeriod;
  locale: Locale;
  t: AdminDictionary;
}) {
  const f = t.finance;
  // Salary payments (payroll) are spending too: one more row, so the rows add up to the month's spending.
  const rows = categoryShares(
    figures.salaries > 0 ? { ...period.expenseByCategory, [SALARIES_ROW]: figures.salaries } : period.expenseByCategory,
  );
  if (rows.length === 0) return <EmptyState icon={PiggyBank}>{f.month.noExpenses}</EmptyState>;
  const percent = (share: number) => pct(share * 100, locale);
  return (
    <div className="grid gap-4">
      {rows.map((row) => (
        <ProgressRow
          key={row.category}
          label={
            <span className="inline-flex items-center gap-2">
              {createElement(row.category === SALARIES_ROW ? UserRound : categoryIcon(row.category), {
                "aria-hidden": true,
                className: "size-4 text-adm-muted",
              })}
              {row.category === SALARIES_ROW
                ? f.month.salaries
                : isExpenseCategory(row.category)
                  ? f.categories[row.category]
                  : row.category}
            </span>
          }
          value={sumText(row.amount, t)}
          share={row.share}
          detail={<span>{percent(row.share)}</span>}
        />
      ))}
    </div>
  );
}

function LargestRow({ entry, locale, t }: { entry: LargestPayment; locale: Locale; t: AdminDictionary }) {
  const f = t.finance;
  const name = isExpenseCategory(entry.category) ? f.categories[entry.category] : entry.category;
  const who = entry.counterparty?.trim() || entry.note?.trim() || "";
  return (
    <li className="adm-row flex items-start gap-3 px-4 py-3 sm:px-5">
      <span className="adm-tone-neutral mt-0.5 grid size-9 shrink-0 place-items-center rounded-adm-control">
        {createElement(categoryIcon(entry.category), { "aria-hidden": true, className: "size-4" })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-adm-text">{name}</p>
        <p className="adm-caption truncate">
          <span className="tabular-nums">{formatEntryDay(entry.entry_date, locale)}</span>
          {who && (
            <>
              {" · "}
              <span data-ph-mask>{who}</span>
            </>
          )}
        </p>
      </div>
      <span className="shrink-0 whitespace-nowrap pt-1.5 font-semibold tabular-nums text-adm-text">
        {sumText(entry.amount, t)}
      </span>
    </li>
  );
}

function RevenueChart({
  period,
  today,
  breakEven,
  locale,
  t,
}: {
  period: FinancePeriod;
  today: string;
  /** The break-even revenue per day (setting), drawn as a line; null when not set. */
  breakEven: number | null;
  locale: Locale;
  t: AdminDictionary;
}) {
  const f = t.finance.month;
  const lang = htmlLang[locale];
  const longDay = new Intl.DateTimeFormat(lang, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const last = period.byDay.length - 1;
  const bars: ChartBar[] = period.byDay.map((day, i) => ({
    key: day.day,
    value: day.revenue,
    display: sumText(day.revenue, t),
    label: day.day === today ? `${f.today}, ${longDay.format(dayDate(day.day))}` : longDay.format(dayDate(day.day)),
    // The last day and every seventh day back from it.
    axis: (last - i) % 7 === 0 ? String(Number(day.day.slice(8, 10))) : undefined,
    current: day.day === today,
  }));
  const top = Math.max(0, ...bars.map((bar) => bar.value));

  return (
    <Panel
      title={f.chartTitle}
      description={<Labeled topic="revenue" locale={locale}>{sumText(period.revenue, t)}</Labeled>}
    >
      {period.revenue === 0 ? (
        <EmptyState icon={ChartColumn}>{f.noRevenue}</EmptyState>
      ) : (
        <BarChart
          bars={bars}
          caption={f.chartCaption}
          headers={[f.chartDay, t.finance.revenue]}
          maxLabel={f.chartMax(`${formatSum(top)} ${t.common.currency}`)}
          reference={
            breakEven !== null && breakEven > 0 ? { value: breakEven, label: f.chartBreakEven(sumText(breakEven, t)) } : undefined
          }
        />
      )}
    </Panel>
  );
}

/**
 * The running month to its end (math.monthEstimate): revenue at today's pace, the spending to expect with the whole
 * month's salaries and the rent plan, the result that gives, and the revenue a day needs from tomorrow on. The tax line
 * is an estimate only and never enters a result. Without the payroll (a failed read) nothing is estimated.
 */
function EstimatePanel({
  figures,
  period,
  days,
  today,
  settings,
  payroll,
  locale,
  t,
}: {
  figures: PeriodFigures;
  period: FinancePeriod;
  days: number;
  today: string;
  settings: FinanceSettings;
  payroll: PayrollRow[] | null;
  locale: Locale;
  t: AdminDictionary;
}) {
  const e = t.finance.estimate;
  const left = remainingDays(today);
  const settingsLink = (
    <Link href="/finance/close#settings" className="adm-btn adm-btn-outline adm-btn-sm">
      <Settings2 aria-hidden="true" />
      {e.settingsLink}
    </Link>
  );

  if (!payroll) {
    return (
      <Panel title={e.title} actions={settingsLink}>
        <Notice tone="negative" retry={{ href: "/finance", label: t.common.retry }}>
          {e.payrollFailed}
        </Notice>
      </Panel>
    );
  }

  const salary = payrollSummary(payroll).monthPay;
  const estimate = monthEstimate({
    revenueSoFar: figures.revenue,
    otherIncomeSoFar: figures.other_income,
    spentSoFar: figures.spent,
    salaryPaidSoFar: figures.salaries,
    salaryCommitment: salary,
    rentPlan: settings.monthlyRent,
    rentRecorded: period.expenseByCategory.rent ?? 0,
    daysCounted: days,
    remainingDays: left,
    taxRatePct: settings.taxRatePct,
  });
  const percent = (value: number) =>
    new Intl.NumberFormat(htmlLang[locale], { style: "percent", maximumFractionDigits: 2 }).format(value / 100);

  return (
    <Panel title={e.title} description={left > 0 ? e.lead(left) : e.leadLastDay} actions={settingsLink}>
      <dl className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
        <Indicator
          topic="projectedRevenue"
          label={e.projectedRevenue}
          value={sumText(estimate.projectedRevenue, t)}
          hint={estimate.avgDaily === null ? undefined : e.projectedRevenueHint(sumText(estimate.avgDaily, t))}
          locale={locale}
        />
        <Indicator
          topic="expectedOut"
          label={e.expectedOut}
          value={sumText(estimate.expectedOut, t)}
          hint={
            <span className="grid gap-0.5">
              <span>{e.expectedOutHint(sumText(salary, t))}</span>
              {estimate.rentLeft > 0 && <span>{e.rentLeft(sumText(estimate.rentLeft, t))}</span>}
            </span>
          }
          locale={locale}
        />
        <Indicator
          topic="projectedResult"
          label={e.projectedResult}
          value={sumText(estimate.projectedResult, t)}
          valueClass={resultClass(estimate.projectedResult)}
          hint={e.projectedResultHint}
          locale={locale}
        />
        <Indicator
          topic="requiredDaily"
          label={e.requiredDaily}
          value={estimate.requiredDaily === null ? DASH : sumText(estimate.requiredDaily, t)}
          hint={
            estimate.requiredDaily === null
              ? e.requiredDailyLastDay
              : estimate.requiredDaily === 0
                ? e.requiredDailyCovered
                : e.requiredDailyHint(left)
          }
          locale={locale}
        />
        {estimate.estimatedTax !== null && settings.taxRatePct !== null && (
          <Indicator
            topic="estimatedTax"
            label={e.tax}
            value={sumText(estimate.estimatedTax, t)}
            valueClass="text-adm-muted"
            hint={e.taxHint(percent(settings.taxRatePct))}
            locale={locale}
          />
        )}
      </dl>
    </Panel>
  );
}
