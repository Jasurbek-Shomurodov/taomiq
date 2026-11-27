import "server-only";
import { isOrderStatus, type OrderStatus } from "@/lib/admin/orders";
import type { DayRange } from "@/lib/order/days";
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
  /**
   * The order's active pauses (public.my_order_pauses, migration 0028), for its end date and status line. Null when
   * they could not be read: the page then shows no status line rather than a wrong end date.
   */
  pauses: DayRange[] | null;
};

type PauseRow = { number: number | string; from_date: string; to_date: string };

/**
 * The signed-in customer's orders, newest first (at most 100). Read through public.my_orders()
 * (migration 0007), which returns only the caller's own rows and only these columns; the orders table
 * itself stays owner-only. Their pauses come from public.my_order_pauses() (0028, the caller's own active pauses,
 * no staff ids). Throws when the orders cannot be read, so the page can say so; a failed pause read leaves the orders
 * without a status line.
 */
export async function listMyOrders(): Promise<CustomerOrder[]> {
  const supabase = await createSessionClient();
  const [ordersRead, pausesRead] = await Promise.all([supabase.rpc("my_orders"), supabase.rpc("my_order_pauses")]);
  const { data, error } = ordersRead;
  if (error) throw new Error(`my_orders: ${error.code} ${error.message}`);

  let byNumber: Map<number, DayRange[]> | null = new Map();
  if (pausesRead.error) {
    console.error("account: my_order_pauses failed", pausesRead.error.code);
    byNumber = null;
  } else {
    for (const row of (pausesRead.data ?? []) as PauseRow[]) {
      const number = Number(row.number);
      const list = byNumber.get(number) ?? [];
      list.push({ from: row.from_date, to: row.to_date });
      byNumber.set(number, list);
    }
  }

  return ((data ?? []) as Omit<CustomerOrder, "pauses">[])
    .filter((order) => isOrderStatus(order.status))
    .map((order) => {
      const number = Number(order.number);
      return { ...order, number, total: Number(order.total), pauses: byNumber ? (byNumber.get(number) ?? []) : null };
    });
}
