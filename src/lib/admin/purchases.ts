import { htmlLang, type Locale } from "@/i18n/config";
import { addDays } from "@/lib/order/rules";
import { FINANCE_LIMITS, PAYMENT_METHODS, isPaymentMethod, type PaymentMethod } from "./finance/categories";
import { isIngredientUnit, type IngredientUnit } from "./ingredients";

/*
 * Market purchases (docs/plans/zarkebab-feature-port.md, slice 6; migration 0022, public.purchases and
 * public.purchase_lines). Pure and not server-only: the purchase form (a client component) shows problems and the
 * live unit cost with these rules, the actions check again, and public.purchase_save is the authority.
 *
 * Money is whole UZS. A quantity is held as an integer number of thousandths ("milli": 12.5 kg is 12500), never as a
 * floating-point number, so the unit cost (amount / quantity) is integer arithmetic rounded once, for display only.
 */

export { PAYMENT_METHODS, isPaymentMethod, type PaymentMethod };

export const PURCHASE_TABS = ["new", "history", "analytics", "sheet"] as const;
export type PurchaseTab = (typeof PURCHASE_TABS)[number];

export function isPurchaseTab(value: unknown): value is PurchaseTab {
  return typeof value === "string" && (PURCHASE_TABS as readonly string[]).includes(value);
}

/** A receipt is dated today or up to this many days back (private.purchase_day_ok, 0022). */
export const PURCHASE_BACKDATE_DAYS = 3;

export const PURCHASE_LIMITS = {
  lines: 100,
  noteMax: 500,
  /** 1 000 000 units, in thousandths. */
  quantityMaxMilli: 1_000_000_000,
  amountMax: FINANCE_LIMITS.amountMax,
  totalMax: FINANCE_LIMITS.amountMax,
} as const;

/** Receipts per History page. */
export const PURCHASES_PAGE_SIZE = 50;
/** The longest period the Sheet shows (public.purchase_grid: 62 days). */
export const SHEET_MAX_DAYS = 62;
/** Longest History search, in characters (the database cuts at the same length). */
export const PURCHASE_SEARCH_MAX = 60;

/** The days a new receipt may carry on `today` (Tashkent, "YYYY-MM-DD"). */
export function purchaseDayRange(today: string): { earliest: string; latest: string } {
  return { earliest: addDays(today, -PURCHASE_BACKDATE_DAYS), latest: today };
}

export function isPurchaseDayAllowed(day: string, today: string): boolean {
  const { earliest, latest } = purchaseDayRange(today);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= earliest && day <= latest;
}

// ---------- quantities ----------

/**
 * A quantity as typed ("12,5", "12.5", "0.250", "3") → thousandths, or null when it is not a positive number with at
 * most three decimals within the limit.
 */
export function parseQuantity(raw: string | number): number | null {
  const text = String(raw).trim().replace(/[\s  ]/g, "").replace(",", ".");
  const m = /^(\d{1,7})(?:\.(\d{0,3}))?$/.exec(text);
  if (!m) return null;
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli > PURCHASE_LIMITS.quantityMaxMilli) return null;
  return milli;
}

/**
 * A quantity as the database returns it (numeric: "12.500", 12.5, or a period's sum far above one line's limit) →
 * thousandths, or null. No upper limit, still integer thousandths: digits are read as text, never through a float
 * multiplication. A fourth decimal or more (none is stored) is rounded half up.
 */
export function parseDbQuantity(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!m) return null;
  const digits = m[2] ?? "";
  let milli = Number(m[1]) * 1000 + Number(digits.slice(0, 3).padEnd(3, "0"));
  if (digits.length > 3 && Number(digits[3]) >= 5) milli += 1;
  return Number.isSafeInteger(milli) ? milli : null;
}

