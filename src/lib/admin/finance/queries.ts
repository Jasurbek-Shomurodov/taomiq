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
} from "./math";
import type { FinanceMonth } from "./month";

/*
 * Finance loaders (migration 0013). Each takes the signed-in owner's session client (never the secret client) and
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
 * public.finance_period. `salaries` is read when the function returns it (the payroll migration, slice 3) and is 0
 * until then.
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
