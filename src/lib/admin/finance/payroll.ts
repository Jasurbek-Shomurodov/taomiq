import { BadgeMinus, BadgePlus, CalendarX2, HandCoins, type LucideIcon } from "lucide-react";
import type { Tone } from "@/app/admin/kit/Badge";

/*
 * The payroll's vocabulary (migration 0014: finance_employees, finance_salary_rates, finance_salary_events). Not
 * server-only: the payroll forms (client components) and the pages use it. The database holds the same lists in the
 * tables' checks; keep them in step.
 *
 *   payment  money handed to the person: needs a payment method, counts as spending on its day
 *   bonus    added to what the person is owed
 *   fine     taken off what the person is owed; always with a reason
 *   absence  a day without pay; no amount, at most one per person and day
 */

export const SALARY_EVENT_KINDS = ["payment", "bonus", "fine", "absence"] as const;
export type SalaryEventKind = (typeof SALARY_EVENT_KINDS)[number];

export const RATE_UNITS = ["monthly", "daily"] as const;
export type RateUnit = (typeof RATE_UNITS)[number];

/** Limits shared by the forms, the server actions and the tables' checks. */
export const PAYROLL_LIMITS = {
  nameMax: 120,
  jobTitleMax: 80,
  noteMax: 500,
  /** How far ahead a new rate may start, in days (a raise agreed for later). */
  rateAheadDays: 366,
} as const;

export function isSalaryEventKind(value: unknown): value is SalaryEventKind {
  return typeof value === "string" && (SALARY_EVENT_KINDS as readonly string[]).includes(value);
}

export function isRateUnit(value: unknown): value is RateUnit {
  return typeof value === "string" && (RATE_UNITS as readonly string[]).includes(value);
}

const EVENT_ICONS: Record<SalaryEventKind, LucideIcon> = {
  payment: HandCoins,
  bonus: BadgePlus,
  fine: BadgeMinus,
  absence: CalendarX2,
};

/** Payments plain (money out), bonuses positive, fines negative, absences a caution. */
export const EVENT_TONES: Record<SalaryEventKind, Tone> = {
  payment: "neutral",
  bonus: "positive",
  fine: "negative",
  absence: "caution",
};

export function eventIcon(kind: SalaryEventKind): LucideIcon {
  return EVENT_ICONS[kind];
}
