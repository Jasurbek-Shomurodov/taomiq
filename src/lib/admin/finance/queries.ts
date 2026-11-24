import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, readCapped } from "../stats";
import { rowKind, type EntryKind } from "./categories";
import {
  mergeInvestors,
  type FinancePeriod,
  type FinanceTotals,
  type InvestorTotal,
  type MonthCashflow,
  type PayrollRow,
} from "./math";
import type { FinanceMonth } from "./month";
import { isSalaryEventKind, type SalaryEventKind } from "./payroll";

/*
 * Finance loaders (migrations 0013 and 0014). Each takes the signed-in owner's session client (never the secret client) and
 * throws on a failed read, so the page decides what to show. RLS and the functions' own check return nothing to anyone
 * but the owner.
 */

/** Whole UZS from a bigint column or a JSON number; 0 for anything that is not a finite number. */
function money(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** The last `months` Tashkent months (1..36, the current one included), oldest first. */
export async function loadMonthlyCashflow(supabase: SupabaseClient, months: number): Promise<MonthCashflow[]> {
  const { data, error } = await supabase.rpc("finance_monthly_cashflow", { p_months: months });
  if (error) throw new Error(`finance_monthly_cashflow: ${error.code} ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    month_start: String(row.month_start),
    revenue: money(row.revenue),
    order_count: money(row.order_count),
    investor_support: money(row.investor_support),
    other_income: money(row.other_income),
    expenses: money(row.expenses),
    salaries: money(row.salaries),
  }));
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function amounts(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(record(value)).map(([key, amount]) => [key, money(amount)]));
}

/**
 * Everything the Month screen shows for a range of Tashkent days, both ends included (at most 366 days):
 * public.finance_period. `salaries` is the period's salary payments (migration 0014); each day's `spent` holds them
 * too.
 */
export async function loadPeriod(supabase: SupabaseClient, from: string, to: string): Promise<FinancePeriod> {
  const { data, error } = await supabase.rpc("finance_period", { p_from: from, p_to: to });
  if (error) throw new Error(`finance_period: ${error.code} ${error.message}`);
  const body = record(data);
  return {
    revenue: money(body.revenue),
    order_count: money(body.order_count),
    byDay: list(body.by_day).map((day) => ({
      day: String(day.day),
      revenue: money(day.revenue),
      spent: money(day.spent),
    })),
    expenseByCategory: amounts(body.expense_by_category),
    incomeByCategory: amounts(body.income_by_category),
    investors: list(body.investors).map((investor) => ({
      name: text(investor.name) ?? "",
      amount: money(investor.amount),
    })),
    largest: list(body.largest).map((entry) => ({
      id: String(entry.id),
      entry_date: String(entry.entry_date),
      category: String(entry.category),
      payment_method: String(entry.payment_method),
      amount: money(entry.amount),
      counterparty: text(entry.counterparty),
      note: text(entry.note),
    })),
    salaries: money(body.salaries),
  };
}

/** All-time sums for the investor view: public.finance_totals(). */
export async function loadTotals(supabase: SupabaseClient): Promise<FinanceTotals> {
  const { data, error } = await supabase.rpc("finance_totals");
  if (error) throw new Error(`finance_totals: ${error.code} ${error.message}`);
  const row = record(Array.isArray(data) ? data[0] : data);
  return {
    investor_support: money(row.investor_support),
    revenue: money(row.revenue),
    other_income: money(row.other_income),
    expenses: money(row.expenses),
    salaries: money(row.salaries),
    first_order_day: text(row.first_order_day),
    first_investment_day: text(row.first_investment_day),
  };
}

/** The longest range public.finance_period accepts, in days (p_to − p_from <= 365). */
const PERIOD_MAX_DAYS = 366;

/**
 * Investor money per name from `from` to `to` (both included), added up over as many finance_period calls as the
 * range needs (366 days each, read in parallel), so the sums stay in SQL and no row cap applies.
 */
export async function loadInvestorTotals(supabase: SupabaseClient, from: string, to: string): Promise<InvestorTotal[]> {
  const ranges: { from: string; to: string }[] = [];
  for (let start = from; start <= to; start = addDays(start, PERIOD_MAX_DAYS)) {
    const end = addDays(start, PERIOD_MAX_DAYS - 1);
    ranges.push({ from: start, to: end < to ? end : to });
  }
  const periods = await Promise.all(ranges.map((range) => loadPeriod(supabase, range.from, range.to)));
  return mergeInvestors(periods.map((period) => period.investors));
}

export type FinanceEntry = {
  id: string;
  entry_type: string;
  entry_date: string;
  category: string;
  payment_method: string;
  amount: number;
  counterparty: string | null;
  note: string | null;
  created_at: string;
  /** Null for a type / category pairing this build does not know (the table's check allows none). */
  kind: EntryKind | null;
};

const ENTRY_COLUMNS = "id, entry_type, entry_date, category, payment_method, amount, counterparty, note, created_at";

/** The most records the history reads for one month; past it the page says the list is cut. */
export const ENTRIES_CAP = 5000;

/**
 * Every record of a month (optionally of one kind), newest day first and, within a day, newest first. Read page by
 * page through range(), with `id` breaking ties so pages neither repeat nor skip a row.
 */
export async function listMonthEntries(
  supabase: SupabaseClient,
  month: FinanceMonth,
  kind: EntryKind | null,
): Promise<{ entries: FinanceEntry[]; partial: boolean }> {
  const page = async (from: number, to: number): Promise<FinanceEntry[]> => {
    let query = supabase
      .from("finance_entries")
      .select(ENTRY_COLUMNS)
      .gte("entry_date", month.from)
      .lte("entry_date", month.to)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (kind === "expense") query = query.eq("entry_type", "expense");
    if (kind === "investor") query = query.eq("entry_type", "income").eq("category", "investor_support");
    if (kind === "other_income") query = query.eq("entry_type", "income").eq("category", "other_income");
    const { data, error } = await query;
    if (error) {
      if (error.code === "PGRST103") return [];
      throw new Error(`finance_entries: ${error.code} ${error.message}`);
    }
    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      entry_type: String(row.entry_type),
      entry_date: String(row.entry_date),
      category: String(row.category),
      payment_method: String(row.payment_method),
      amount: money(row.amount),
      counterparty: typeof row.counterparty === "string" ? row.counterparty : null,
      note: typeof row.note === "string" ? row.note : null,
      created_at: String(row.created_at),
      kind: rowKind(String(row.entry_type), String(row.category)),
    }));
  };
  const { rows, partial } = await readCapped(page, ENTRIES_CAP);
  return { entries: rows, partial };
}

// ---------- payroll (migration 0014) ----------

function rateUnit(value: unknown): "daily" | "monthly" | null {
  return value === "daily" || value === "monthly" ? value : null;
}

/** Every person on the payroll as of a Tashkent day (active first, then by name): public.finance_payroll. */
export async function loadPayroll(supabase: SupabaseClient, asOf: string): Promise<PayrollRow[]> {
  const { data, error } = await supabase.rpc("finance_payroll", { p_as_of: asOf });
  if (error) throw new Error(`finance_payroll: ${error.code} ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    employee_id: String(row.employee_id),
    name: text(row.name) ?? "",
    job_title: text(row.job_title),
    joined_at: String(row.joined_at),
    ended_at: text(row.ended_at),
    is_active: row.is_active === true,
    rate_amount: row.rate_amount === null || row.rate_amount === undefined ? null : money(row.rate_amount),
    rate_unit: rateUnit(row.rate_unit),
    rate_from: text(row.rate_from),
    first_rate_from: text(row.first_rate_from),
    accrued: money(row.accrued),
    bonuses: money(row.bonuses),
    fines: money(row.fines),
    paid: money(row.paid),
    balance: money(row.balance),
    month_pay: money(row.month_pay),
    paid_month: money(row.paid_month),
  }));
}

