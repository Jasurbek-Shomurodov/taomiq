import { Banknote, CircleHelp, CreditCard, Landmark, Settings2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { createElement } from "react";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import {
  cashIndicators,
  isEmptyFlow,
  methodTotals,
  type FlowMethod,
  type IndicatorsData,
  type MethodFlow,
  type MethodFlowRow,
} from "@/lib/admin/finance/analysis";
import type { FeeRate } from "@/lib/admin/finance/fees";
import { formatEntryDay, type FinanceMonth } from "@/lib/admin/finance/month";
import { loadFeeRates, loadIndicators, loadMethodFlow } from "@/lib/admin/finance/queries";
import { requireOwner } from "@/lib/admin/auth";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { Skeleton } from "../../kit/Skeleton";
import { DASH, Indicator, Labeled, resultClass, sumText } from "./figures";

/*
 * Finance → Month, round two (docs/plans/zarkebab-feature-port.md, slice 8): the cash row (daily burn, runway,
 * all-time balance) and money by payment method with estimated bank fees. Each loads on its own inside a
 * Suspense boundary, so a slow or failed read only touches its own panel. Owner only (the functions refuse anyone else).
 */

const METHOD_ICONS: Record<FlowMethod, LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  transfer: Landmark,
  unknown: CircleHelp,
};

const selfHref = (month: FinanceMonth) => (month.isCurrent ? "/finance" : `/finance?m=${month.key}`);

/**
 * Daily burn, runway and the all-time balance of the month (public.finance_indicators). No savings rate: under the
 * finance rule it equals the Margin tile above (analysis.ts, CashIndicators).
 */
export async function CashPanel({ month, locale }: { month: FinanceMonth; locale: Locale }) {
  const { supabase } = await requireOwner();
  const t = getAdminDictionary(locale);
  const c = t.finance.cash;

  let data: IndicatorsData | null = null;
  try {
    data = await loadIndicators(supabase, month.from);
  } catch (error) {
    console.error("finance month: indicators failed", error instanceof Error ? error.message : error);
  }

  if (!data) {
    return (
      <Panel title={c.title}>
        <Notice tone="negative" retry={{ href: selfHref(month), label: t.common.retry }}>
          {c.loadFailed}
        </Notice>
      </Panel>
    );
  }

  const figures = cashIndicators(data);
  const runway =
    figures.runwayDays === null
      ? { value: DASH, hint: c.noBurn, className: "" }
      : figures.balance <= 0
        ? { value: c.runwayValue(0), hint: c.runwayEmpty, className: "text-adm-negative" }
        : { value: c.runwayValue(figures.runwayDays), hint: c.runwayHint, className: "" };

  return (
    <Panel title={c.title} description={c.lead}>
      <dl className="grid gap-x-6 gap-y-5 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
        <Indicator
          topic="dailyBurn"
          label={c.dailyBurn}
          value={
            figures.dailyBurn === null
              ? DASH
              : figures.dailyBurn > 0 && figures.dailyBurn < 0.5
                ? `< 1 ${t.common.currency}`
                : sumText(figures.dailyBurn, t)
          }
          hint={c.dailyBurnHint(data.days)}
          locale={locale}
        />
        <Indicator
          topic="runway"
          label={c.runway}
          value={runway.value}
          valueClass={runway.className}
          hint={runway.hint}
          locale={locale}
        />
        <Indicator
          topic="allTimeBalance"
          label={c.balance}
          value={sumText(figures.balance, t)}
          valueClass={resultClass(figures.balance)}
          hint={c.balanceHint(formatEntryDay(data.through, locale))}
          locale={locale}
        />
      </dl>
    </Panel>
  );
}

