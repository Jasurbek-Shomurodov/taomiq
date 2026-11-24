import { CalendarCheck, HandCoins, NotebookPen, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import {
  growth,
  payback,
  yearSummary,
  type FinanceTotals,
  type Growth,
  type InvestorTotal,
  type MonthCashflow,
  type Payback,
  type YearMonth,
  type YearSummary,
} from "@/lib/admin/finance/math";
import { formatMonth, formatMonthShort } from "@/lib/admin/finance/month";
import { loadInvestorTotals, loadMonthlyCashflow, loadTotals } from "@/lib/admin/finance/queries";
import { tashkentDay } from "@/lib/admin/stats";
import type { ChartBar } from "../../../kit/BarChart";
import { BeforeHydration } from "../../../kit/BeforeHydration";
import { ChangeBadge } from "../../../kit/ChangeBadge";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { ProgressRow } from "../../../kit/ProgressRow";
import { SignedBarChart } from "../../../kit/SignedBarChart";
import { StatTile } from "../../../kit/StatTile";
import { FinanceTabs } from "../FinanceTabs";
import { DASH, Help, Indicator, Labeled, Money, pct, resultClass, resultTone, signedPct, sumText } from "../figures";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).finance;
  return { title: `${t.tabs.year} · ${t.title}` };
}

const MONTHS = 12;

async function settle<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`finance year: ${what} failed`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Finance → Year (docs/plans/finance-investor-payroll.md, slice 2): the investor view first (all-time payback and the
 * money per investor), then the last 12 months: totals, growth, the result of each month as a chart and as a
 * statement with a total row. Months before the first one with anything in it are left out. The 12 months and the
 * all-time totals load together and the page needs both; the per-investor sums load after (they need the first
 * investment day) and fail on their own, with a notice inside the investor panel.
 */
export default async function FinanceYearPage() {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const f = t.finance;
  // Read the clock only after the session (a request-time read).
  const today = tashkentDay(new Date())!;
  const currentMonthStart = `${today.slice(0, 7)}-01`;

  const [rows, totals] = await Promise.all([
    settle("cashflow", () => loadMonthlyCashflow(supabase, MONTHS)),
    settle("totals", () => loadTotals(supabase)),
  ]);
  const investors =
    totals && totals.investor_support > 0 && totals.first_investment_day
      ? await settle("investors", () => loadInvestorTotals(supabase, totals.first_investment_day!, today))
      : [];

  const firstKey = rows?.[0]?.month_start.slice(0, 7) ?? today.slice(0, 7);
  const lastKey = rows?.at(-1)?.month_start.slice(0, 7) ?? today.slice(0, 7);

  return (
    <div className="adm-page">
      <BeforeHydration>
        <FinanceTabs locale={locale} />
      </BeforeHydration>

      <p className="adm-caption">{f.year.lead(`${formatMonth(firstKey, locale)} — ${formatMonth(lastKey, locale)}`)}</p>

      {!rows || !totals ? (
        <Notice tone="negative" retry={{ href: "/finance/year", label: t.common.retry }}>
          {f.year.loadFailed}
        </Notice>
      ) : (
        <YearBody
          rows={rows}
          totals={totals}
          investors={investors}
          currentMonthStart={currentMonthStart}
          locale={locale}
          t={t}
        />
      )}
    </div>
  );
}

function YearBody({
  rows,
  totals,
  investors,
  currentMonthStart,
  locale,
  t,
}: {
  rows: MonthCashflow[];
  totals: FinanceTotals;
  /** Null when the per-investor read failed. */
  investors: InvestorTotal[] | null;
  currentMonthStart: string;
  locale: Locale;
  t: AdminDictionary;
}) {
  const f = t.finance;
  const year = yearSummary(rows, currentMonthStart);
  const back = payback(totals, rows, currentMonthStart);
  const trend = growth(rows, currentMonthStart);

  return (
    <>
      <InvestorPanel back={back} investors={investors} locale={locale} t={t} />

      {year.months.length === 0 ? (
        <Panel>
          <EmptyState
            icon={NotebookPen}
            action={
              <Link href="/finance/records" className="adm-btn adm-btn-primary">
                {f.toRecords}
              </Link>
            }
          >
            {f.year.empty}
          </EmptyState>
        </Panel>
      ) : (
        <>
          <YearTiles year={year} locale={locale} t={t} />
          <GrowthPanel trend={trend} locale={locale} t={t} />
          <ResultChart months={year.months} locale={locale} t={t} />
          <Statement year={year} locale={locale} t={t} />
        </>
      )}
    </>
  );
}