export type SalaryRate = {
  id: string;
  effective_from: string;
  amount: number;
  rate_unit: "daily" | "monthly";
  note: string | null;
};

export type SalaryEvent = {
  id: string;
  kind: SalaryEventKind;
  event_date: string;
  /** Null for an absence. */
  amount: number | null;
  payment_method: string | null;
  note: string | null;
  created_at: string;
};

/** The most events the history reads for one person; past it the page says the list is cut. */
export const EVENTS_CAP = 5000;

/**
 * One person's rates (newest start first) and events (newest day first, within a day newest first), read through RLS.
 * Events are read page by page through range(), with `id` breaking ties.
 */
export async function loadEmployeeHistory(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<{ rates: SalaryRate[]; events: SalaryEvent[]; partial: boolean }> {
  const ratesRead = supabase
    .from("finance_salary_rates")
    .select("id, effective_from, amount, rate_unit, note")
    .eq("employee_id", employeeId)
    .order("effective_from", { ascending: false });

  const page = async (from: number, to: number): Promise<SalaryEvent[]> => {
    const { data, error } = await supabase
      .from("finance_salary_events")
      .select("id, kind, event_date, amount, payment_method, note, created_at")
      .eq("employee_id", employeeId)
      .order("event_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      if (error.code === "PGRST103") return [];
      throw new Error(`finance_salary_events: ${error.code} ${error.message}`);
    }
    return ((data ?? []) as Record<string, unknown>[]).flatMap((row) =>
      isSalaryEventKind(row.kind)
        ? [
            {
              id: String(row.id),
              kind: row.kind,
              event_date: String(row.event_date),
              amount: row.amount === null || row.amount === undefined ? null : money(row.amount),
              payment_method: text(row.payment_method),
              note: text(row.note),
              created_at: String(row.created_at),
            },
          ]
        : [],
    );
  };

  const [rates, events] = await Promise.all([ratesRead, readCapped(page, EVENTS_CAP)]);
  if (rates.error) throw new Error(`finance_salary_rates: ${rates.error.code} ${rates.error.message}`);
  return {
    rates: ((rates.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
      const unit = rateUnit(row.rate_unit);
      return unit
        ? [
            {
              id: String(row.id),
              effective_from: String(row.effective_from),
              amount: money(row.amount),
              rate_unit: unit,
              note: text(row.note),
            },
          ]
        : [];
    }),
    events: events.rows,
    partial: events.partial,
  };
}