/** Thousandths → the decimal string sent to the database ("12.5", "3", "0.25"). */
export function quantityText(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** Thousandths as a person reads it in their language: "12,5" (ru, uz), grouped thousands. */
export function formatQuantity(milli: number, locale: Locale): string {
  const whole = Math.floor(milli / 1000);
  const fraction = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  const grouped = new Intl.NumberFormat(htmlLang[locale], { maximumFractionDigits: 0 }).format(whole);
  // Russian and Uzbek write a decimal comma.
  return fraction ? `${grouped},${fraction}` : grouped;
}

/** A whole UZS amount typed with spaces ("70 000") → the number, or null. */
export function parseAmount(raw: string | number): number | null {
  const text = String(raw).replace(/[\s  ]/g, "");
  if (!/^\d{1,12}$/.test(text)) return null;
  const n = Number(text);
  return n > 0 && n <= PURCHASE_LIMITS.amountMax ? n : null;
}

/** Whole UZS per unit: amount / quantity, rounded. Null without a quantity. */
export function unitCost(amount: number, milli: number): number | null {
  if (!(milli > 0) || !(amount > 0)) return null;
  return Math.round((amount * 1000) / milli);
}

/** How a unit cost compares with the usual price: the difference in UZS and in whole percent. Null without a price. */
export function priceDiff(cost: number | null, usual: number | null): { diff: number; pct: number } | null {
  if (cost === null || usual === null || !(usual > 0)) return null;
  const diff = cost - usual;
  return { diff, pct: Math.round((diff * 100) / usual) };
}

// ---------- the form ----------

/** One line as the form holds it: the picked ingredient and what was typed. */
export type PurchaseLineDraft = {
  ingredientId: string;
  quantity: string;
  amount: string;
};

export type LineProblem = "ingredient" | "quantity" | "amount";
export type PurchaseFormProblem = "day" | "method" | "lines" | "note" | "total";
export type PurchaseErrors = {
  form: PurchaseFormProblem[];
  /** Per line, by position. */
  lines: Record<number, LineProblem[]>;
};

/** The line as sent to public.purchase_save. */
export type PurchaseLinePayload = { ingredient_id: string; quantity: string; amount: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks a receipt. `dayAllowed` says whether the day is accepted: a new receipt's day is today or up to 3 days back,
 * an edit may keep the day it has. Lines with nothing picked and nothing typed are ignored (the empty last row).
 */
export function checkPurchase(input: {
  dayAllowed: boolean;
  method: string;
  note: string;
  lines: readonly PurchaseLineDraft[];
}): { errors: PurchaseErrors; payload: PurchaseLinePayload[]; total: number } {
  const errors: PurchaseErrors = { form: [], lines: {} };
  if (!input.dayAllowed) errors.form.push("day");
  if (!isPaymentMethod(input.method)) errors.form.push("method");
  if ([...input.note.trim()].length > PURCHASE_LIMITS.noteMax) errors.form.push("note");

  const payload: PurchaseLinePayload[] = [];
  let total = 0;
  input.lines.forEach((line, index) => {
    const blank = !line.ingredientId && !line.quantity.trim() && !line.amount.trim();
    if (blank) return;
    const problems: LineProblem[] = [];
    if (!UUID_RE.test(line.ingredientId)) problems.push("ingredient");
    const milli = parseQuantity(line.quantity);
    if (milli === null) problems.push("quantity");
    const amount = parseAmount(line.amount);
    if (amount === null) problems.push("amount");
    if (problems.length) {
      errors.lines[index] = problems;
      return;
    }
    total += amount!;
    payload.push({ ingredient_id: line.ingredientId, quantity: quantityText(milli!), amount: amount! });
  });

  if (payload.length === 0 && Object.keys(errors.lines).length === 0) errors.form.push("lines");
  if (payload.length > PURCHASE_LIMITS.lines) errors.form.push("lines");
  if (total > PURCHASE_LIMITS.totalMax) errors.form.push("total");
  return { errors, payload, total };
}

export function hasPurchaseErrors(errors: PurchaseErrors): boolean {
  return errors.form.length > 0 || Object.keys(errors.lines).length > 0;
}

/**
 * The lines sent by the form (a JSON field), read defensively: an array of { ingredient_id, quantity, amount } with
 * the shapes checkPurchase gives them, or null.
 */
export function readLinesField(raw: string): PurchaseLineDraft[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > PURCHASE_LIMITS.lines * 2) return null;
  const lines: PurchaseLineDraft[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    lines.push({
      ingredientId: typeof row.ingredient_id === "string" ? row.ingredient_id : "",
      quantity: typeof row.quantity === "string" || typeof row.quantity === "number" ? String(row.quantity) : "",
      amount: typeof row.amount === "string" || typeof row.amount === "number" ? String(row.amount) : "",
    });
  }
  return lines;
}

// ---------- shapes read from the database ----------

export type PurchaseLine = {
  ingredient_id: string;
  ingredient_name: string;
  unit: IngredientUnit;
  milli: number;
  amount: number;
  usual_price: number | null;
};

export type Purchase = {
  id: string;
  day: string;
  buyer_id: string | null;
  buyer_name: string;
  payment_method: PaymentMethod;
  note: string;
  total: number;
  created_at: string;
  updated_at: string;
  lines: PurchaseLine[];
};

export type Buyer = { id: string; name: string };

/** Names in three languages, as the functions return them. */
export type Names = { name_ru: string; name_uz: string; name_uzc: string };

export type PurchaseListRow = {
  id: string;
  day: string;
  created_at: string;
  updated_at: string;
  buyer_name: string;
  payment_method: PaymentMethod | null;
  total: number;
  note: string;
  lines: number;
  items: Names[];
};

export type PurchasesPage = { rows: PurchaseListRow[]; count: number; amount: number; page: number; pages: number };

export type PurchaseAnalytics = {
  total: number;
  receipts: number;
  days: number;
  daysWithPurchases: number;
  ingredients: number;
  byDay: { day: string; amount: number }[];
  byCategory: (Names & { id: string; amount: number })[];
  byMethod: { method: PaymentMethod | null; amount: number; receipts: number }[];
  byBuyer: { name: string; amount: number; receipts: number }[];
  top: (Names & {
    ingredientId: string;
    unit: IngredientUnit;
    milli: number;
    amount: number;
    lines: number;
    avgCost: number | null;
    latestCost: number | null;
    latestDay: string | null;
    usualPrice: number | null;
  })[];
};

export type GridCell = { day: string; milli: number; amount: number; receipts: number; buyers: string[] };

export type GridRow = Names & {
  ingredientId: string;
  categoryId: string;
  unit: IngredientUnit;
  usualPrice: number | null;
  milli: number;
  amount: number;
  cells: GridCell[];
};

/** The unit of a row, defaulting to pieces for a value this build does not know. */
export function unitOf(value: unknown): IngredientUnit {
  return isIngredientUnit(value) ? value : "pcs";
}

/** Every day from `from` to `to`, both included. */
export function daysOf(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to && days.length < 400; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The latest-vs-average mark of the Analytics tab: up when the latest unit cost is above the average. */
export function costTrend(latest: number | null, average: number | null): "up" | "down" | "flat" | null {
  if (latest === null || average === null || average <= 0) return null;
  // Within 1 % counts as the same price.
  const pct = ((latest - average) * 100) / average;
  if (pct > 1) return "up";
  if (pct < -1) return "down";
  return "flat";
}
