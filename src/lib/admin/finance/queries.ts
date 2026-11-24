import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCapped } from "../stats";
import { rowKind, type EntryKind } from "./categories";
import type { MonthCashflow } from "./math";
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
