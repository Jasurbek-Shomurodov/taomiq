import type { OrderStatus, PaymentMethod } from "./orders";
import { cleanOrderSearch, orderSearchFilter } from "./order-search";

/*
 * Customers (docs/plans/zarkebab-feature-port.md, slice 4): one row per phone number across every order. Every figure
 * and every filter is decided once, in SQL (private.customer_rows, migration 0020): the list, the filter counts, the
 * customer page and the overview's "ending" tile all read it, so they always agree. This file holds the names and
 * shapes the pages share; nothing here re-computes a figure. Not server-only: the note control (a client component)
 * uses the note limit.
 *
 * A customer's address in the panel is /customers/<key>, where the key is the id of their earliest order (opaque and
 * stable), so no phone number is ever part of a URL path.
 */

/** The filter chips, in display order. Same list as the check in public.customers_page. */
export const CUSTOMER_FILTERS = ["all", "active", "ending", "lapsed", "new"] as const;
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];

export function isCustomerFilter(value: unknown): value is CustomerFilter {
  return typeof value === "string" && (CUSTOMER_FILTERS as readonly string[]).includes(value);
}

/** The badge word of a row, as private.customer_rows returns it. */
export const CUSTOMER_STATES = ["ending", "active", "upcoming", "pending", "lapsed", "ended", "none"] as const;
export type CustomerState = (typeof CUSTOMER_STATES)[number];

export function isCustomerState(value: unknown): value is CustomerState {
  return typeof value === "string" && (CUSTOMER_STATES as readonly string[]).includes(value);
}

/** "Ending": the plan's last delivery day is today or one of the next days, this many days in all (SQL: today + 2). */
export const ENDING_SOON_DAYS = 3;
/** "Lapsed": the last plan ended at least this many days ago and nothing new is open (SQL: today - 14). */
export const LAPSED_AFTER_DAYS = 14;
/** "New": the first order was placed within this many days, today included (SQL: today - 30). */
export const NEW_WITHIN_DAYS = 30;

export const CUSTOMERS_PAGE_SIZE = 50;

/** Same limit as the check on public.customer_notes.note. */
export const CUSTOMER_NOTE_MAX = 2000;

/** The most orders a customer page lists (public.customer_orders returns at most this many). */
export const CUSTOMER_ORDERS_LIMIT = 200;

/** One row of public.customers_page. `total_paid` is null for a manager (the database returns it to owners only). */
export type CustomerRow = {
  customer_key: string;
  phone: string;
  customer_name: string;
  orders_count: number;
  paid_count: number;
  total_paid: number | null;
  first_order_at: string;
  last_order_at: string;
  /** The current plan's last delivery day ("YYYY-MM-DD"); null when no paid or active plan ends today or later. */
  plan_ends: string | null;
  /** The last delivery day of the latest paid, active or completed order. */
  last_plan_end: string | null;
  state: CustomerState;
  is_new: boolean;
  has_account: boolean;
  /** utm_source, else ref, of the first order (lower case); null: came directly. */
  source: string | null;
};

/** public.customer_detail: the row's figures, the latest address and window, and the staff note. */
export type CustomerDetail = CustomerRow & {
  last_address: string;
  last_window: string;
  note: string;
  note_updated_at: string | null;
  /** The staff name of whoever saved the note last; null when unknown (or they left the team). */
  note_updated_by: string | null;
};

/** How many customers each filter chip holds (of the customers matching the search). */
export type CustomerCounts = Record<CustomerFilter, number>;

/** One row of public.customer_orders. */
export type CustomerOrder = {
  id: string;
  number: number;
  status: OrderStatus;
  program_name: string;
  kcal: number;
  days: number;
  weekdays_only: boolean;
  start_date: string;
  /** The last delivery day; null for a cancelled order. */
  end_date: string | null;
  total: number;
  payment_method: PaymentMethod | null;
  created_by: string | null;
  created_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A customer key (an order id) from the address, or null when it cannot be one. */
export function parseCustomerKey(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

/** public.set_customer_note's refusal when the key's order now has another phone than the page showed. */
export const CUSTOMER_CHANGED = "customer_changed";

export function customerHref(key: string): string {
  return `/customers/${key}`;
}

/**
 * The search the database receives, or null when the term searches for nothing: the same rules and the same cleaning
 * as the orders list's ?q= (lib/admin/order-search.ts): letters search names, four or more digits the phone, a term of
 * digits only also an order number. public.customers_page reads the cleaned term with the same rules.
 */
export function customerSearchTerm(raw: string): string | null {
  return orderSearchFilter(raw) === null ? null : cleanOrderSearch(raw);
}
