import "server-only";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSessionClient } from "@/lib/supabase/server";

export type StaffMember = { user_id: string; name: string; role: "owner" | "admin"; email: string };

/**
 * Gate for every back-office page and action.
 * Returns the signed-in staff member with a session-bound Supabase client,
 * or redirects to the login page. Row Level Security enforces the same rule in the database.
 */
export async function requireStaff() {
  if (!isSupabaseConfigured) redirect("/setup");

  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: staff } = await supabase
    .from("staff")
    .select("user_id, name, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!staff) redirect("/login?error=not-staff");

  return { supabase, staff: { ...staff, email: user.email ?? "" } as StaffMember };
}

/** Owner-only gate: programs, prices and settings. Admins are sent back to the overview. */
export async function requireOwner() {
  const session = await requireStaff();
  if (session.staff.role !== "owner") redirect("/");
  return session;
}