function InvestorPanel({
  back,
  investors,
  locale,
  t,
}: {
  back: Payback;
  investors: InvestorTotal[] | null;
  locale: Locale;
  t: AdminDictionary;
}) {
  const f = t.finance;
  const y = f.year;

  if (back.invested === 0) {
    return (
      <Panel title={y.investorTitle}>
        <EmptyState
          icon={HandCoins}
          action={
            <Link href="/finance/records" className="adm-btn adm-btn-outline">
              {y.addInvestor}
            </Link>
          }
        >
          {y.noInvestor}
        </EmptyState>
      </Panel>
    );
  }

  const earned = Math.max(0, back.generated);
  const monthsLeft =
    back.monthsLeft === 0 ? y.paidOff : back.monthsLeft === null ? DASH : y.monthsLeftValue(back.monthsLeft);

  return (
    <Panel title={y.investorTitle} description={y.investorLead}>
      <dl className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
        <Indicator
          topic="invested"
          label={y.invested}
          value={sumText(back.invested, t)}
          valueClass="text-adm-info"
          locale={locale}
        />
        <Indicator
          topic="generated"
          label={y.generated}
          value={sumText(back.generated, t)}
          valueClass={resultClass(back.generated)}
          locale={locale}
        />
        <Indicator
          topic="paidBack"
          label={y.paidBack}
          value={pct(back.paidBackPct, locale)}
          hint={y.paidBackOf(sumText(earned, t), sumText(back.invested, t))}
          locale={locale}
        />
        <Indicator
          topic="pace"
          label={y.pace}
          value={back.monthlyPace === null ? DASH : sumText(back.monthlyPace, t)}
          valueClass={resultClass(back.monthlyPace)}
          hint={back.monthlyPace === null ? y.noPace : y.paceHint(back.paceMonths)}
          locale={locale}
        />
        <Indicator
          topic="monthsLeft"
          label={y.monthsLeft}
          value={monthsLeft}
          valueClass={back.monthsLeft === 0 ? "text-adm-positive" : ""}
          hint={
            back.remaining > 0
              ? back.monthsLeft === null
                ? y.notPaying
                : y.remaining(sumText(back.remaining, t))
              : undefined
          }
          locale={locale}
        />
      </dl>

      {/* Payback as a bar: the share of the money invested that the business has earned back. */}
      <div className="mt-5">
        <span
          role="img"
          aria-label={`${y.paidBack}: ${pct(back.paidBackPct, locale)}`}
          className="block h-3 overflow-hidden rounded-full bg-adm-surface-muted"
        >
          <span
            className="block h-full rounded-full bg-adm-positive"
            style={{ width: `${Math.min(Math.max(back.paidBackPct ?? 0, 0), 100)}%` }}
          />
        </span>
      </div>

      <div className="mt-6 grid gap-4 border-t border-adm-border pt-5">
        <h3 className="adm-heading text-base">{y.investors}</h3>
        {investors === null ? (
          <Notice tone="negative" retry={{ href: "/finance/year", label: t.common.retry }}>
            {y.investorsFailed}
          </Notice>
        ) : (
          investors.map((investor) => {
            const share = back.invested > 0 ? investor.amount / back.invested : 0;
            return (
              <ProgressRow
                key={investor.name}
                tone="info"
                label={<span data-ph-mask>{investor.name || f.records.noName}</span>}
                value={sumText(investor.amount, t)}
                share={share}
                detail={<span>{y.investorShare(pct(share * 100, locale))}</span>}
              />
            );
          })
        )}
      </div>
    </Panel>
  );
}

