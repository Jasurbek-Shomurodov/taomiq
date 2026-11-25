import { Trophy, Waypoints } from "lucide-react";
import { getAdminDictionary } from "@/i18n/admin";
import { htmlLang, type Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import {
  moneyFlow,
  recordSharePct,
  type FinanceRecords,
  type FlowSource,
  type FlowUse,
} from "@/lib/admin/finance/analysis";
import type { FinancePeriod } from "@/lib/admin/finance/math";
import { formatDayRange, formatEntryDay, formatMonth } from "@/lib/admin/finance/month";
import { loadPeriod, loadRecords } from "@/lib/admin/finance/queries";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { Sankey, type SankeyTone } from "../../../kit/Sankey";
import { Skeleton } from "../../../kit/Skeleton";
import type { ReactNode } from "react";
import { DASH, Labeled, pct, resultClass, sumText } from "../figures";

/*
 * Finance → Year, round two (docs/plans/zarkebab-feature-port.md, slice 8): the records of the whole history and the
 * 12 months' money flow as a Sankey. Each loads on its own inside a Suspense boundary; a failed read shows a notice in
 * its own panel only. Owner only (the functions refuse anyone else).
 */

const SOURCE_TONES: Record<FlowSource, SankeyTone> = {
  orders: "accent",
  other_income: "positive",
  investor: "info",
  reserves: "caution",
};

const USE_TONES: Record<FlowUse, SankeyTone> = {
  food: "neutral",
  team: "neutral",
  premises: "neutral",
  delivery: "neutral",
  marketing: "neutral",
  other: "neutral",
  left: "positive",
};

/** One record in the panel's <dl>: as figures.tsx Indicator, without a "?" of its own (the panel title has one). */
function Figure({
  label,
  value,
  valueClass = "",
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  valueClass?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1">
      <dt className="adm-caption font-medium">{label}</dt>
      <dd className={`whitespace-nowrap text-xl font-semibold tabular-nums text-adm-text ${valueClass}`}>{value}</dd>
      {hint && <dd className="adm-caption flex flex-wrap items-center gap-2 tabular-nums">{hint}</dd>}
    </div>
  );
}

/** "YYYY-MM-01" → the month's name. */
const monthName = (monthStart: string, locale: Locale) => formatMonth(monthStart.slice(0, 7), locale);

/** Best month, best 10 days, best day, best result and profitable runs (public.finance_records). */
export async function RecordsPanel({ locale }: { locale: Locale }) {
  const { supabase } = await requireOwner();
  const t = getAdminDictionary(locale);
  const r = t.finance.bests;
  const title = (
    <Labeled topic="records" locale={locale}>
      {r.title}
    </Labeled>
  );

  let records: FinanceRecords | null = null;
  try {
    records = await loadRecords(supabase);
  } catch (error) {
    console.error("finance year: records failed", error instanceof Error ? error.message : error);
  }

  if (!records) {
    return (
      <Panel title={title}>
        <Notice tone="negative" retry={{ href: "/finance/year", label: t.common.retry }}>
          {r.loadFailed}
        </Notice>
      </Panel>
    );
  }

  // Empty only with no activity at all (no paid order, ledger entry, payroll event or employee): with ledger rows but
  // no finished month or sale yet, the panel shows each record as "none yet" instead.
  if (records.months === 0) {
    return (
      <Panel title={title}>
        <EmptyState icon={Trophy}>{r.empty}</EmptyState>
      </Panel>
    );
  }

  const share = recordSharePct(records);
  const run = records.longest_run;

  return (
    <Panel title={title} description={r.lead}>
      <dl className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
        <Figure
          label={r.bestMonth}
          value={records.best_month ? sumText(records.best_month.revenue, t) : DASH}
          hint={
            records.best_month ? (
              <span className="grid gap-0.5">
                <span>{r.bestMonthHint(monthName(records.best_month.month_start, locale), records.best_month.order_count)}</span>
                {share !== null && <span>{r.thisMonth(pct(share, locale))}</span>}
              </span>
            ) : (
              r.none
            )
          }
        />
        <Figure
          label={r.bestTen}
          value={records.best_ten_days ? sumText(records.best_ten_days.revenue, t) : DASH}
          hint={
            records.best_ten_days
              ? r.bestTenHint(formatDayRange(records.best_ten_days.from, records.best_ten_days.to, locale))
              : r.none
          }
        />
        <Figure
          label={r.bestDay}
          value={records.best_day ? sumText(records.best_day.revenue, t) : DASH}
          hint={
            records.best_day
              ? r.bestDayHint(formatEntryDay(records.best_day.day, locale), records.best_day.order_count)
              : r.none
          }
        />
        <Figure
          label={r.bestResult}
          value={records.best_result_month ? sumText(records.best_result_month.result, t) : DASH}
          valueClass={resultClass(records.best_result_month?.result ?? null)}
          hint={records.best_result_month ? monthName(records.best_result_month.month_start, locale) : r.none}
        />
        <Figure
          label={r.longestRun}
          value={run ? r.runValue(run.months) : DASH}
          hint={
            run ? (
              <span className="grid gap-0.5">
                <span>
                  {r.runHint(
                    run.from === run.to
                      ? monthName(run.from, locale)
                      : `${monthName(run.from, locale)} — ${monthName(run.to, locale)}`,
                  )}
                </span>
                <span>{r.currentRun(records.current_run)}</span>
              </span>
            ) : (
              r.noRun
            )
          }
        />
      </dl>
    </Panel>
  );
}

/** Where the 12 months' money came from and where it went, as a Sankey (public.finance_period over the window). */
export async function MoneyFlowPanel({ from, to, locale }: { from: string; to: string; locale: Locale }) {
  const { supabase } = await requireOwner();
  const t = getAdminDictionary(locale);
  const fl = t.finance.flow;
  const title = (
    <Labeled topic="moneyFlow" locale={locale}>
      {fl.title}
    </Labeled>
  );

  let period: FinancePeriod | null = null;
  try {
    period = await loadPeriod(supabase, from, to);
  } catch (error) {
    console.error("finance year: money flow failed", error instanceof Error ? error.message : error);
  }

  if (!period) {
    return (
      <Panel title={title}>
        <Notice tone="negative" retry={{ href: "/finance/year", label: t.common.retry }}>
          {fl.loadFailed}
        </Notice>
      </Panel>
    );
  }

  const flow = moneyFlow(period);
  if (flow.total === 0) {
    return (
      <Panel title={title}>
        <EmptyState icon={Waypoints}>{fl.empty}</EmptyState>
      </Panel>
    );
  }

  const percent = new Intl.NumberFormat(htmlLang[locale], { style: "percent", maximumFractionDigits: 0 });

  return (
    <Panel title={title} description={fl.lead}>
      <Sankey
        sources={flow.sources.map((node) => ({
          key: node.key,
          label: fl.sources[node.key],
          amount: node.amount,
          tone: SOURCE_TONES[node.key],
        }))}
        middle={fl.middle}
        targets={flow.uses.map((node) => ({
          key: node.key,
          label: fl.uses[node.key],
          amount: node.amount,
          tone: USE_TONES[node.key],
        }))}
        total={flow.total}
        format={(amount) => sumText(amount, t)}
        share={(fraction) => (fraction > 0 && fraction < 0.005 ? "<1 %" : percent.format(fraction))}
        caption={fl.tableCaption}
        headers={{ from: fl.tableFrom, to: fl.tableTo, amount: fl.tableAmount, share: fl.tableShare }}
        scrollHint={fl.scrollHint}
      />
    </Panel>
  );
}

export function YearPanelSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className="adm-panel grid gap-3" aria-hidden="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-64" />
      <Skeleton className={tall ? "h-72 w-full" : "h-16 w-full"} />
    </div>
  );
}
