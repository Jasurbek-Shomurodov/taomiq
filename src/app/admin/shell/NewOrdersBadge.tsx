import { requireStaff } from "@/lib/admin/auth";
import { newOrderCount } from "@/lib/admin/queries";
import { NewOrdersPill } from "./NewOrdersPill";

/**
 * The new-orders pill on the Orders row, seeded on the server: orders waiting in status "new". Owners only (the layout
 * renders it only for them, and RLS returns nothing to anyone else). A failed read seeds null, never 0; the pill then
 * reads the count again on each navigation (NewOrdersPill).
 */
export async function NewOrdersBadge() {
  const { supabase, staff } = await requireStaff();
  if (staff.role !== "owner") return null;
  let count: number | null = null;
  try {
    count = await newOrderCount(supabase);
  } catch (error) {
    console.error("new order badge failed", error instanceof Error ? error.message : error);
  }
  return <NewOrdersPill initialCount={count} locale={staff.locale} />;
}