/** Money in and out per payment method over the month (to today for the running one), with estimated bank fees. */
export async function MethodPanel({ month, today, locale }: { month: FinanceMonth; today: string; locale: Locale }) {
  const { supabase } = await requireOwner();
  const t = getAdminDictionary(locale);
  const b = t.finance.byMethod;
  const to = month.isCurrent ? today : month.to;

  const [flow, rates] = await Promise.all([
    loadMethodFlow(supabase, month.from, to).catch((error: unknown) => {
      console.error("finance month: method flow failed", error instanceof Error ? error.message : error);
      return null;
    }),
    // Only to say that no rate is set; a failed read just leaves that line out.
    loadFeeRates(supabase).catch((error: unknown) => {
      console.error("finance month: fee rates failed", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);

  const ratesLink = (
    <Link href="/settings#finance" className="adm-btn adm-btn-outline adm-btn-sm">
      <Settings2 aria-hidden="true" />
      {b.ratesLink}
    </Link>
  );
  const title = (
    <Labeled topic="byMethod" locale={locale}>
      {b.title}
    </Labeled>
  );

  if (!flow) {
    return (
      <Panel title={title} actions={ratesLink}>
        <Notice tone="negative" retry={{ href: selfHref(month), label: t.common.retry }}>
          {b.loadFailed}
        </Notice>
      </Panel>
    );
  }

  return (
    <Panel flush title={title} description={b.lead} actions={ratesLink}>
      <MethodBody flow={flow} rates={rates} t={t} locale={locale} />
    </Panel>
  );
}

function MethodBody({
  flow,
  rates,
  t,
  locale,
}: {
  flow: MethodFlow;
  rates: FeeRate[] | null;
  t: AdminDictionary;
  locale: Locale;
}) {
  const b = t.finance.byMethod;
  if (isEmptyFlow(flow)) return <EmptyState icon={Banknote}>{b.empty}</EmptyState>;
  const rows = flow.methods.filter((row) => row.method !== "unknown" || row.order_count > 0);

  return (
    <>
      <ul>
        {rows.map((row) => (
          <MethodRow key={row.method} row={row} t={t} />
        ))}
      </ul>
      <div className="adm-row grid gap-2 bg-adm-surface-muted px-4 py-3 sm:px-5">
        <p className="flex flex-wrap items-center gap-x-2 font-semibold tabular-nums text-adm-text">
          <Labeled topic="feeEstimate" locale={locale}>
            {b.feeTotal(sumText(flow.fee_total, t))}
          </Labeled>
        </p>
        {rates !== null && rates.length === 0 && <p className="adm-caption">{b.noRates}</p>}
      </div>
    </>
  );
}

function MethodRow({ row, t }: { row: MethodFlowRow; t: AdminDictionary }) {
  const b = t.finance.byMethod;
  const totals = methodTotals(row);
  const hasFee = row.method === "card" || row.method === "transfer";
  const figure = (label: string, value: string, className = "") => (
    <div className="grid content-start gap-0.5">
      <dt className="adm-caption">{label}</dt>
      <dd className={`whitespace-nowrap font-semibold tabular-nums text-adm-text ${className}`}>{value}</dd>
    </div>
  );

  return (
    <li className="adm-row grid gap-3 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="adm-tone-neutral grid size-8 shrink-0 place-items-center rounded-adm-control">
          {createElement(METHOD_ICONS[row.method], { "aria-hidden": true, className: "size-4" })}
        </span>
        <p className="font-semibold text-adm-text">{b.methods[row.method]}</p>
        <p className="adm-caption tabular-nums">
          {row.order_count > 0 ? b.orders(row.order_count, sumText(row.orders, t)) : b.noOrders}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {figure(b.in, sumText(totals.in, t))}
        {figure(b.out, sumText(totals.out, t))}
        {figure(b.net, sumText(totals.net, t), resultClass(totals.net))}
        {figure(b.fee, hasFee ? sumText(row.fee, t) : b.noFee, hasFee ? "" : "font-normal text-adm-muted")}
      </dl>
      {row.method === "unknown" && <p className="adm-caption">{b.unknownHint}</p>}
      {row.unrated_count > 0 && <p className="adm-caption text-adm-caution">{b.unrated(row.unrated_count)}</p>}
    </li>
  );
}

/** While a panel loads: a heading and a row of figures. */
export function AnalysisPanelSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div className="adm-panel grid gap-3" aria-hidden="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-64" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, j) => (
            <Skeleton key={j} className="h-10 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
