import { requireStaff } from "@/lib/admin/auth";
import { pendingRequestCount } from "@/lib/admin/team";
import { TeamRequestsPill } from "./TeamRequestsPill";

/**
 * The waiting-requests pill on the Team row, seeded on the server: access requests in status "pending". Owners only
 * (the layout renders it only for them, and RLS returns nothing to anyone else). A failed read (for example before
 * migration 0008 is applied) seeds null, never 0, and shows no pill; it is read again on each navigation.
 */
export async function TeamRequestsBadge() {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") return null;
  let count: number | null = null;
  try {
    count = await pendingRequestCount(supabase);
  } catch (error) {
    console.error("team request badge failed", error instanceof Error ? error.message : error);
  }
  return <TeamRequestsPill initialCount={count} locale={staff.locale} />;
}
