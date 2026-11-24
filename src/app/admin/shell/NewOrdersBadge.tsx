import { requireStaff } from "@/lib/admin/auth";
import { newOrderCount } from "@/lib/admin/queries";
import { canHandleOrders } from "@/lib/admin/roles";
import { NewOrdersPill } from "./NewOrdersPill";

/**
 * The new-orders pill on the Orders row, seeded on the server: orders waiting in status "new". Owners and managers
 * only (the layout renders it only for them, and RLS returns nothing to anyone else). A failed read seeds null, never
 * 0; the pill then reads the count again on each navigation (NewOrdersPill).
 */
export async function NewOrdersBadge() {
  const { supabase, staff } = await requireStaff();
  if (!canHandleOrders(staff.role)) return null;
  let count: number | null = null;
  try {
    count = await newOrderCount(supabase);
  } catch (error) {
    console.error("new order badge failed", error instanceof Error ? error.message : error);
  }
  return <NewOrdersPill initialCount={count} locale={staff.locale} />;
}
