import { foldSearchText } from "../dish-status";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./categories";

/*
 * Finance → Records → All history (docs/plans/zarkebab-feature-port.md, slice 8; migration 0024,
 * public.finance_history): every ledger record and salary payment, newest first, with search, a kind filter and
 * "older" paging by a cursor. Pure and not server-only.
 */

/** The kinds of row: the ledger's three (categories.ts) and salary payments from payroll. */
export const HISTORY_KINDS = ["expense", "investor", "other_income", "salary"] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export function isHistoryKind(value: unknown): value is HistoryKind {
  return typeof value === "string" && (HISTORY_KINDS as readonly string[]).includes(value);
}

/** Rows per page. */
export const HISTORY_PAGE_SIZE = 100;
/** Longest search, in characters (the database cuts at the same length). */
export const HISTORY_SEARCH_MAX = 60;

export type HistoryRow = {
  /** The sort key: created_at as fixed-width digits, the source (e ledger, s salary) and the id. */
  key: string;
  day: string;
  kind: HistoryKind;
  id: string;
  /** A ledger category, or "salary" for a salary payment. */
  category: string;
  method: string;
  amount: number;
  /** Who was paid or who paid; for a salary payment, the employee's name. */
  counterparty: string | null;
  note: string | null;
  created_at: string;
  /** The staff name of who added it, when known. */
  added_by: string | null;
  employee_id: string | null;
  /** The purchase a ledger row mirrors (migration 0022): it changes only with its receipt. */
  purchase_id: string | null;
};

export type HistoryDay = {
  day: string;
  count: number;
  expenses: number;
  salaries: number;
  other_income: number;
  investor_support: number;
};

export type HistoryCursor = { day: string; key: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^\d{20}[es][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The cursor from the address (?before=&bk=), or null when either part is missing or malformed. */
export function parseHistoryCursor(day: string | undefined, key: string | undefined): HistoryCursor | null {
  return day && key && DAY_RE.test(day) && KEY_RE.test(key) ? { day, key } : null;
}

/** The search as the database will read it: trimmed, inner spaces kept, at most HISTORY_SEARCH_MAX characters. */
export function cleanHistorySearch(raw: string): string {
  return [...raw.trim()].slice(0, HISTORY_SEARCH_MAX).join("");
}

/**
 * The expense categories whose name, in any of the given languages, contains the search (folded as the database folds
 * counterparties and comments), so "аренда", "ijara" and "ижара" all find rent. The names live in the dictionaries,
 * not in the database, so the page passes the matches to finance_history. Empty for a search under 2 characters.
 */
export function matchingCategories(
  search: string,
  names: readonly Readonly<Record<ExpenseCategory, string>>[],
): ExpenseCategory[] {
  const term = foldSearchText(search);
  if ([...term].length < 2) return [];
  return EXPENSE_CATEGORIES.filter((category) => names.some((map) => foldSearchText(map[category]).includes(term)));
}
