import { CalendarCheck, CalendarClock, Lock, NotebookPen, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import { htmlLang, type Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import {
  closedSummary,
  closeIncome,
  closeMarginPct,
  type CloseFigures,
  type CloseLogEntry,
  type CloseMonth,
  type CloseOverview,
  type CloseStatus,
  type FrozenClose,
  type SalaryShare,
} from "@/lib/admin/finance/math";
import { formatMonth, formatMonthShort } from "@/lib/admin/finance/month";
import { loadCloseOverview, loadFinanceSettings } from "@/lib/admin/finance/queries";
import type { FinanceSettings } from "@/lib/admin/finance/settings";
import { Badge, type Tone } from "../../../kit/Badge";
import type { ChartBar } from "../../../kit/BarChart";
import { BeforeHydration } from "../../../kit/BeforeHydration";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { SignedBarChart } from "../../../kit/SignedBarChart";
import { StatTile } from "../../../kit/StatTile";
import { FinanceTabs } from "../FinanceTabs";
import { DASH, Help, Labeled, Money, pct, resultClass, resultTone, sumText } from "../figures";
import { CloseMonthForm, ReopenMonthForm } from "./CloseForms";
import { SettingsForm } from "./SettingsForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).finance;
  return { title: `${t.tabs.close} · ${t.title}` };
}

const SELF = "/finance/close";

const STATUS_TONES: Record<CloseStatus, Tone> = {
  closed: "positive",
  ready: "caution",
  waiting: "neutral",
  current: "info",
};

async function settle<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(`finance close: ${what} failed`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** "25 нояб. 2026 г., 14:03": a moment in Tashkent time. */
function formatMoment(at: string, locale: Locale): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return new Intl.DateTimeFormat(htmlLang[locale], {
    timeZone: "Asia/Tashkent",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const monthKey = (start: string) => start.slice(0, 7);

/** The figures a month row shows: frozen once closed, counted now otherwise. */
const figuresOf = (month: CloseMonth): CloseFigures => month.closed ?? month.live;

/**
 * Finance → Month close (docs/plans/finance-investor-payroll.md, slice 4). Every month from the first one with activity
 * to the running one: closed months with their frozen official result (salary counted as earned) and any drift since,
 * the next month to close with a confirmation, reopening the latest closed month with a reason, the close history and,
 * at the bottom, the finance settings the Month estimate uses. Everything is counted in the database
 * (finance_close_overview); a failed read shows a notice with a retry.
 */
export default async function FinanceClosePage() {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const c = t.finance.close;

  const [overview, settings] = await Promise.all([
    settle("overview", () => loadCloseOverview(supabase)),
    settle("settings", () => loadFinanceSettings(supabase)),
  ]);

  return (
    <div className="adm-page">
      <BeforeHydration>
        <FinanceTabs locale={locale} />
      </BeforeHydration>

      <p className="adm-caption">{c.lead}</p>

      {!overview ? (
        <Notice tone="negative" retry={{ href: SELF, label: t.common.retry }}>
          {c.loadFailed}
        </Notice>
      ) : overview.months.length === 0 ? (
        <Panel>
          <EmptyState
            icon={NotebookPen}
            action={
              <Link href="/finance/records" className="adm-btn adm-btn-primary">
                {t.finance.toRecords}
              </Link>
            }
          >
            {c.empty}
          </EmptyState>
        </Panel>
      ) : (
        <CloseBody overview={overview} locale={locale} t={t} />
      )}

      <SettingsPanel settings={settings} locale={locale} t={t} />
    </div>
  );
}

function CloseBody({ overview, locale, t }: { overview: CloseOverview; locale: Locale; t: AdminDictionary }) {
  const c = t.finance.close;
  const closes = overview.months.flatMap((month) => (month.closed ? [month.closed] : []));
  const summary = closedSummary(closes);
  const name = (start: string) => formatMonth(monthKey(start), locale);
  const next = overview.nextToClose ? overview.months.find((month) => month.month_start === overview.nextToClose) : null;
  const latestClosed = closes.at(-1) ?? null;

  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile
          label={<Labeled topic="closedResult" locale={locale}>{c.total}</Labeled>}
          value={summary.count > 0 ? <Money value={summary.total} t={t} className={resultClass(summary.total)} /> : DASH}
          icon={summary.total < 0 ? TrendingDown : TrendingUp}
          tone={summary.count > 0 ? resultTone(summary.total) : "neutral"}
          footer={<span>{c.totalHint(summary.count)}</span>}
        />
        <StatTile
          label={c.average}
          value={
            summary.average === null ? DASH : <Money value={summary.average} t={t} className={resultClass(summary.average)} />
          }
          icon={CalendarCheck}
        />
        <StatTile
          label={c.best}
          value={summary.best ? <Money value={summary.best.result} t={t} className={resultClass(summary.best.result)} /> : DASH}
          icon={TrendingUp}
          tone="positive"
          footer={summary.best ? <span>{name(summary.best.month_start)}</span> : undefined}
        />
        <StatTile
          label={c.worst}
          value={
            summary.worst ? <Money value={summary.worst.result} t={t} className={resultClass(summary.worst.result)} /> : DASH
          }
          icon={TrendingDown}
          tone={summary.worst && summary.worst.result < 0 ? "negative" : "neutral"}
          footer={summary.worst ? <span>{name(summary.worst.month_start)}</span> : undefined}
        />
      </div>

      {next ? (
        <Panel title={c.closeTitle(name(next.month_start))} description={c.closeLead}>
          <div className="grid gap-5">
            <FiguresLine figures={next.live} locale={locale} t={t} />
            <CloseMonthForm
              monthStart={next.month_start}
              monthName={name(next.month_start)}
              resultText={sumText(next.live.result, t)}
              locale={locale}
            />
          </div>
        </Panel>
      ) : (
        <Notice tone="info">{c.nothingReady}</Notice>
      )}

      {closes.length > 0 && <ResultChart closes={closes} locale={locale} t={t} />}

      <MonthsTable months={overview.months} locale={locale} t={t} />

      {latestClosed && (
        <Panel title={c.reopenTitle} description={c.reopenLead(name(latestClosed.month_start))}>
          <ReopenMonthForm
            monthStart={latestClosed.month_start}
            monthName={name(latestClosed.month_start)}
            locale={locale}
          />
        </Panel>
      )}

      {overview.log.length > 0 && <History log={overview.log} locale={locale} t={t} />}
    </>
  );
}

/** Income, expenses, salary earned and result of a month in one row of figures. */
function FiguresLine({ figures, locale, t }: { figures: CloseFigures; locale: Locale; t: AdminDictionary }) {
  const col = t.finance.close.columns;
  const item = (label: ReactNode, value: string, className = "") => (
    <div className="grid content-start gap-1">
      <dt className="adm-caption font-medium">{label}</dt>
      <dd className={`whitespace-nowrap text-lg font-semibold tabular-nums text-adm-text ${className}`}>{value}</dd>
    </div>
  );
  return (
    <dl className="grid gap-x-6 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
      {item(col.income, sumText(closeIncome(figures), t))}
      {item(col.expenses, sumText(figures.expenses, t))}
      {item(
        <Labeled topic="salaryEarned" locale={locale}>
          {col.salary}
        </Labeled>,
        sumText(figures.salary_earned, t),
      )}
      {item(
        <Labeled topic="closedResult" locale={locale}>
          {col.result}
        </Labeled>,
        sumText(figures.result, t),
        resultClass(figures.result),
      )}
    </dl>
  );
}

function ResultChart({ closes, locale, t }: { closes: FrozenClose[]; locale: Locale; t: AdminDictionary }) {
  const c = t.finance.close;
  const shown = closes.slice(-24);
  const last = shown.length - 1;
  const step = shown.length > 12 ? 3 : 2;
  const bars: ChartBar[] = shown.map((close, i) => {
    const key = monthKey(close.month_start);
    return {
      key,
      value: close.result,
      display: sumText(close.result, t),
      label: formatMonth(key, locale),
      axis: (last - i) % step === 0 ? formatMonthShort(key, locale) : undefined,
      current: i === last,
    };
  });
  return (
    <Panel title={<Labeled topic="closedResult" locale={locale}>{c.chartTitle}</Labeled>} description={c.chartLead}>
      <SignedBarChart bars={bars} caption={c.chartCaption} headers={[c.chartMonth, t.finance.result]} />
    </Panel>
  );
}

function StatusBadge({ status, t }: { status: CloseStatus; t: AdminDictionary }) {
  return (
    <Badge tone={STATUS_TONES[status]} status icon={status === "closed" ? <Lock aria-hidden="true" className="size-3" /> : undefined}>
      {t.finance.close.status[status]}
    </Badge>
  );
}

function MonthsTable({ months, locale, t }: { months: CloseMonth[]; locale: Locale; t: AdminDictionary }) {
  const c = t.finance.close;
  const col = c.columns;
  const rows = [...months].reverse();
  const name = (start: string) => formatMonth(monthKey(start), locale);
  const firstOpen = months.find((month) => month.status === "ready")?.month_start ?? null;
  const num = "whitespace-nowrap px-4 py-3 text-right tabular-nums";
  const note = (month: CloseMonth) =>
    month.status === "current"
      ? c.currentHint
      : month.status === "waiting" && firstOpen
        ? c.waitingHint(name(firstOpen))
        : month.closed
          ? c.closedOn(formatMoment(month.closed.closed_at, locale), month.closed.closed_by_name)
          : null;

  return (
    <Panel flush className="@container" title={c.tableTitle} description={c.tableLead}>
      {/* Narrow (phones, tablets): one stacked block per month. */}
      <ul className="@3xl:hidden">
        {rows.map((month) => {
          const figures = figuresOf(month);
          const line = (label: ReactNode, value: string, className = "") => (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-adm-muted">{label}</dt>
              <dd className={`whitespace-nowrap tabular-nums ${className}`}>{value}</dd>
            </div>
          );
          return (
            <li key={month.month_start} className="adm-row grid gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-adm-text">{name(month.month_start)}</p>
                <StatusBadge status={month.status} t={t} />
              </div>
              {note(month) && <p className="adm-caption">{note(month)}</p>}
              <dl className="grid gap-1 text-[13px]">
                {line(col.income, sumText(closeIncome(figures), t))}
                {line(col.expenses, sumText(figures.expenses, t))}
                {line(col.salary, sumText(figures.salary_earned, t))}
                {line(col.result, sumText(figures.result, t), `font-semibold ${resultClass(figures.result)}`)}
                {line(col.margin, pct(closeMarginPct(figures), locale))}
              </dl>
              <MonthExtras month={month} locale={locale} t={t} />
            </li>
          );
        })}
      </ul>

      {/* Wide (a panel of 48rem and more): the table, each closed month with its details on a second row. */}
      <div className="hidden overflow-x-auto @3xl:block">
        <table className="w-full text-left text-sm">
          <thead className="adm-table-head">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {col.month}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {col.income}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {col.expenses}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <Labeled topic="salaryEarned" locale={locale}>
                  {col.salary}
                </Labeled>
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {col.result}
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                {col.margin}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                {col.status}
              </th>
            </tr>
          </thead>
          {rows.map((month) => {
            const figures = figuresOf(month);
            const extras = month.closed !== null;
            return (
              <tbody key={month.month_start} className="adm-row">
                <tr>
                  <th scope="row" className="px-4 py-3 font-medium text-adm-text">
                    {name(month.month_start)}
                    {note(month) && <span className="block text-[13px] font-normal text-adm-muted">{note(month)}</span>}
                  </th>
                  <td className={num}>{sumText(closeIncome(figures), t)}</td>
                  <td className={num}>{sumText(figures.expenses, t)}</td>
                  <td className={num}>{sumText(figures.salary_earned, t)}</td>
                  <td className={`${num} font-semibold ${resultClass(figures.result)}`}>{sumText(figures.result, t)}</td>
                  <td className={num}>{pct(closeMarginPct(figures), locale)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={month.status} t={t} />
                  </td>
                </tr>
                {extras && (
                  <tr>
                    <td colSpan={7} className="px-4 pb-3">
                      <MonthExtras month={month} locale={locale} t={t} />
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </Panel>
  );
}

/** Under a closed month: the drift warning (when its figures moved since) and the per-person salary, folded. */
function MonthExtras({ month, locale, t }: { month: CloseMonth; locale: Locale; t: AdminDictionary }) {
  const c = t.finance.close;
  if (!month.closed) return null;
  const drift = month.drift ?? 0;
  const shares = month.closed.salary_breakdown;
  return (
    <div className="grid gap-2">
      {drift !== 0 && (
        <div role="note" className="adm-tone-caution flex items-start gap-2 rounded-adm-control px-3 py-2 text-[13px]">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{c.driftBadge}. </span>
            {c.drift(sumText(month.live.result, t), signedSum(drift, t))}
          </span>
          <Help topic="drift" locale={locale} />
        </div>
      )}
      {shares.length > 0 ? (
        <details className="group">
          <summary className="adm-caption cursor-pointer font-medium text-adm-accent-ink">
            {c.breakdownShow(shares.length)}
          </summary>
          <Breakdown shares={shares} t={t} />
        </details>
      ) : (
        <p className="adm-caption">{c.breakdownEmpty}</p>
      )}
    </div>
  );
}

/** "+120 000 сум", "−500 000 сум". */
function signedSum(value: number, t: AdminDictionary): string {
  return value > 0 ? `+${sumText(value, t)}` : sumText(value, t);
}

function Breakdown({ shares, t }: { shares: SalaryShare[]; t: AdminDictionary }) {
  const b = t.finance.close.breakdownColumns;
  const num = "whitespace-nowrap px-3 py-2 text-right tabular-nums";
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead className="adm-table-head">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {b.name}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {b.days}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {b.accrued}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {b.bonuses}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {b.fines}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {b.earned}
            </th>
          </tr>
        </thead>
        <tbody>
          {shares.map((share) => (
            <tr key={share.employee_id} className="adm-row">
              <th scope="row" className="px-3 py-2 font-medium text-adm-text" data-ph-mask>
                {share.name}
              </th>
              <td className={num}>{share.days}</td>
              <td className={num}>{sumText(share.accrued, t)}</td>
              <td className={`${num} ${share.bonuses > 0 ? "" : "text-adm-muted"}`}>{sumText(share.bonuses, t)}</td>
              <td className={`${num} ${share.fines > 0 ? "text-adm-negative" : "text-adm-muted"}`}>
                {share.fines > 0 ? `−${sumText(share.fines, t)}` : sumText(0, t)}
              </td>
              <td className={`${num} font-semibold`}>{sumText(share.earned, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ log, locale, t }: { log: CloseLogEntry[]; locale: Locale; t: AdminDictionary }) {
  const c = t.finance.close;
  const name = (start: string) => formatMonth(monthKey(start), locale);
  return (
    <Panel flush title={c.historyTitle}>
      <ul>
        {log.map((entry, i) => (
          <li key={`${entry.at}-${i}`} className="adm-row flex items-start gap-3 px-4 py-3 sm:px-5">
            <span
              className={`${entry.action === "closed" ? "adm-tone-positive" : "adm-tone-caution"} mt-0.5 grid size-9 shrink-0 place-items-center rounded-adm-control`}
            >
              {entry.action === "closed" ? (
                <Lock aria-hidden="true" className="size-4" />
              ) : (
                <CalendarClock aria-hidden="true" className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-adm-text">
                {entry.action === "closed"
                  ? c.historyClosed(name(entry.month_start), sumText(entry.result, t))
                  : c.historyReopened(name(entry.month_start))}
              </p>
              <p className="adm-caption tabular-nums">{c.historyBy(formatMoment(entry.at, locale), entry.actor_name)}</p>
              {entry.reason && (
                <p className="adm-caption mt-1 whitespace-pre-line break-words" data-ph-mask>
                  {entry.reason}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SettingsPanel({
  settings,
  locale,
  t,
}: {
  settings: FinanceSettings | null;
  locale: Locale;
  t: AdminDictionary;
}) {
  const s = t.finance.settings;
  return (
    <Panel title={s.title} description={s.lead}>
      <div id="settings" className="scroll-mt-32">
        {settings ? (
          <SettingsForm settings={settings} locale={locale} />
        ) : (
          <Notice tone="negative" retry={{ href: SELF, label: t.common.retry }}>
            {s.loadFailed}
          </Notice>
        )}
      </div>
    </Panel>
  );
}
