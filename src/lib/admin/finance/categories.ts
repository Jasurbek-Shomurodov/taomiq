import {
  Building2,
  Calculator,
  CircleDollarSign,
  CreditCard,
  Ellipsis,
  HandCoins,
  Lightbulb,
  Megaphone,
  Monitor,
  Package,
  Receipt,
  ShoppingBasket,
  Truck,
  UserRound,
  Wrench,
  Landmark,
  PiggyBank,
  type LucideIcon,
} from "lucide-react";

/*
 * The finance ledger's vocabulary (migration 0013, public.finance_entries). Not server-only: the Records form (a client
 * component) and the pages use it. The database holds the same lists in finance_entries_category_check and the
 * payment_method check; keep them in step.
 *
 * The form and the history speak of three kinds of record, which map onto the table's type and category:
 *   expense      → entry_type 'expense', one of EXPENSE_CATEGORIES
 *   investor     → entry_type 'income',  category 'investor_support' (never counted as income or profit)
 *   other_income → entry_type 'income',  category 'other_income'
 */

export const ENTRY_TYPES = ["expense", "income"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const EXPENSE_CATEGORIES = [
  "ingredients",
  "packaging",
  "delivery",
  "rent",
  "utilities",
  "marketing",
  "equipment",
  "repair",
  "tax",
  "payment_fees",
  "software",
  "salary_one_time",
  "investment",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const INCOME_CATEGORIES = ["investor_support", "other_income"] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export type EntryCategory = ExpenseCategory | IncomeCategory;

export const PAYMENT_METHODS = ["cash", "card", "transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ENTRY_KINDS = ["expense", "investor", "other_income"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** Limits shared by the form, the server action and the table's checks. */
export const FINANCE_LIMITS = {
  /** The largest single amount, in UZS (amount <= 100000000000). */
  amountMax: 100_000_000_000,
  counterpartyMax: 120,
  noteMax: 500,
  /** The earliest date a record may carry (finance_entries_date_check). */
  firstDay: "2024-01-01",
} as const;

export function isEntryKind(value: unknown): value is EntryKind {
  return typeof value === "string" && (ENTRY_KINDS as readonly string[]).includes(value);
}

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

/** The table's type and category for a kind of record; an expense needs its category from the form. */
export function kindToRow(
  kind: EntryKind,
  expenseCategory: ExpenseCategory | null,
): { entry_type: EntryType; category: EntryCategory } | null {
  if (kind === "investor") return { entry_type: "income", category: "investor_support" };
  if (kind === "other_income") return { entry_type: "income", category: "other_income" };
  return expenseCategory ? { entry_type: "expense", category: expenseCategory } : null;
}

/** The kind of a stored row; null for a pairing the table would not accept. */
export function rowKind(entryType: string, category: string): EntryKind | null {
  if (entryType === "expense" && isExpenseCategory(category)) return "expense";
  if (entryType === "income" && category === "investor_support") return "investor";
  if (entryType === "income" && category === "other_income") return "other_income";
  return null;
}

const CATEGORY_ICONS: Record<EntryCategory, LucideIcon> = {
  ingredients: ShoppingBasket,
  packaging: Package,
  delivery: Truck,
  rent: Building2,
  utilities: Lightbulb,
  marketing: Megaphone,
  equipment: Monitor,
  repair: Wrench,
  tax: Landmark,
  payment_fees: CreditCard,
  software: Calculator,
  salary_one_time: UserRound,
  investment: PiggyBank,
  other: Ellipsis,
  investor_support: HandCoins,
  other_income: CircleDollarSign,
};

/** The icon of a category; a generic receipt for one this build does not know. */
export function categoryIcon(category: string): LucideIcon {
  return (CATEGORY_ICONS as Record<string, LucideIcon>)[category] ?? Receipt;
}
