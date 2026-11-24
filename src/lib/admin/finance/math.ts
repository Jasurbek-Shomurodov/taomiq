/*
 * Finance formulas (docs/plans/finance-investor-payroll.md, "Formulas"). Pure functions of their arguments: no data
 * access, no clock, no server-only import, so pages never repeat money math and every figure can be checked without a
 * database. Amounts are whole UZS; percentages are plain numbers (12.5 means 12.5 %), null when there is nothing to
 * divide by. A null is shown as "—", never as 0.
 *
 * Investor money is never income: it is carried next to the figures, never inside them.
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

export function monthResult(row: Pick<MonthCashflow, "revenue" | "other_income" | "expenses" | "salaries">): MonthResult {
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

// ---------- small helpers ----------

/**
 * Whole-number change in percent: (now − before) / |before| × 100. Null when either is unknown or before is 0 (no
 * base to compare with). Against a negative base the sign still says better or worse: −100 → −50 is +50 %.
 */
export function changePct(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0 || !Number.isFinite(now) || !Number.isFinite(before)) {
    return null;
  }
  return Math.round(((now - before) / Math.abs(before)) * 100);
}

/** part / whole × 100, or null when whole is not above 0. */
export function sharePct(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** result / income × 100, or null with no income. */
export function marginPct(figures: MonthResult): number | null {
  return sharePct(figures.result, figures.income);
}

/** Days in the month of a "YYYY-MM-…" date. */
export function daysInMonth(day: string): number {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The days a month's averages are taken over: every day of a past month, the days up to and including today in the
 * current one, and in the launch month only the days from the first paid order on (the days before it had no sales to
 * average). `from` and `to` are the month's first and last day; `today` and `firstOrderDay` Tashkent "YYYY-MM-DD".
 */
export function daysCounted(from: string, to: string, today: string, firstOrderDay: string | null = null): number {
  if (today < from) return 0;
  const end = today > to ? to : today;
  const start = firstOrderDay && firstOrderDay > from && firstOrderDay <= end ? firstOrderDay : from;
  return Number(end.slice(8, 10)) - Number(start.slice(8, 10)) + 1;
}

/** The first day ("YYYY-MM-01") of the month holding a "YYYY-MM-DD" day, or null. */
function monthOf(day: string | null): string | null {
  return day ? `${day.slice(0, 7)}-01` : null;
}

// ---------- a period (public.finance_period) ----------

/** One of the period's largest expense entries. */
export type LargestPayment = {
  id: string;
  entry_date: string;
  category: string;
  payment_method: string;
  amount: number;
  counterparty: string | null;
  note: string | null;
};

export type InvestorTotal = { name: string; amount: number };

/** public.finance_period(p_from, p_to) as the pages use it (migration 0013). */
export type FinancePeriod = {
  revenue: number;
  order_count: number;
  byDay: { day: string; revenue: number; spent: number }[];
  /** Expense amount per category; categories with nothing are absent. */
  expenseByCategory: Record<string, number>;
  /** Income amount per category: investor_support and other_income. */
  incomeByCategory: Record<string, number>;
  investors: InvestorTotal[];
  largest: LargestPayment[];
  /** Salary payments of the period (payroll, migration 0014); also inside each day's `spent`. */
  salaries: number;
};

export type PeriodFigures = MonthResult & {
  revenue: number;
  order_count: number;
  other_income: number;
  investor_support: number;
  /** All expense entries (one-off salary entries included). */
  expenses: number;
  salaries: number;
  /** Expense entries of the salary_one_time category. */
  salary_one_time: number;
  /** Expense entries of the ingredients category. */
  ingredients: number;
};

export function periodFigures(period: FinancePeriod): PeriodFigures {
  const expenses = Object.values(period.expenseByCategory).reduce((sum, value) => sum + value, 0);
  const other_income = period.incomeByCategory.other_income ?? 0;
  const base = {
    revenue: period.revenue,
    order_count: period.order_count,
    other_income,
    investor_support: period.incomeByCategory.investor_support ?? 0,
    expenses,
    salaries: period.salaries,
    salary_one_time: period.expenseByCategory.salary_one_time ?? 0,
    ingredients: period.expenseByCategory.ingredients ?? 0,
  };
  return { ...base, ...monthResult(base) };
}

/** A period with no paid order and no record of any kind. */
export function isEmptyPeriod(figures: PeriodFigures): boolean {
  return (
    figures.order_count === 0 &&
    figures.revenue === 0 &&
    figures.other_income === 0 &&
    figures.investor_support === 0 &&
    figures.expenses === 0 &&
    figures.salaries === 0
  );
}

export type MonthIndicators = {
  /** revenue / days counted. */
  avgRevenuePerDay: number | null;
  /** revenue / paid orders. */
  avgCheck: number | null;
  /** ingredients spending / revenue × 100. */
  foodCostPct: number | null;
  /** (salary payments + one-off salary entries) / spent × 100. */
  payrollSharePct: number | null;
  /** investor money / (income + investor money) × 100. */
  investorDependencePct: number | null;
  /** How much spending was above income; 0 when income covered it. */
  shortfall: number;
  /** result / income × 100. */
  marginPct: number | null;
};

export function monthIndicators(figures: PeriodFigures, days: number): MonthIndicators {
  return {
    avgRevenuePerDay: days > 0 ? figures.revenue / days : null,
    avgCheck: figures.order_count > 0 ? figures.revenue / figures.order_count : null,
    foodCostPct: sharePct(figures.ingredients, figures.revenue),
    payrollSharePct: sharePct(figures.salaries + figures.salary_one_time, figures.spent),
    investorDependencePct: sharePct(figures.investor_support, figures.income + figures.investor_support),
    shortfall: Math.max(0, figures.spent - figures.income),
    marginPct: marginPct(figures),
  };
}

/** Expense categories largest first (ties by name), with their share of all expenses (0..1). */
export function categoryShares(byCategory: Record<string, number>): { category: string; amount: number; share: number }[] {
  const total = Object.values(byCategory).reduce((sum, value) => sum + value, 0);
  return Object.entries(byCategory)
    .filter(([, amount]) => amount > 0)
    .map(([category, amount]) => ({ category, amount, share: total > 0 ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

/** Investor totals from several periods added up per name (trimmed), largest first, ties by name. */
export function mergeInvestors(lists: readonly (readonly InvestorTotal[])[]): InvestorTotal[] {
  const byName = new Map<string, number>();
  for (const list of lists) {
    for (const { name, amount } of list) {
      const key = name.trim();
      byName.set(key, (byName.get(key) ?? 0) + amount);
    }
  }
  return [...byName]
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

// ---------- the year (public.finance_monthly_cashflow, finance_totals) ----------

/** public.finance_totals(): all time (migration 0013). */
export type FinanceTotals = {
  investor_support: number;
  revenue: number;
  other_income: number;
  expenses: number;
  salaries: number;
  /** Tashkent day of the first paid order, or null. */
  first_order_day: string | null;
  /** Date of the first investor money, or null. */
  first_investment_day: string | null;
};

export type YearMonth = MonthCashflow &
  MonthResult & {
    marginPct: number | null;
    /** The current month: still running, counted so far. */
    isCurrent: boolean;
  };

export type YearSummary = {
  /**
   * The months the statement shows, oldest first: from the first month with anything in it (months before the
   * business started are left out) to the current one. Empty when nothing happened in the whole window.
   */
  months: YearMonth[];
  totals: MonthResult & {
    revenue: number;
    order_count: number;
    other_income: number;
    investor_support: number;
    expenses: number;
    salaries: number;
    marginPct: number | null;
  };
  /** Completed months (the current one left out) shown in the statement. */
  completedMonths: number;
  /** Of those, the ones with a result above 0. */
  profitableMonths: number;
  /** The completed month with the highest and the lowest result; null without completed months. */
  best: YearMonth | null;
  worst: YearMonth | null;
};

/**
 * The year's statement from finance_monthly_cashflow rows (oldest first, the last one is the current month).
 * Totals are sums over every row; leading empty months only drop out of the list.
 */
export function yearSummary(rows: readonly MonthCashflow[], currentMonthStart: string): YearSummary {
  const all: YearMonth[] = rows.map((row) => {
    const figures = monthResult(row);
    return { ...row, ...figures, marginPct: marginPct(figures), isCurrent: row.month_start === currentMonthStart };
  });
  const first = all.findIndex((month) => !isEmptyMonth(month));
  const months = first === -1 ? [] : all.slice(first);

  const sum = (pick: (row: MonthCashflow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const base = {
    revenue: sum((r) => r.revenue),
    order_count: sum((r) => r.order_count),
    other_income: sum((r) => r.other_income),
    investor_support: sum((r) => r.investor_support),
    expenses: sum((r) => r.expenses),
    salaries: sum((r) => r.salaries),
  };
  const figures = monthResult(base);

  const completed = months.filter((month) => month.month_start < currentMonthStart);
  let best: YearMonth | null = null;
  let worst: YearMonth | null = null;
  for (const month of completed) {
    if (!best || month.result > best.result) best = month;
    if (!worst || month.result < worst.result) worst = month;
  }

  return {
    months,
    totals: { ...base, ...figures, marginPct: marginPct(figures) },
    completedMonths: completed.length,
    profitableMonths: completed.filter((month) => month.result > 0).length,
    best,
    worst,
  };
}

export type Payback = {
  /** All investor money ever recorded. */
  invested: number;
  /** All-time revenue + other income − expenses − salaries; may be below 0. */
  generated: number;
  /** What is still to come back: invested − generated (generated below 0 counts as 0), never below 0. */
  remaining: number;
  /** generated / invested × 100, between 0 and 100; null with nothing invested. */
  paidBackPct: number | null;
  /**
   * Average result of the last (up to) 3 completed months of operation (from the month of the first paid order on);
   * null without a first order or without such a month yet.
   */
  monthlyPace: number | null;
  /** How many months the pace is the average of (0..3). */
  paceMonths: number;
  /** Months to pay back at that pace: 0 when paid back, null when the pace is not above 0 (or unknown). */
  monthsLeft: number | null;
};

/**
 * Payback (zarkebab buildPaybackSummary). The pace is taken over completed months only (the current month is still
 * running) and only from the month of the first paid order (totals.first_order_day), so a setup month with investment
 * and equipment but no sales does not pull it down.
 */
export function payback(totals: FinanceTotals, rows: readonly MonthCashflow[], currentMonthStart: string): Payback {
  const invested = totals.investor_support;
  const generated = totals.revenue + totals.other_income - totals.expenses - totals.salaries;
  const earned = Math.max(0, generated);
  const remaining = Math.max(0, invested - earned);
  const paidBackPct = invested > 0 ? Math.min(100, (earned / invested) * 100) : null;

  const launch = monthOf(totals.first_order_day);
  const operating = launch
    ? rows.filter((row) => row.month_start >= launch && row.month_start < currentMonthStart)
    : [];
  const recent = operating.slice(-3);
  const monthlyPace =
    recent.length > 0 ? recent.reduce((total, row) => total + monthResult(row).result, 0) / recent.length : null;
  const monthsLeft =
    remaining === 0 ? 0 : monthlyPace !== null && monthlyPace > 0 ? Math.ceil(remaining / monthlyPace) : null;

  return { invested, generated, remaining, paidBackPct, monthlyPace, paceMonths: recent.length, monthsLeft };
}

export type Growth = {
  /** The latest completed month ("YYYY-MM-01"), or null when the window has none. */
  latest: string | null;
  /** Its average revenue per day open (calendar days; in the launch month, from the first order on). */
  latestPerDay: number | null;
  /** Revenue per day of the latest completed month against the month before it, whole percent. */
  vsPreviousPct: number | null;
  /** The month the latest is compared with three months back ("YYYY-MM-01"), or null. */
  threeBack: string | null;
  /** Revenue per day of the latest completed month against three months before it, whole percent. */
  vsThreeBackPct: number | null;
  /**
   * Average monthly growth of revenue per day, ((last / first)^(1 / months between) − 1) × 100, over the completed
   * full months of operation with revenue (the launch month is left out unless the first order came on the 1st);
   * null with fewer than two such months.
   */
  avgMonthlyPct: number | null;
  /** How many months the average is taken over. */
  avgMonths: number;
};

/**
 * Growth from finance_monthly_cashflow rows (oldest first, one row per calendar month, the last one the current
 * month) and the Tashkent day of the first paid order. Months are compared by revenue per day, so a 28-day February
 * is not a fall, and the launch month counts only the days from the first order on, so a few days of sales are not
 * read as a weak month. The average monthly growth starts at the first full month of operation (a launch month that
 * began after the 1st is too short a base) and spaces its root by the months between its first and last month,
 * which is n − 1 when no month in between had no revenue.
 */
export function growth(rows: readonly MonthCashflow[], currentMonthStart: string, firstOrderDay: string | null): Growth {
  const launch = monthOf(firstOrderDay);
  const perDay = (row: MonthCashflow) =>
    row.revenue /
    (row.month_start === launch && firstOrderDay
      ? daysInMonth(row.month_start) - Number(firstOrderDay.slice(8, 10)) + 1
      : daysInMonth(row.month_start));
  const partialLaunch = launch !== null && firstOrderDay !== null && !firstOrderDay.endsWith("-01");
  const completed = rows.filter((row) => row.month_start < currentMonthStart);
  const at = (back: number) => completed[completed.length - 1 - back] ?? null;
  const latest = at(0);
  const previous = at(1);
  const threeBack = at(3);

  const withRevenue = completed
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.revenue > 0 && !(partialLaunch && row.month_start === launch));
  let avgMonthlyPct: number | null = null;
  if (withRevenue.length >= 2) {
    const first = withRevenue[0];
    const last = withRevenue[withRevenue.length - 1];
    const span = last.index - first.index;
    avgMonthlyPct = (Math.pow(perDay(last.row) / perDay(first.row), 1 / span) - 1) * 100;
  }

  return {
    latest: latest?.month_start ?? null,
    latestPerDay: latest ? perDay(latest) : null,
    vsPreviousPct: latest && previous ? changePct(perDay(latest), perDay(previous)) : null,
    threeBack: threeBack?.month_start ?? null,
    vsThreeBackPct: latest && threeBack ? changePct(perDay(latest), perDay(threeBack)) : null,
    avgMonthlyPct,
    avgMonths: withRevenue.length,
  };
}

// ---------- payroll (public.finance_payroll, migration 0014) ----------

/**
 * One day's pay by a rate (zarkebab expenses.js): a daily rate is paid as is; a monthly rate m in a month of n days pays
 * floor(m / n) a day and one sum more on days 1 .. (m mod n), so a whole month adds up to exactly m. `day` is
 * "YYYY-MM-DD". The database does the accrual itself (private.finance_salary_days); this mirror is for what the
 * screens explain (how a monthly rate is spread over the days of a month).
 */
export function dayPay(amount: number, unit: "daily" | "monthly", day: string): number {
  if (unit === "daily") return amount;
  const days = daysInMonth(day);
  const base = Math.floor(amount / days);
  return Number(day.slice(8, 10)) <= amount % days ? base + 1 : base;
}

/** How a monthly rate is spread over a month of `days` days: `extra` days of base + 1, then base. */
export function monthlySpread(amount: number, days: number): { base: number; extra: number } {
  return { base: Math.floor(amount / days), extra: amount % days };
}

/** One person as public.finance_payroll(p_as_of) returns them. Whole UZS. */
export type PayrollRow = {
  employee_id: string;
  name: string;
  job_title: string | null;
  joined_at: string;
  ended_at: string | null;
  is_active: boolean;
  /** The rate in force on the day asked for; null before the first one starts. */
  rate_amount: number | null;
  rate_unit: "daily" | "monthly" | null;
  rate_from: string | null;
  /** The start of the earliest rate; null without any. */
  first_rate_from: string | null;
  /** Pay earned from the first day to the day asked for (absences earn nothing). */
  accrued: number;
  bonuses: number;
  fines: number;
  paid: number;
  /** accrued + bonuses − fines − paid: above 0 owed to the person, below 0 an advance. */
  balance: number;
  /** The pay of the whole calendar month of the day asked for. */
  month_pay: number;
  /** Payments from the 1st of that month to the day asked for. */
  paid_month: number;
};

/**
 * The days of employment no rate covers, because the earliest rate starts after the first working day (a deleted or
 * late first rate): from joined_at to the day before that rate, cut at the last working day. Null when the first day
 * is covered, or when there is no rate at all (the page says that on its own).
 */
export function rateGap(
  row: Pick<PayrollRow, "joined_at" | "ended_at" | "first_rate_from">,
): { from: string; to: string } | null {
  if (!row.first_rate_from || row.first_rate_from <= row.joined_at) return null;
  const [y, m, d] = row.first_rate_from.split("-").map(Number);
  const before = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  const to = row.ended_at && row.ended_at < before ? row.ended_at : before;
  return { from: row.joined_at, to };
}

/** What a balance means: owed to the person (due), paid ahead (advance), or settled. */
export function balanceState(balance: number): { kind: "due" | "advance" | "settled"; amount: number } {
  if (balance > 0) return { kind: "due", amount: balance };
  if (balance < 0) return { kind: "advance", amount: -balance };
  return { kind: "settled", amount: 0 };
}

export type PayrollSummary = {
  /** Everything owed now: the sum of the positive balances (an advance never offsets someone else's due). */
  due: number;
  /** Paid ahead: the sum of the negative balances, as a positive number. */
  advance: number;
  /** The whole current month's pay by the rates in force (the month's salary commitment). */
  monthPay: number;
  /** Salary payments this month so far. */
  paidMonth: number;
  /** People still working. */
  active: number;
};

export function payrollSummary(rows: readonly PayrollRow[]): PayrollSummary {
  let due = 0;
  let advance = 0;
  let monthPay = 0;
  let paidMonth = 0;
  let active = 0;
  for (const row of rows) {
    if (row.balance > 0) due += row.balance;
    else advance -= row.balance;
    monthPay += row.month_pay;
    paidMonth += row.paid_month;
    if (row.is_active) active += 1;
  }
  return { due, advance, monthPay, paidMonth, active };
}

// ---------- the running month's estimate (slice 4, zarkebab monthly estimate) ----------

export type EstimateInput = {
  /** Revenue from the 1st to today. */
  revenueSoFar: number;
  /** Other income from the 1st to today. */
  otherIncomeSoFar: number;
  /** Ledger expenses plus salary payments from the 1st to today (the Month page's "spent"). */
  spentSoFar: number;
  /** Salary payments from the 1st to today (inside spentSoFar). */
  salaryPaidSoFar: number;
  /** The whole month's pay of every employee by the rates in force (finance_payroll month_pay, summed). */
  salaryCommitment: number;
  /** The month's rent plan (setting finance_monthly_rent); null when not set. */
  rentPlan: number | null;
  /** Rent recorded this month (ledger expenses of the rent category). */
  rentRecorded: number;
  /** The days the average is taken over (the Month page's days counted: the 1st, or the first order's day, to today). */
  daysCounted: number;
  /** Days of the month after today; 0 on the last day. */
  remainingDays: number;
  /** Estimated tax rate in percent (setting finance_tax_rate_pct); null when not set. */
  taxRatePct: number | null;
};

export type MonthEstimate = {
  /** revenueSoFar / daysCounted; null with no day counted. */
  avgDaily: number | null;
  /** revenueSoFar + avgDaily × remainingDays (the revenue so far when the average is unknown). */
  projectedRevenue: number;
  /** Rent still to pay: max(0, rent plan − rent recorded); 0 without a plan. */
  rentLeft: number;
  /**
   * What the month is expected to spend: spent so far − salary paid so far + the whole month's salary commitment +
   * the rent still to pay. Salary payments are replaced by the month's pay, so no salary is counted twice.
   */
  expectedOut: number;
  /** projectedRevenue + other income so far − expectedOut. */
  projectedResult: number;
  /**
   * Revenue a day needs from tomorrow on for income to cover expectedOut: ceil(max(0, expectedOut − income so far) /
   * remainingDays). Null on the last day of the month (no day left).
   */
  requiredDaily: number | null;
  /** projectedRevenue × tax rate / 100; null without a rate. Informational: never subtracted from a result. */
  estimatedTax: number | null;
};

/**
 * The running month's estimate (docs/plans/finance-investor-payroll.md, slice 4): where the month ends at today's
 * pace, and what a day must bring in for income to cover the month's expected spending.
 */
export function monthEstimate(input: EstimateInput): MonthEstimate {
  const avgDaily = input.daysCounted > 0 ? input.revenueSoFar / input.daysCounted : null;
  const remaining = Math.max(0, input.remainingDays);
  const projectedRevenue = input.revenueSoFar + (avgDaily ?? 0) * remaining;
  const rentLeft = input.rentPlan !== null ? Math.max(0, input.rentPlan - input.rentRecorded) : 0;
  const expectedOut = input.spentSoFar - input.salaryPaidSoFar + input.salaryCommitment + rentLeft;
  const incomeSoFar = input.revenueSoFar + input.otherIncomeSoFar;
  const projectedResult = projectedRevenue + input.otherIncomeSoFar - expectedOut;
  const requiredDaily = remaining > 0 ? Math.ceil(Math.max(0, expectedOut - incomeSoFar) / remaining) : null;
  const estimatedTax = input.taxRatePct !== null ? (projectedRevenue * input.taxRatePct) / 100 : null;
  return { avgDaily, projectedRevenue, rentLeft, expectedOut, projectedResult, requiredDaily, estimatedTax };
}

/** Days of the month after `today` ("YYYY-MM-DD"): 0 on the last day. */
export function remainingDays(today: string): number {
  return daysInMonth(today) - Number(today.slice(8, 10));
}

/** Average revenue per day against the break-even target, in percent; null without either. */
export function breakEvenCoverage(avgDaily: number | null, target: number | null): number | null {
  return avgDaily !== null && target !== null && target > 0 ? (avgDaily / target) * 100 : null;
}

// ---------- month close (public.finance_close_overview, migration 0015) ----------

/** One person's salary earned in a month: accrued pay + bonuses − fines. */
export type SalaryShare = {
  employee_id: string;
  name: string;
  /** Days with pay. */
  days: number;
  accrued: number;
  bonuses: number;
  fines: number;
  earned: number;
};

/** A month's figures by the close rule: salary counted as earned, not as paid. */
export type CloseFigures = {
  revenue: number;
  order_count: number;
  other_income: number;
  investor_support: number;
  /** Ledger expenses only (salary payments are not in here). */
  expenses: number;
  salary_earned: number;
  salary_breakdown: SalaryShare[];
  /** revenue + other_income − expenses − salary_earned. */
  result: number;
};

export type FrozenClose = CloseFigures & {
  /** "YYYY-MM-01". */
  month_start: string;
  closed_at: string;
  closed_by_name: string | null;
};

export type CloseStatus = "closed" | "ready" | "waiting" | "current";

export type CloseMonth = {
  /** "YYYY-MM-01". */
  month_start: string;
  status: CloseStatus;
  /** Counted now; the running month up to today. */
  live: CloseFigures;
  closed: FrozenClose | null;
  /** live.result − closed.result for a closed month (an order of it was cancelled since, say); null otherwise. */
  drift: number | null;
};

export type CloseLogEntry = {
  month_start: string;
  action: "closed" | "reopened";
  reason: string | null;
  result: number;
  actor_name: string | null;
  at: string;
};

export type CloseOverview = {
  /** Oldest first. */
  months: CloseMonth[];
  /** "YYYY-MM-01" of the month to close next, or null when none can be closed now. */
  nextToClose: string | null;
  /** Newest first. */
  log: CloseLogEntry[];
};

/** Revenue plus other income: what the official result's margin is taken of. */
export function closeIncome(figures: Pick<CloseFigures, "revenue" | "other_income">): number {
  return figures.revenue + figures.other_income;
}

/** result / (revenue + other income) × 100, or null with no income. */
export function closeMarginPct(figures: Pick<CloseFigures, "revenue" | "other_income" | "result">): number | null {
  return sharePct(figures.result, closeIncome(figures));
}

export type ClosedSummary = {
  /** Closed months. */
  count: number;
  /** Sum of their frozen results. */
  total: number;
  /** total / count; null without a closed month. */
  average: number | null;
  /** The highest and the lowest frozen result (the earlier month on a tie); null without a closed month. */
  best: FrozenClose | null;
  worst: FrozenClose | null;
};

/** The frozen results added up. `closes` oldest first. */
export function closedSummary(closes: readonly FrozenClose[]): ClosedSummary {
  let total = 0;
  let best: FrozenClose | null = null;
  let worst: FrozenClose | null = null;
  for (const close of closes) {
    total += close.result;
    if (!best || close.result > best.result) best = close;
    if (!worst || close.result < worst.result) worst = close;
  }
  return { count: closes.length, total, average: closes.length > 0 ? total / closes.length : null, best, worst };
}