function YearTiles({ year, locale, t }: { year: YearSummary; locale: Locale; t: AdminDictionary }) {
  const f = t.finance;
  const y = f.year;
  const { totals } = year;
  const monthName = (month: YearMonth) => formatMonth(month.month_start.slice(0, 7), locale);

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
      <StatTile
        label={<Labeled topic="revenue" locale={locale}>{y.revenue}</Labeled>}
        value={<Money value={totals.revenue} t={t} />}
        icon={Wallet}
        footer={<span>{y.ordersLine(totals.order_count)}</span>}
      />
      <StatTile
        label={<Labeled topic="spent" locale={locale}>{y.spent}</Labeled>}
        value={<Money value={totals.spent} t={t} />}
        icon={Receipt}
        footer={totals.other_income > 0 ? <span>{`${f.month.otherIncome}: ${sumText(totals.other_income, t)}`}</span> : undefined}
      />
      <StatTile
        label={<Labeled topic="result" locale={locale}>{y.result}</Labeled>}
        value={<Money value={totals.result} t={t} className={resultClass(totals.result)} />}
        icon={totals.result < 0 ? TrendingDown : TrendingUp}
        tone={resultTone(totals.result)}
        footer={
          <>
            <span>{y.marginLine(pct(totals.marginPct, locale))}</span>
            {totals.investor_support > 0 && (
              <span className="text-adm-info">{y.investorLine(sumText(totals.investor_support, t))}</span>
            )}
          </>
        }
      />
      <StatTile
        label={y.profitable}
        value={year.completedMonths > 0 ? y.profitableValue(year.profitableMonths, year.completedMonths) : DASH}
        icon={CalendarCheck}
        footer={
          year.best && year.worst ? (
            <span className="grid gap-0.5">
              <span>{y.best(monthName(year.best), sumText(year.best.result, t))}</span>
              {year.worst !== year.best && <span>{y.worst(monthName(year.worst), sumText(year.worst.result, t))}</span>}
            </span>
          ) : undefined
        }
      />
    </div>
  );
}

function GrowthPanel({ trend, locale, t }: { trend: Growth; locale: Locale; t: AdminDictionary }) {
  const y = t.finance.year;
  const month = (start: string | null) => (start ? formatMonth(start.slice(0, 7), locale) : DASH);
  return (
    <Panel title={<Labeled topic="growth" locale={locale}>{y.growth}</Labeled>}>
      <dl className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
        <Indicator
          topic="avgPerDay"
          label={y.perDay(month(trend.latest))}
          value={trend.latestPerDay === null ? DASH : sumText(trend.latestPerDay, t)}
          hint={
            trend.vsPreviousPct !== null ? (
              <>
                <ChangeBadge change={trend.vsPreviousPct} locale={locale} />
                <span>{y.vsPrevious}</span>
              </>
            ) : undefined
          }
          locale={locale}
        />
        <Indicator
          topic="growth"
          label={y.threeMonths}
          value={signedPct(trend.vsThreeBackPct, locale)}
          valueClass={resultClass(trend.vsThreeBackPct)}
          hint={trend.threeBack ? y.threeMonthsHint(month(trend.latest), month(trend.threeBack)) : undefined}
          locale={locale}
        />
        <Indicator
          topic="growth"
          label={y.avgGrowth}
          value={signedPct(trend.avgMonthlyPct, locale)}
          valueClass={resultClass(trend.avgMonthlyPct)}
          hint={trend.avgMonthlyPct === null ? y.noGrowth : y.avgGrowthHint(trend.avgMonths)}
          locale={locale}
        />
      </dl>
    </Panel>
  );
}

function ResultChart({ months, locale, t }: { months: YearMonth[]; locale: Locale; t: AdminDictionary }) {
  const y = t.finance.year;
  const last = months.length - 1;
  const bars: ChartBar[] = months.map((month, i) => {
    const key = month.month_start.slice(0, 7);
    return {
      key,
      value: month.result,
      display: sumText(month.result, t),
      label: month.isCurrent ? `${formatMonth(key, locale)}, ${y.soFar}` : formatMonth(key, locale),
      // The current month and every second month back from it: twelve short names do not fit a phone.
      axis: (last - i) % 2 === 0 ? formatMonthShort(key, locale) : undefined,
      current: month.isCurrent,
    };
  });
  return (
    <Panel title={<Labeled topic="result" locale={locale}>{y.chartTitle}</Labeled>} description={y.chartLead}>
      <SignedBarChart bars={bars} caption={y.chartCaption} headers={[y.chartMonth, t.finance.result]} />
    </Panel>
  );
}

