import { htmlLang, type Locale } from "@/i18n/config";
import { FINANCE_LIMITS } from "./categories";

/*
 * Calendar months of the finance screens (`?m=YYYY-MM`). Pure functions of their arguments: "today" is a Tashkent
 * calendar day the caller reads once per request (tashkentDay in lib/admin/stats.ts), so nothing here reads the clock.
 */

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export type FinanceMonth = {
  /** "YYYY-MM". */
  key: string;
  /** The first day, "YYYY-MM-01". */
  from: string;
  /** The last day, "YYYY-MM-DD". */
  to: string;
  /** The month before, or null at the ledger's first month. */
  prev: string | null;
  /** The month after, or null for the current month (no future months). */
  next: string | null;
  isCurrent: boolean;
};

function shift(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}`;
}

function lastDay(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

/**
 * The month an address asks for, or the current one when it asks for none, a malformed one, one in the future, or
 * one before the ledger's first day (FINANCE_LIMITS.firstDay).
 */
export function financeMonth(param: string | undefined, today: string): FinanceMonth {
  const current = today.slice(0, 7);
  const first = FINANCE_LIMITS.firstDay.slice(0, 7);
  const key = param && MONTH_RE.test(param) && param <= current && param >= first ? param : current;
  return {
    key,
    from: `${key}-01`,
    to: lastDay(key),
    prev: key > first ? shift(key, -1) : null,
    next: key < current ? shift(key, 1) : null,
    isCurrent: key === current,
  };
}

/** "Ноябрь 2026 г.", "Noyabr, 2026": the month as a heading, first letter up. */
export function formatMonth(key: string, locale: Locale): string {
  const [y, m] = key.split("-").map(Number);
  const text = new Intl.DateTimeFormat(htmlLang[locale], { timeZone: "UTC", month: "long", year: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
  return text.charAt(0).toLocaleUpperCase(htmlLang[locale]) + text.slice(1);
}

/** "ср, 25 ноября": a day of the history, as written (UTC, so the server's zone never shifts it). */
export function formatEntryDay(day: string, locale: Locale): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(htmlLang[locale], {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Whether "YYYY-MM-DD" is a real calendar day (2026-02-30 is not). */
export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
