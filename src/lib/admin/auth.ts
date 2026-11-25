import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isLocale, type Locale } from "@/i18n/config";
import { defaultAdminLocale } from "@/i18n/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSessionClient } from "@/lib/supabase/server";
import { canHandleOrders, canHandleStock, type StaffRole } from "./roles";

export type StaffMember = { user_id: string; name: string; role: StaffRole; email: string; locale: Locale };

/**
 * Gate for every back-office page and action.
 * Returns the signed-in staff member (with their interface language) and a session-bound Supabase
 * client, or redirects to the login page. Row Level Security enforces the same rule in the database.
 * Memoised per server render (React cache), so the layout, the page and its metadata share one check.
 * setAdminLocale() changes the language without going through it, so a cached row is never read back.
 */
export const requireStaff = cache(async () => {
  if (!isSupabaseConfigured) redirect("/setup");

  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("staff")
    .select("user_id, name, role, locale")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!staff) redirect("/login?error=not-staff");

  const locale = typeof staff.locale === "string" && isLocale(staff.locale) ? staff.locale : defaultAdminLocale;
  return { supabase, staff: { ...staff, locale, email: user.email ?? "" } as StaffMember };
});

/** Owner-only gate: programs, prices, settings and the team. Managers and admins are sent back to the overview. */
export async function requireOwner() {
  const session = await requireStaff();
  if (session.staff.role !== "owner") redirect("/");
  return session;
}

/**
 * The owner check for a route handler (the Excel export), which answers with a status instead of a redirect and does
 * not pass through the panel layout or a page's requireOwner(). The same reads as requireStaff: the verified session
 * user, then their own staff row (RLS lets a member read only their own). Null for no session, no staff row, any other
 * role, or a failed read; the database functions refuse anyone but the owner anyway.
 */
export async function ownerSessionOrNull() {
  if (!isSupabaseConfigured) return null;
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: staff, error } = await supabase
    .from("staff")
    .select("user_id, name, role, locale")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !staff || staff.role !== "owner") return null;
  const locale = typeof staff.locale === "string" && isLocale(staff.locale) ? staff.locale : defaultAdminLocale;
  return { supabase, staff: { ...staff, locale, email: user.email ?? "" } as StaffMember };
}

/**
 * Orders and deliveries gate (customers' names, phones and addresses): owners and managers (canHandleOrders,
 * lib/admin/roles.ts). Admins are sent back to the overview. The database holds the same rule
 * (private.can_handle_orders(), migration 0011: the orders policies and public.delivery_orders).
 */
export async function requireOrdersAccess() {
  const session = await requireStaff();
  if (!canHandleOrders(session.staff.role)) redirect("/");
  return session;
}

/**
 * Ingredients and purchases gate (docs/plans/zarkebab-feature-port.md, slice 6): owners and managers (canHandleStock,
 * lib/admin/roles.ts). Admins are sent back to the overview. The database holds the same rule
 * (private.can_handle_stock(), migration 0022: the stock tables' policies and the purchase functions).
 */
export async function requireStockAccess() {
  const session = await requireStaff();
  if (!canHandleStock(session.staff.role)) redirect("/");
  return session;
}
