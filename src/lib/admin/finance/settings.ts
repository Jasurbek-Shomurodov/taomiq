/*
 * The finance settings (migration 0015): three rows of public.settings, readable and writable by the owner only (a
 * restrictive select policy and the owner-only write policy). The database checks the same limits
 * (private.check_finance_setting); keep them in step. Not server-only: the settings form uses the limits.
 */

export const FINANCE_SETTING_KEYS = {
  monthlyRent: "finance_monthly_rent",
  breakEvenDaily: "finance_break_even_daily",
  taxRatePct: "finance_tax_rate_pct",
} as const;

export type FinanceSettingName = keyof typeof FINANCE_SETTING_KEYS;

export type FinanceSettings = {
  /** The rent a month is expected to pay, whole UZS; null when not set. */
  monthlyRent: number | null;
  /** The revenue a day needs to cover the month's costs, whole UZS; null when not set. */
  breakEvenDaily: number | null;
  /** The rate of the estimated tax line, percent (0..100, 2 decimals); null when not set. */
  taxRatePct: number | null;
};

export const FINANCE_SETTING_LIMITS = {
  amountMax: 100_000_000_000,
  taxMax: 100,
} as const;

/** The reason a closed month is reopened with; the database checks the same (0015, reopen_finance_month). */
export const CLOSE_LIMITS = { reasonMin: 10, reasonMax: 500 } as const;

export const NO_FINANCE_SETTINGS: FinanceSettings = { monthlyRent: null, breakEvenDaily: null, taxRatePct: null };

function amountValue(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(n) && n >= 0 && n <= FINANCE_SETTING_LIMITS.amountMax ? n : null;
}

function rateValue(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= FINANCE_SETTING_LIMITS.taxMax ? n : null;
}

/** The settings from public.settings rows ({ key, value }); anything missing or malformed is null (not set). */
export function parseFinanceSettings(rows: readonly { key: unknown; value: unknown }[]): FinanceSettings {
  const settings: FinanceSettings = { ...NO_FINANCE_SETTINGS };
  for (const row of rows) {
    if (row.key === FINANCE_SETTING_KEYS.monthlyRent) settings.monthlyRent = amountValue(row.value);
    if (row.key === FINANCE_SETTING_KEYS.breakEvenDaily) settings.breakEvenDaily = amountValue(row.value);
    if (row.key === FINANCE_SETTING_KEYS.taxRatePct) settings.taxRatePct = rateValue(row.value);
  }
  return settings;
}
