import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlLang, type Locale } from "@/i18n/config";

// The role list (STAFF_ROLES, GRANTABLE_ROLES, canHandleOrders) is in ./roles, which client components import too.

/** A row of staff_requests (migration 0008). `name` comes from the provider's editable metadata: a label only. */
export type AccessRequest = {
  user_id: string;
  email: string;
  name: string;
  status: "pending" | "declined";
  created_at: string;
};

/** A row of list_staff(): the staff table with each member's email from auth.users. */
export type TeamMember = { user_id: string; name: string; role: string; email: string; created_at: string };

// All three read through the owner's session client: RLS and the functions' own owner check return nothing (or
// raise) for anyone else. Each throws on failure so the page can show its error notice.

const REQUEST_COLUMNS = "user_id, email, name, status, created_at";
/** Declined history shown on the page; the waiting list is never cut (the write side caps it at 200). */
const DECLINED_LIMIT = 500;

/**
 * Waiting requests, all of them, oldest first (the longest wait on top), and declined ones, newest first and
 * capped. Two reads, so a long declined history can never push a waiting request off the page.
 */
export async function listAccessRequests(
  supabase: SupabaseClient,
): Promise<{ waiting: AccessRequest[]; declined: AccessRequest[] }> {
  const [waiting, declined] = await Promise.all([
    supabase.from("staff_requests").select(REQUEST_COLUMNS).eq("status", "pending").order("created_at", { ascending: true }),
    supabase
      .from("staff_requests")
      .select(REQUEST_COLUMNS)
      .eq("status", "declined")
      .order("created_at", { ascending: false })
      .limit(DECLINED_LIMIT),
  ]);
  if (waiting.error) throw new Error(waiting.error.message);
  if (declined.error) throw new Error(declined.error.message);
  return { waiting: (waiting.data ?? []) as AccessRequest[], declined: (declined.data ?? []) as AccessRequest[] };
}

/** Same date locales as formatDateTime in orders.ts. */
const DATE_LOCALE: Record<Locale, string> = { ...htmlLang, ru: "ru-RU" };

/** A day in Tashkent time, without the time: "23.11.2026" (ru). */
export function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(DATE_LOCALE[locale], {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Everyone with access, in the order they joined. */
export async function listTeam(supabase: SupabaseClient): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc("list_staff");
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamMember[];
}

/** How many requests are waiting, for the pill on the Team row. */
export async function pendingRequestCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("staff_requests")
    .select("user_id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return count ?? 0;
}
