import { htmlLang, type Locale } from "@/i18n/config";

/*
 * Bank fee rates per payment method (migration 0024, public.finance_fee_rates): what the bank keeps of a payment by
 * card or by transfer, in basis points (150 = 1.5 %), from a day on. They feed an estimate shown on Finance → Month
 * (public.finance_method_flow) and are never written to the ledger. Pure and not server-only: the Settings editor
 * checks its input with these rules, the actions check again, the table's checks are the authority.
 */

export const FEE_METHODS = ["card", "transfer"] as const;
export type FeeMethod = (typeof FEE_METHODS)[number];

export function isFeeMethod(value: unknown): value is FeeMethod {
  return typeof value === "string" && (FEE_METHODS as readonly string[]).includes(value);
}

/** The table's limits: 0..2000 basis points (20 %), from 2024-01-01 on. */
export const FEE_LIMITS = { bpMax: 2000, pctMax: 20, firstDay: "2024-01-01" } as const;

export type FeeRate = {
  id: string;
  method: FeeMethod;
  /** Basis points: 150 = 1.5 %. */
  rate_bp: number;
  /** "YYYY-MM-DD": the rate applies to payments from this day on, until a later row of the same method. */
  effective_from: string;
};

/**
 * A rate as typed: a percent with up to two decimals, "." or "," ("1,5", "2", "0.75"), 0..20 → basis points; null
 * when it is not one. "%" and spaces are ignored.
 */
export function readFeeRateInput(raw: string): number | null {
  const text = raw.replace(/[\s%]/g, "").replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  const bp = Math.round(Number(text) * 100);
  return bp >= 0 && bp <= FEE_LIMITS.bpMax ? bp : null;
}

/** Basis points as a percent in the panel's language: 150 → "1,5 %". */
export function formatFeeRate(bp: number, locale: Locale): string {
  return new Intl.NumberFormat(htmlLang[locale], { style: "percent", maximumFractionDigits: 2 }).format(bp / 10000);
}

/** The rate of a method in force on a day: the row with the latest effective_from on or before it; null when none. */
export function feeRateOn(rates: readonly FeeRate[], method: FeeMethod, day: string): FeeRate | null {
  let found: FeeRate | null = null;
  for (const rate of rates) {
    if (rate.method !== method || rate.effective_from > day) continue;
    if (!found || rate.effective_from > found.effective_from) found = rate;
  }
  return found;
}
