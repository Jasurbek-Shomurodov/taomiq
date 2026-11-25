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

export const FINANCE_SETTING_NAMES = Object.keys(FINANCE_SETTING_KEYS) as FinanceSettingName[];

export function isFinanceSettingName(value: string): value is FinanceSettingName {
  return (FINANCE_SETTING_NAMES as string[]).includes(value);
}

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

export type FinanceSettingInputError = "amount" | "amountRange" | "tax";

/**
 * One setting as typed into its field: null clears it (an empty field), a number sets it. Amounts are whole UZS and may
 * be grouped with spaces ("6 000 000"); the tax rate is a percent with up to 2 decimals, "." or ",". The same rule as
 * private.check_finance_setting; the settings screen uses it to enable Save and the action to check again.
 */
export function readFinanceSettingInput(
  name: FinanceSettingName,
  raw: string,
): { value: number | null } | { error: FinanceSettingInputError } {
  if (name === "taxRatePct") {
    const text = raw.replace(/\s/g, "").replace(",", ".");
    if (!text) return { value: null };
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return { error: "tax" };
    const rate = Number(text);
    return rate >= 0 && rate <= FINANCE_SETTING_LIMITS.taxMax ? { value: rate } : { error: "tax" };
  }
  // \s covers the no-break spaces formatSum groups with.
  const text = raw.replace(/\s/g, "");
  if (!text) return { value: null };
  if (!/^\d+$/.test(text)) return { error: "amount" };
  const amount = Number(text);
  if (!Number.isSafeInteger(amount) || amount > FINANCE_SETTING_LIMITS.amountMax) return { error: "amountRange" };
  return { value: amount };
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
