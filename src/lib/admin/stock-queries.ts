import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIngredientUnit, type Ingredient, type IngredientCategory } from "./ingredients";
import { readCapped } from "./stats";
import {
  PURCHASES_PAGE_SIZE,
  isPaymentMethod,
  parseDbQuantity,
  unitOf,
  type Buyer,
  type GridRow,
  type Names,
  type Purchase,
  type PurchaseAnalytics,
  type PurchasesPage,
} from "./purchases";

/*
 * Reads of the ingredients and purchases of migration 0022, through the signed-in session. Owners and managers only:
 * RLS returns nothing to anyone else and the functions raise not_allowed. Each throws on a failed read; the pages
 * turn that into a notice. Nothing here reads public.finance_entries except purchaseEntryLinks, which the owner's
 * Finance → Records calls.
 */

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : num(value));
const str = (value: unknown): string => (typeof value === "string" ? value : "");
/** A quantity read from the database (a line, or a period's sum) in thousandths; 0 for one that does not parse. */
const milli = (value: unknown): number => parseDbQuantity(value) ?? 0;

function names(raw: Record<string, unknown>): Names {
  return { name_ru: str(raw.name_ru), name_uz: str(raw.name_uz), name_uzc: str(raw.name_uzc) };
}

const INGREDIENT_COLUMNS =
  "id, name_ru, name_uz, name_uzc, category_id, unit, usual_price, pieces_per_unit, archived_at, updated_at";

function toIngredient(raw: Record<string, unknown>): Ingredient {
  return {
    id: String(raw.id),
    ...names(raw),
    category_id: String(raw.category_id),
    unit: isIngredientUnit(raw.unit) ? raw.unit : "pcs",
    usual_price: numOrNull(raw.usual_price),
    pieces_per_unit: numOrNull(raw.pieces_per_unit),
    archived_at: typeof raw.archived_at === "string" ? raw.archived_at : null,
    updated_at: str(raw.updated_at),
  };
}

/** The most ingredients the catalogue reads (a kitchen buys a few hundred). */
const INGREDIENTS_CAP = 5000;

/**
 * Every ingredient, active and archived (the catalogue is small; the screens filter it). Read page by page through
 * range() (the API returns at most 1000 rows per request), with `id` breaking ties so pages neither repeat nor skip.
 */
export async function listIngredients(supabase: SupabaseClient): Promise<Ingredient[]> {
  const page = async (start: number, end: number): Promise<Ingredient[]> => {
    const { data, error } = await supabase
      .from("ingredients")
      .select(INGREDIENT_COLUMNS)
      .order("name_ru", { ascending: true })
      .order("id", { ascending: true })
      .range(start, end);
    if (error) {
      if (error.code === "PGRST103") return [];
      throw new Error(`ingredients: ${error.code} ${error.message}`);
    }
    return ((data ?? []) as Record<string, unknown>[]).map(toIngredient);
  };
  const { rows, partial } = await readCapped(page, INGREDIENTS_CAP);
  if (partial) console.error(`ingredients: more than ${INGREDIENTS_CAP}, the list is cut`);
  return rows;
}

export async function getIngredient(supabase: SupabaseClient, id: string): Promise<Ingredient | null> {
  const { data, error } = await supabase.from("ingredients").select(INGREDIENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    // A malformed id is "no such ingredient", not a failure.
    if (error.code === "22P02") return null;
    throw new Error(`ingredients: ${error.code} ${error.message}`);
  }
  return data ? toIngredient(data as Record<string, unknown>) : null;
}

