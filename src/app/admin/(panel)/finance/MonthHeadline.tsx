import { NotebookPen, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import Link from "next/link";
import { getAdminDictionary } from "@/i18n/admin";
import { formatSum } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { isEmptyMonth, monthResult, type MonthCashflow } from "@/lib/admin/finance/math";
import { formatMonth } from "@/lib/admin/finance/month";
import { loadMonthlyCashflow } from "@/lib/admin/finance/queries";
import { tashkentDay } from "@/lib/admin/stats";
import { EmptyState } from "../../kit/EmptyState";
import { Notice } from "../../kit/Notice";
import { Panel } from "../../kit/Panel";
import { StatTile } from "../../kit/StatTile";

const DASH = "—";

/**
 * The current Tashkent month in three figures: revenue, spending and the result (public.finance_monthly_cashflow(1),
 * migration 0013). Investor money is never part of them; when the month has some, a note says how much and that it
 * is left out. A failed read prints "—" in every tile with one notice and a retry, never a made-up 0. Used by the
 * Month and Year tabs until their full screens (slice 2) replace it.
 */
export async function MonthHeadline({ view }: { view: "month" | "year" }) {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const f = t.finance;
  // Read the clock only after the session (a request-time read).
  const today = tashkentDay(new Date())!;

  let row: MonthCashflow | null = null;
  try {
    row = (await loadMonthlyCashflow(supabase, 1)).at(-1) ?? null;
  } catch (error) {
    console.error("finance headline failed", error instanceof Error ? error.message : error);
  }

  const monthName = formatMonth((row?.month_start ?? today).slice(0, 7), locale);
  const figures = row ? monthResult(row) : null;
  const signed = (value: number) => `${value < 0 ? "−" : ""}${formatSum(Math.abs(value))}`;
  const money = (value: number, className = "") => (
    <span className={className}>
      {signed(value)}
      <span className="ml-1.5 text-base font-medium text-adm-muted">{t.common.currency}</span>
    </span>
  );
  const resultTone = !figures || figures.result === 0 ? "accent" : figures.result > 0 ? "positive" : "negative";
  const resultClass =
    resultTone === "positive" ? "text-adm-positive" : resultTone === "negative" ? "text-adm-negative" : "";

  return (
    <>
      <p className="adm-muted">{view === "month" ? f.monthLead(monthName) : f.yearLead(monthName)}</p>

      {!row && (
        <Notice tone="negative" retry={{ href: view === "month" ? "/finance" : "/finance/year", label: t.common.retry }}>
          {f.loadFailed}
        </Notice>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile
          label={f.revenue}
          value={row ? money(row.revenue) : DASH}
          icon={Wallet}
          footer={row ? <span>{f.revenueHint(row.order_count)}</span> : undefined}
        />
        <StatTile
          label={f.spent}
          value={figures ? money(figures.spent) : DASH}
          icon={Receipt}
          footer={<span>{f.spentHint}</span>}
        />
        <StatTile
          label={f.result}
          value={figures ? money(figures.result, resultClass) : DASH}
          icon={figures && figures.result < 0 ? TrendingDown : TrendingUp}
          tone={resultTone}
          footer={<span>{f.resultHint}</span>}
        />
      </div>

      {row && row.investor_support > 0 && (
        <Notice tone="info">{f.investorNote(`${formatSum(row.investor_support)} ${t.common.currency}`)}</Notice>
      )}

      {row && isEmptyMonth(row) && (
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
      )}
    </>
  );
}