function Statement({ year, locale, t }: { year: YearSummary; locale: Locale; t: AdminDictionary }) {
  const y = t.finance.year;
  const c = y.columns;
  const name = (month: YearMonth) => formatMonth(month.month_start.slice(0, 7), locale);
  const { totals } = year;
  const num = "whitespace-nowrap px-4 py-3 text-right tabular-nums";

  return (
    <Panel flush className="@container" title={y.statement} actions={<Help topic="statement" locale={locale} />}>
      {/* Narrow (phones, tablets): one stacked block per month, the total last. */}
      <ul className="@3xl:hidden">
        {year.months.map((month) => (
          <li key={month.month_start} className="adm-row grid gap-2 px-4 py-3">
            <StatementCard
              title={name(month)}
              note={month.isCurrent ? y.soFar : null}
              figures={month}
              locale={locale}
              t={t}
            />
          </li>
        ))}
        <li className="adm-row grid gap-2 bg-adm-surface-muted px-4 py-3">
          <StatementCard title={y.total} note={null} figures={totals} locale={locale} t={t} strong />
        </li>
      </ul>

      {/* Wide (a panel of 48rem and more): the table. */}
      <div className="hidden overflow-x-auto @3xl:block">
        <table className="w-full text-left text-sm">
          <thead className="adm-table-head">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {c.month}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {c.revenue}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {c.otherIncome}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {c.spent}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {c.result}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {c.margin}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {c.investor}
              </th>
            </tr>
          </thead>
          <tbody>
            {year.months.map((month) => (
              <tr key={month.month_start} className="adm-row">
                <th scope="row" className="px-4 py-3 font-medium text-adm-text">
                  {name(month)}
                  {month.isCurrent && <span className="block text-[13px] font-normal text-adm-muted">{y.soFar}</span>}
                </th>
                <td className={num}>{sumText(month.revenue, t)}</td>
                <td className={num}>{sumText(month.other_income, t)}</td>
                <td className={num}>{sumText(month.spent, t)}</td>
                <td className={`${num} font-semibold ${resultClass(month.result)}`}>{sumText(month.result, t)}</td>
                <td className={num}>{pct(month.marginPct, locale)}</td>
                <td className={`${num} ${month.investor_support > 0 ? "text-adm-info" : "text-adm-muted"}`}>
                  {sumText(month.investor_support, t)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="adm-row bg-adm-surface-muted font-semibold">
              <th scope="row" className="px-4 py-3 text-adm-text">
                {y.total}
              </th>
              <td className={num}>{sumText(totals.revenue, t)}</td>
              <td className={num}>{sumText(totals.other_income, t)}</td>
              <td className={num}>{sumText(totals.spent, t)}</td>
              <td className={`${num} ${resultClass(totals.result)}`}>{sumText(totals.result, t)}</td>
              <td className={num}>{pct(totals.marginPct, locale)}</td>
              <td className={`${num} ${totals.investor_support > 0 ? "text-adm-info" : "text-adm-muted"}`}>
                {sumText(totals.investor_support, t)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

function StatementCard({
  title,
  note,
  figures,
  locale,
  t,
  strong = false,
}: {
  title: string;
  note: string | null;
  figures: {
    revenue: number;
    other_income: number;
    spent: number;
    result: number;
    marginPct: number | null;
    investor_support: number;
  };
  locale: Locale;
  t: AdminDictionary;
  strong?: boolean;
}) {
  const c = t.finance.year.columns;
  const line = (label: string, value: string, className = "") => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-adm-muted">{label}</dt>
      <dd className={`whitespace-nowrap tabular-nums ${className}`}>{value}</dd>
    </div>
  );
  return (
    <>
      <p className={`${strong ? "font-semibold" : "font-medium"} text-adm-text`}>
        {title}
        {note && <span className="ml-1.5 text-[13px] font-normal text-adm-muted">{note}</span>}
      </p>
      <dl className="grid gap-1 text-[13px]">
        {line(c.revenue, sumText(figures.revenue, t))}
        {figures.other_income > 0 && line(c.otherIncome, sumText(figures.other_income, t))}
        {line(c.spent, sumText(figures.spent, t))}
        {line(c.result, sumText(figures.result, t), `font-semibold ${resultClass(figures.result)}`)}
        {line(c.margin, pct(figures.marginPct, locale))}
        {figures.investor_support > 0 && line(c.investor, sumText(figures.investor_support, t), "text-adm-info")}
      </dl>
    </>
  );
}