export async function listCategories(supabase: SupabaseClient): Promise<IngredientCategory[]> {
  const { data, error } = await supabase
    .from("ingredient_categories")
    .select("id, name_ru, name_uz, name_uzc, sort")
    .order("sort", { ascending: true })
    .order("name_ru", { ascending: true });
  if (error) throw new Error(`ingredient_categories: ${error.code} ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((raw) => ({
    id: String(raw.id),
    ...names(raw),
    sort: num(raw.sort),
  }));
}

/** Who can be named as the buyer: active payroll employees, names only (public.purchase_buyers). */
export async function loadBuyers(supabase: SupabaseClient): Promise<Buyer[]> {
  const { data, error } = await supabase.rpc("purchase_buyers");
  if (error) throw new Error(`purchase_buyers: ${error.code} ${error.message}`);
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((raw) => ({
    id: String(raw.id),
    name: str(raw.name),
  }));
}

/** One receipt with its lines in their order; null when there is none with that id. */
export async function getPurchase(supabase: SupabaseClient, id: string): Promise<Purchase | null> {
  const { data, error } = await supabase
    .from("purchases")
    .select(
      "id, day, buyer_id, buyer_name, payment_method, note, total, created_at, updated_at, " +
        "purchase_lines (ingredient_id, ingredient_name, unit, quantity, amount, usual_price, sort)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (error.code === "22P02") return null;
    throw new Error(`purchases: ${error.code} ${error.message}`);
  }
  if (!data) return null;
  const raw = data as unknown as Record<string, unknown>;
  const lines = (Array.isArray(raw.purchase_lines) ? raw.purchase_lines : []) as Record<string, unknown>[];
  return {
    id: String(raw.id),
    day: str(raw.day),
    buyer_id: typeof raw.buyer_id === "string" ? raw.buyer_id : null,
    buyer_name: str(raw.buyer_name),
    payment_method: isPaymentMethod(raw.payment_method) ? raw.payment_method : "cash",
    note: str(raw.note),
    total: num(raw.total),
    created_at: str(raw.created_at),
    updated_at: str(raw.updated_at),
    lines: lines
      .slice()
      .sort((a, b) => num(a.sort) - num(b.sort))
      .map((line) => ({
        ingredient_id: String(line.ingredient_id),
        ingredient_name: str(line.ingredient_name),
        unit: unitOf(line.unit),
        milli: milli(line.quantity),
        amount: num(line.amount),
        usual_price: numOrNull(line.usual_price),
      })),
  };
}

/** One History page (public.purchases_page): the filters, a 1-based page clamped to the last one. */
export async function loadPurchasesPage(
  supabase: SupabaseClient,
  filters: { from: string; to: string; search: string; category: string | null; method: string | null; page: number },
): Promise<PurchasesPage> {
  const { data, error } = await supabase.rpc("purchases_page", {
    p_from: filters.from,
    p_to: filters.to,
    p_search: filters.search || null,
    p_category: filters.category,
    p_method: filters.method,
    p_page: filters.page,
    p_page_size: PURCHASES_PAGE_SIZE,
  });
  if (error) throw new Error(`purchases_page: ${error.code} ${error.message}`);
  const raw = (data ?? {}) as Record<string, unknown>;
  const rows = (Array.isArray(raw.rows) ? raw.rows : []) as Record<string, unknown>[];
  const pages = Math.max(1, num(raw.pages));
  return {
    count: num(raw.count),
    amount: num(raw.amount),
    pages,
    page: Math.min(Math.max(1, num(raw.page)), pages),
    rows: rows.map((row) => ({
      id: String(row.id),
      day: str(row.day),
      created_at: str(row.created_at),
      updated_at: str(row.updated_at),
      buyer_name: str(row.buyer_name),
      payment_method: isPaymentMethod(row.payment_method) ? row.payment_method : null,
      total: num(row.total),
      note: str(row.note),
      lines: num(row.lines),
      items: ((Array.isArray(row.items) ? row.items : []) as Record<string, unknown>[]).map(names),
    })),
  };
}

export async function loadPurchaseAnalytics(
  supabase: SupabaseClient,
  period: { from: string; to: string },
): Promise<PurchaseAnalytics> {
  const { data, error } = await supabase.rpc("purchases_analytics", { p_from: period.from, p_to: period.to });
  if (error) throw new Error(`purchases_analytics: ${error.code} ${error.message}`);
  const raw = (data ?? {}) as Record<string, unknown>;
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as Record<string, unknown>[]) : []);
  return {
    total: num(raw.total),
    receipts: num(raw.receipts),
    days: num(raw.days),
    daysWithPurchases: num(raw.days_with_purchases),
    ingredients: num(raw.ingredients),
    byDay: list("by_day").map((row) => ({ day: str(row.day), amount: num(row.amount) })),
    byCategory: list("by_category").map((row) => ({ id: String(row.id), ...names(row), amount: num(row.amount) })),
    byMethod: list("by_method").map((row) => ({
      method: isPaymentMethod(row.method) ? row.method : null,
      amount: num(row.amount),
      receipts: num(row.receipts),
    })),
    byBuyer: list("by_buyer").map((row) => ({ name: str(row.name), amount: num(row.amount), receipts: num(row.receipts) })),
    top: list("top").map((row) => ({
      ingredientId: String(row.ingredient_id),
      ...names(row),
      unit: unitOf(row.unit),
      milli: milli(row.quantity),
      amount: num(row.amount),
      lines: num(row.lines),
      avgCost: numOrNull(row.avg_cost),
      latestCost: numOrNull(row.latest_cost),
      latestDay: typeof row.latest_day === "string" ? row.latest_day : null,
      usualPrice: numOrNull(row.usual_price),
    })),
  };
}

export async function loadPurchaseGrid(supabase: SupabaseClient, period: { from: string; to: string }): Promise<GridRow[]> {
  const { data, error } = await supabase.rpc("purchase_grid", { p_from: period.from, p_to: period.to });
  if (error) throw new Error(`purchase_grid: ${error.code} ${error.message}`);
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => ({
    ingredientId: String(row.ingredient_id),
    ...names(row),
    categoryId: String(row.category_id),
    unit: unitOf(row.unit),
    usualPrice: numOrNull(row.usual_price),
    milli: milli(row.quantity),
    amount: num(row.amount),
    cells: ((Array.isArray(row.cells) ? row.cells : []) as Record<string, unknown>[]).map((cell) => ({
      day: str(cell.day),
      milli: milli(cell.quantity),
      amount: num(cell.amount),
      receipts: num(cell.receipts),
      buyers: (Array.isArray(cell.buyers) ? cell.buyers : []).filter((b): b is string => typeof b === "string"),
    })),
  }));
}

/** Ledger ids per lookup: a uuid filter of this many stays well inside a request URL's length. */
const LINK_CHUNK = 150;

/**
 * Finance → Records: which of the ledger rows on the page mirror a purchase (entry id → purchase id). Looks up only
 * the given entry ids, in chunks, so neither the URL nor the API's 1000-row cap is ever reached.
 */
export async function purchaseEntryLinks(
  supabase: SupabaseClient,
  entryIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(entryIds)];
  const links = new Map<string, string>();
  for (let i = 0; i < ids.length; i += LINK_CHUNK) {
    const chunk = ids.slice(i, i + LINK_CHUNK);
    const { data, error } = await supabase.from("purchases").select("id, finance_entry_id").in("finance_entry_id", chunk);
    if (error) throw new Error(`purchases: ${error.code} ${error.message}`);
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      links.set(String(row.finance_entry_id), String(row.id));
    }
  }
  return links;
}

/** The last day of the latest closed month, or null when none is closed (public.purchase_locked_through). */
export async function loadPurchaseLockedThrough(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("purchase_locked_through");
  if (error) throw new Error(`purchase_locked_through: ${error.code} ${error.message}`);
  return typeof data === "string" && data ? data : null;
}
