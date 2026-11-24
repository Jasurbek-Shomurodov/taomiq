/*
 * Finance formulas (docs/plans/finance-investor-payroll.md, "Formulas"). Pure functions, no data access, so pages
 * never repeat money math. Slice 1 needs only a month's headline; the indicators, payback and growth come with the
 * Month and Year screens (slice 2).
 */

/** One month as public.finance_monthly_cashflow returns it (migration 0013). Whole UZS. */
export type MonthCashflow = {
  /** "YYYY-MM-01". */
  month_start: string;
  revenue: number;
  order_count: number;
  investor_support: number;
  other_income: number;
  expenses: number;
  salaries: number;
};

export type MonthResult = {
  /** Revenue plus other income. Investor money is never income. */
  income: number;
  /** Expenses plus salary payments. */
  spent: number;
  /** income − spent. */
  result: number;
};

export function monthResult(row: MonthCashflow): MonthResult {
  const income = row.revenue + row.other_income;
  const spent = row.expenses + row.salaries;
  return { income, spent, result: income - spent };
}

/** A month with no paid order and no record of any kind. */
export function isEmptyMonth(row: MonthCashflow): boolean {
  return (
    row.order_count === 0 &&
    row.revenue === 0 &&
    row.investor_support === 0 &&
    row.other_income === 0 &&
    row.expenses === 0 &&
    row.salaries === 0
  );
}
