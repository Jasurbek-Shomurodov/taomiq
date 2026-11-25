import type { ExpenseCategory } from "./categories";
import { sharePct, type FinancePeriod } from "./math";

/*
 * Finance analysis, round two (docs/plans/zarkebab-feature-port.md, slice 8; migration 0024). Pure functions of what
 * the SQL functions return: no data access, no clock, not server-only. Amounts are whole UZS; percentages are plain
 * numbers (12.5 means 12.5 %), null when there is nothing to divide by, shown as "—".
 *
 * The cash rule of every figure here (as on the Month and Year screens): revenue is paid orders by their payment day;
 * spending is ledger expenses plus salary payments on their day. Salary earned but not yet paid is not spending here.
 */

/** A range's cash sums: private.finance_cash_sums (0024). */
export type CashSums = {
  revenue: number;
  order_count: number;
  other_income: number;
  investor_support: number;
  expenses: number;
  salaries: number;
};

/** public.finance_indicators(month): the month's sums and the sums of everything up to its last counted day. */
export type IndicatorsData = {
  month_start: string;
  /** The month's last day, or today for the running month. */
  through: string;
  /** Days from the 1st to `through`, both included. */
  days: number;
  month: CashSums;
  balance: CashSums;
};

/**
 * The month's cash figures. There is no savings rate here: by the finance rule (investor money is never income) it
 * would be (income − spent) ÷ income over the same days, which is exactly the Margin tile of the Month screen.
 */
export type CashIndicators = {
  /** Expenses + salary payments of the month (to today for the running month). */
  spent: number;
  /** spent / days, unrounded (a display rounds it); null with no day counted. */
  dailyBurn: number | null;
  /** All revenue, other income and investor money − all expenses and salary payments, up to `through`. */
  balance: number;
  /** Whole days the balance lasts at the daily burn: floor(balance / burn), 0 when the balance is not above 0; null
   * when nothing was spent. Taken from the unrounded burn, so a tiny burn never reads as none. */
  runwayDays: number | null;
};

/** Everything that came in (investor money included: it is cash in the till, though never income). */
export function moneyIn(sums: CashSums): number {
  return sums.revenue + sums.other_income + sums.investor_support;
}

export function cashSpent(sums: CashSums): number {
  return sums.expenses + sums.salaries;
}

export function cashIndicators(data: IndicatorsData): CashIndicators {
  const spent = cashSpent(data.month);
  const dailyBurn = data.days > 0 ? spent / data.days : null;
  const balance = moneyIn(data.balance) - cashSpent(data.balance);
  const runwayDays =
    dailyBurn === null || dailyBurn <= 0 ? null : balance <= 0 ? 0 : Math.floor(balance / dailyBurn);
  return { spent, dailyBurn, balance, runwayDays };
}

// ---------- by payment method (public.finance_method_flow) ----------

export const FLOW_METHODS = ["cash", "card", "transfer", "unknown"] as const;
export type FlowMethod = (typeof FLOW_METHODS)[number];

export function isFlowMethod(value: unknown): value is FlowMethod {
  return typeof value === "string" && (FLOW_METHODS as readonly string[]).includes(value);
}

export type MethodFlowRow = {
  method: FlowMethod;
  order_count: number;
  /** Paid orders' revenue. */
  orders: number;
  other_income: number;
  investor_support: number;
  expenses: number;
  salaries: number;
  /** Estimated bank fee on the orders (never in the ledger). */
  fee: number;
  /** Orders paid on a day with no rate in force for their method yet, and their revenue. */
  unrated_count: number;
  unrated_orders: number;
};

export type MethodFlow = { methods: MethodFlowRow[]; fee_total: number };

/** In = orders + other income + investor money; out = expenses + salary payments; net = in − out. */
export function methodTotals(row: MethodFlowRow): { in: number; out: number; net: number } {
  const moneyInRow = row.orders + row.other_income + row.investor_support;
  const out = row.expenses + row.salaries;
  return { in: moneyInRow, out, net: moneyInRow - out };
}

