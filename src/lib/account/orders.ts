import "server-only";
import { isOrderStatus, type OrderStatus } from "@/lib/admin/orders";
import { createSessionClient } from "@/lib/supabase/server";

/** What a customer sees of their own order. Never staff notes, attribution or the IP hash. */
export type CustomerOrder = {
  number: number;
  status: OrderStatus;
  program_name: string;
  kcal: number;
  days: number;
  weekdays_only: boolean;
  start_date: string;
  total: number;
  created_at: string;
};

/**
 * The signed-in customer's orders, newest first (at most 100). Read through public.my_orders()
 * (migration 0007), which returns only the caller's own rows and only these columns; the orders table
 * itself stays owner-only. Throws when the database cannot be read, so the page can say so.
 */
export async function listMyOrders(): Promise<CustomerOrder[]> {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.rpc("my_orders");
  if (error) throw new Error(`my_orders: ${error.code} ${error.message}`);
  return ((data ?? []) as CustomerOrder[])
    .filter((order) => isOrderStatus(order.status))
    .map((order) => ({ ...order, number: Number(order.number), total: Number(order.total) }));
}
