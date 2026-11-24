import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, readCapped } from "../stats";
import { rowKind, type EntryKind } from "./categories";
import {
  mergeInvestors,
  type CloseFigures,
  type CloseLogEntry,
  type CloseMonth,
  type CloseOverview,
  type CloseStatus,
  type FinancePeriod,
  type FinanceTotals,
  type FrozenClose,
  type InvestorTotal,
  type MonthCashflow,
  type PayrollRow,
  type SalaryShare,
} from "./math";
import type { FinanceMonth } from "./month";
import { isSalaryEventKind, type SalaryEventKind } from "./payroll";
import { FINANCE_SETTING_KEYS, parseFinanceSettings, type FinanceSettings } from "./settings";

/*
 * Finance loaders (migrations 0013, 0014 and 0015). Each takes the signed-in owner's session client (never the secret client) and
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

// ---------- month close and settings (migration 0015) ----------

function salaryShares(value: unknown): SalaryShare[] {
  return list(value).map((row) => ({
    employee_id: String(row.employee_id ?? ""),
    name: text(row.name) ?? "",
    days: money(row.days),
    accrued: money(row.accrued),
    bonuses: money(row.bonuses),
    fines: money(row.fines),
    earned: money(row.earned),
  }));
}

function closeFigures(value: unknown): CloseFigures {
  const row = record(value);
  return {
    revenue: money(row.revenue),
    order_count: money(row.order_count),
    other_income: money(row.other_income),
    investor_support: money(row.investor_support),
    expenses: money(row.expenses),
    salary_earned: money(row.salary_earned),
    salary_breakdown: salaryShares(row.salary_breakdown),
    result: money(row.result),
  };
}

function frozenClose(value: unknown): FrozenClose {
  const row = record(value);
  return {
    ...closeFigures(row),
    month_start: String(row.month_start),
    closed_at: String(row.closed_at),
    closed_by_name: text(row.closed_by_name),
  };
}

const CLOSE_STATUSES: readonly CloseStatus[] = ["closed", "ready", "waiting", "current"];

/**
 * Every month from the first one with activity to the running one (at most 60), each counted now by the close rule and,
 * once closed, with its frozen figures and the drift between the two; the month to close next; the latest log rows.
 * public.finance_close_overview().
 */
export async function loadCloseOverview(supabase: SupabaseClient): Promise<CloseOverview> {
  const { data, error } = await supabase.rpc("finance_close_overview");
  if (error) throw new Error(`finance_close_overview: ${error.code} ${error.message}`);
  const body = record(data);
  const months: CloseMonth[] = list(body.months).map((row) => {
    const status = CLOSE_STATUSES.find((value) => value === row.status) ?? "waiting";
    const closed = row.closed && typeof row.closed === "object" ? frozenClose(row.closed) : null;
    return {
      month_start: String(row.month_start),
      status: closed ? "closed" : status,
      live: closeFigures(row.live),
      closed,
      drift: closed && row.drift !== null && row.drift !== undefined ? money(row.drift) : null,
    };
  });
  const log: CloseLogEntry[] = list(body.log).map((row) => ({
    month_start: String(row.month_start),
    action: row.action === "reopened" ? "reopened" : "closed",
    reason: text(row.reason),
    result: money(row.result),
    actor_name: text(row.actor_name),
    at: String(row.at),
  }));
  return { months, nextToClose: text(body.next_to_close), log };
}

const CLOSE_COLUMNS =
  "month_start, revenue, order_count, other_income, investor_support, expenses, salary_earned, salary_breakdown, result, closed_at, closed_by_name";

/** Every closed month, oldest first, with its frozen figures (RLS: the owner only). At most 120 rows. */
export async function loadClosedMonths(supabase: SupabaseClient): Promise<FrozenClose[]> {
  const { data, error } = await supabase
    .from("finance_month_closes")
    .select(CLOSE_COLUMNS)
    .order("month_start", { ascending: false })
    .limit(120);
  if (error) throw new Error(`finance_month_closes: ${error.code} ${error.message}`);
  return ((data ?? []) as unknown[]).map(frozenClose).reverse();
}

/** Bonuses and fines dated in one month ("YYYY-MM-01"): public.finance_month_salary_events. */
export async function loadMonthSalaryEvents(
  supabase: SupabaseClient,
  monthStart: string,
): Promise<{ bonuses: number; fines: number }> {
  const { data, error } = await supabase.rpc("finance_month_salary_events", { p_month_start: monthStart });
  if (error) throw new Error(`finance_month_salary_events: ${error.code} ${error.message}`);
  const row = record(Array.isArray(data) ? data[0] : data);
  return { bonuses: money(row.bonuses), fines: money(row.fines) };
}

/** The frozen close of one month ("YYYY-MM-01"), or null while it is open (RLS: the owner only). */
export async function loadMonthClose(supabase: SupabaseClient, monthStart: string): Promise<FrozenClose | null> {
  const { data, error } = await supabase
    .from("finance_month_closes")
    .select(CLOSE_COLUMNS)
    .eq("month_start", monthStart)
    .maybeSingle();
  if (error) throw new Error(`finance_month_closes: ${error.code} ${error.message}`);
  return data ? frozenClose(data) : null;
}

/** The last day of the latest closed month ("YYYY-MM-DD"): every day up to it is locked. Null when none is closed. */
export async function loadLockedThrough(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("finance_month_closes")
    .select("month_start")
    .order("month_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`finance_month_closes: ${error.code} ${error.message}`);
  if (!data) return null;
  const [y, m] = String(data.month_start).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Rent plan, break-even target and tax rate (public.settings, finance_* rows: the owner only). */
export async function loadFinanceSettings(supabase: SupabaseClient): Promise<FinanceSettings> {
  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", Object.values(FINANCE_SETTING_KEYS));
  if (error) throw new Error(`settings: ${error.code} ${error.message}`);
  return parseFinanceSettings((data ?? []) as { key: unknown; value: unknown }[]);
}