/** Whether a range moved any money at all (a panel with nothing shows its empty state). */
export function isEmptyFlow(flow: MethodFlow): boolean {
  return flow.methods.every((row) => {
    const totals = methodTotals(row);
    return totals.in === 0 && totals.out === 0 && row.order_count === 0;
  });
}

// ---------- records (public.finance_records) ----------

export type FinanceRecords = {
  current_month: string;
  months: number;
  best_month: { month_start: string; revenue: number; order_count: number } | null;
  best_result_month: { month_start: string; result: number } | null;
  best_day: { day: string; revenue: number; order_count: number } | null;
  best_ten_days: { from: string; to: string; revenue: number; order_count: number } | null;
  longest_run: { months: number; from: string; to: string } | null;
  current_run: number;
  current: { revenue: number; order_count: number };
};

/** The running month's revenue as a share of the best finished month's, or null without a record. */
export function recordSharePct(records: FinanceRecords): number | null {
  return records.best_month ? sharePct(records.current.revenue, records.best_month.revenue) : null;
}

// ---------- money flow (the Sankey on Year) ----------

/** Where money came from. `reserves` is the part of spending that the period's money in did not cover. */
export type FlowSource = "orders" | "other_income" | "investor" | "reserves";
/** Where it went: spending groups, and what was left over. */
export type FlowUse = "food" | "team" | "premises" | "delivery" | "marketing" | "other" | "left";

/** Expense categories by spending group; salary payments go to `team` too. Every category is in exactly one group. */
export const SPENDING_GROUPS: Record<Exclude<FlowUse, "left">, readonly ExpenseCategory[]> = {
  food: ["ingredients"],
  team: ["salary_one_time"],
  premises: ["rent", "utilities", "repair"],
  delivery: ["delivery", "packaging"],
  marketing: ["marketing"],
  other: ["equipment", "tax", "payment_fees", "software", "investment", "other"],
};

export type MoneyFlow = {
  /** Largest first, only those above 0. */
  sources: { key: FlowSource; amount: number }[];
  /** Spending groups largest first, then `left` when above 0. */
  uses: { key: FlowUse; amount: number }[];
  /** The two sides' common total: money in + reserves = spending + left. */
  total: number;
};

/**
 * The period's money as a flow: orders, other income and investor money in; spending by group and what was left out.
 * When spending was above money in, the gap is drawn as `reserves` coming in (money from before the period), so both
 * sides always add up to the same total. A category this build does not know goes to `other`.
 */
export function moneyFlow(period: FinancePeriod): MoneyFlow {
  const sourceAmounts: Record<Exclude<FlowSource, "reserves">, number> = {
    orders: period.revenue,
    other_income: period.incomeByCategory.other_income ?? 0,
    investor: period.incomeByCategory.investor_support ?? 0,
  };
  const groups: Record<Exclude<FlowUse, "left">, number> = {
    food: 0,
    team: period.salaries,
    premises: 0,
    delivery: 0,
    marketing: 0,
    other: 0,
  };
  for (const [category, amount] of Object.entries(period.expenseByCategory)) {
    const group =
      (Object.keys(SPENDING_GROUPS) as Exclude<FlowUse, "left">[]).find((key) =>
        (SPENDING_GROUPS[key] as readonly string[]).includes(category),
      ) ?? "other";
    groups[group] += amount;
  }

  const totalIn = Object.values(sourceAmounts).reduce((sum, value) => sum + value, 0);
  const totalOut = Object.values(groups).reduce((sum, value) => sum + value, 0);
  const sources: MoneyFlow["sources"] = (Object.entries(sourceAmounts) as [FlowSource, number][])
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => ({ key, amount }))
    .sort((a, b) => b.amount - a.amount);
  if (totalOut > totalIn) sources.push({ key: "reserves", amount: totalOut - totalIn });
  const uses: MoneyFlow["uses"] = (Object.entries(groups) as [FlowUse, number][])
    .filter(([, amount]) => amount > 0)
    .map(([key, amount]) => ({ key, amount }))
    .sort((a, b) => b.amount - a.amount);
  if (totalIn > totalOut) uses.push({ key: "left", amount: totalIn - totalOut });
  return { sources, uses, total: Math.max(totalIn, totalOut) };
}
