import { CalendarRange, ChevronRight, HandCoins, UsersRound, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getAdminDictionary, type AdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { requireOwner } from "@/lib/admin/auth";
import { balanceState, payrollSummary, type PayrollRow } from "@/lib/admin/finance/math";
import { formatEntryDay, formatMonth } from "@/lib/admin/finance/month";
import { loadPayroll } from "@/lib/admin/finance/queries";
import { tashkentDay } from "@/lib/admin/stats";
import { BeforeHydration } from "../../../kit/BeforeHydration";
import { EmptyState } from "../../../kit/EmptyState";
import { Notice } from "../../../kit/Notice";
import { Panel } from "../../../kit/Panel";
import { StatTile } from "../../../kit/StatTile";
import { FinanceTabs } from "../FinanceTabs";
import { Labeled, Money, sumText } from "../figures";
import { BalanceBadge, rateLine } from "./parts";
import { EmployeeForm } from "./EmployeeForm";

export async function generateMetadata(): Promise<Metadata> {
  const { staff } = await requireOwner();
  const t = getAdminDictionary(staff.locale).finance;
  return { title: `${t.tabs.payroll} · ${t.title}` };
}

/**
 * Finance → Payroll (docs/plans/finance-investor-payroll.md, slice 3): what is owed now, the month's salary
 * commitment and what was paid this month; the people working (then the former staff) with their rate and balance;
 * the form for a new person. Everything comes from one call, public.finance_payroll(today), which does the accrual in
 * the database. A person's rates, payments, bonuses, fines and absences live on their own page.
 */
export default async function FinancePayrollPage() {
  const { supabase, staff } = await requireOwner();
  const { locale } = staff;
  const t = getAdminDictionary(locale);
  const p = t.finance.payroll;
  // Read the clock only after the session (a request-time read).
  const today = tashkentDay(new Date())!;

  let rows: PayrollRow[] | null = null;
  try {
    rows = await loadPayroll(supabase, today);
  } catch (error) {
    console.error("finance payroll failed", error instanceof Error ? error.message : error);
  }

  return (
    <div className="adm-page">
      <BeforeHydration>
        <FinanceTabs locale={locale} />
      </BeforeHydration>

      <p className="adm-caption">{p.lead}</p>

      {!rows ? (
        <Notice tone="negative" retry={{ href: "/finance/payroll", label: t.common.retry }}>
          {p.loadFailed}
        </Notice>
      ) : (
        <PayrollBody rows={rows} today={today} locale={locale} t={t} />
      )}

      <Panel title={p.addTitle} description={p.addLead}>
        <EmployeeForm locale={locale} today={today} />
      </Panel>
    </div>
  );
}

function PayrollBody({
  rows,
  today,
  locale,
  t,
}: {
  rows: PayrollRow[];
  today: string;
  locale: Locale;
  t: AdminDictionary;
}) {
  const p = t.finance.payroll;
  const summary = payrollSummary(rows);
  const owed = rows.filter((row) => row.balance > 0).length;
  const active = rows.filter((row) => row.is_active);
  const former = rows.filter((row) => !row.is_active);

  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        <StatTile
          label={<Labeled topic="due" locale={locale}>{p.due}</Labeled>}
          value={<Money value={summary.due} t={t} />}
          icon={Wallet}
          tone={summary.due > 0 ? "caution" : "accent"}
          footer={
            <>
              <span>{p.dueHint(owed)}</span>
              {summary.advance > 0 && <span className="text-adm-info">{p.advanceHint(sumText(summary.advance, t))}</span>}
            </>
          }
        />
        <StatTile
          label={<Labeled topic="monthPay" locale={locale}>{p.monthPay}</Labeled>}
          value={<Money value={summary.monthPay} t={t} />}
          icon={CalendarRange}
          footer={<span>{p.monthPayHint(formatMonth(today.slice(0, 7), locale))}</span>}
        />
        <StatTile
          label={<Labeled topic="paidMonth" locale={locale}>{p.paidMonth}</Labeled>}
          value={<Money value={summary.paidMonth} t={t} />}
          icon={HandCoins}
          footer={<span>{p.paidMonthHint}</span>}
        />
      </div>

      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon={UsersRound}>{p.empty}</EmptyState>
        </Panel>
      ) : (
        <>
          <Panel flush title={p.staffTitle} description={p.staffCount(active.length)}>
            {active.length === 0 ? (
              <EmptyState icon={UsersRound}>{p.empty}</EmptyState>
            ) : (
              <ul>
                {active.map((row) => (
                  <EmployeeRow key={row.employee_id} row={row} locale={locale} t={t} />
                ))}
              </ul>
            )}
          </Panel>
          {former.length > 0 && (
            <Panel flush title={p.formerTitle} description={p.formerLead}>
              <ul>
                {former.map((row) => (
                  <EmployeeRow key={row.employee_id} row={row} locale={locale} t={t} />
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </>
  );
}

function EmployeeRow({ row, locale, t }: { row: PayrollRow; locale: Locale; t: AdminDictionary }) {
  const p = t.finance.payroll;
  const state = balanceState(row.balance);
  const dates = row.ended_at ? p.lastDay(formatEntryDay(row.ended_at, locale)) : p.since(formatEntryDay(row.joined_at, locale));
  return (
    <li className="adm-row">
      <Link
        href={`/finance/payroll/${row.employee_id}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-adm-surface-muted sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-adm-text" data-ph-mask>
            {row.name}
          </p>
          <p className="adm-caption truncate">{[row.job_title, dates].filter(Boolean).join(" · ")}</p>
          <p className="adm-caption tabular-nums">{rateLine(row.rate_amount, row.rate_unit, t)}</p>
        </div>
        <div className="grid shrink-0 justify-items-end gap-1">
          <span
            className={`whitespace-nowrap font-semibold tabular-nums ${state.kind === "due" ? "text-adm-text" : state.kind === "advance" ? "text-adm-info" : "text-adm-muted"}`}
          >
            {sumText(state.amount, t)}
          </span>
          <BalanceBadge balance={row.balance} t={t} />
        </div>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-adm-muted" />
      </Link>
    </li>
  );
}
