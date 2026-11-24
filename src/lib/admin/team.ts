import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Back-office roles, highest first. The database check (staff_role_check, migration 0003) holds the same list:
 * a new role goes into both, plus its label in the dictionaries' `roles`.
 */
export const STAFF_ROLES = ["owner", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

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

/** Waiting and declined requests, oldest first (the longest wait on top). */
export async function listAccessRequests(supabase: SupabaseClient): Promise<AccessRequest[]> {
  const { data, error } = await supabase
    .from("staff_requests")
    .select("user_id, email, name, status, created_at")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as AccessRequest[];
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
