import "server-only";
import { isOrderStatus, type OrderStatus } from "@/lib/admin/orders";
import { createSessionClient } from "@/lib/supabase/server";
import type { CustomerPause } from "./pauses";

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
   * The order's active pauses (public.my_order_pauses_v2, migration 0029), for its end date, status line and pause
   * sheet. Null when they could not be read: the page then shows no status line and no pause sheet rather than a wrong
   * end date.
   */
  pauses: CustomerPause[] | null;
};

type PauseRow = { id?: string; number: number | string; from_date: string; to_date: string; source?: string };

type Client = Awaited<ReturnType<typeof createSessionClient>>;

/**
 * The caller's active pauses: my_order_pauses_v2 (0029, with ids and sources). While that function is missing
 * (PGRST202: the code went live before its migration), the older my_order_pauses (0028) still gives the dates, with no
 * ids, so nothing can be removed. Null when neither could be read.
 */
async function readPauses(supabase: Client): Promise<PauseRow[] | null> {
  const v2 = await supabase.rpc("my_order_pauses_v2");
  if (!v2.error) return (v2.data ?? []) as PauseRow[];
  if (v2.error.code !== "PGRST202") {
    console.error("account: my_order_pauses_v2 failed", v2.error.code);
    return null;
  }
  const v1 = await supabase.rpc("my_order_pauses");
  if (v1.error) {
    console.error("account: my_order_pauses failed", v1.error.code);
    return null;
  }
  return (v1.data ?? []) as PauseRow[];
}

/**
 * The signed-in customer's orders, newest first (at most 100). Read through public.my_orders()
 * (migration 0007), which returns only the caller's own rows and only these columns; the orders table
 * itself stays owner-only. Their pauses come from public.my_order_pauses_v2() (0029, the caller's own active
 * pauses, no staff ids). Throws when the orders cannot be read, so the page can say so; a failed pause read leaves the
 * orders without a status line and without the pause sheet.
 */
export async function listMyOrders(): Promise<CustomerOrder[]> {
  const supabase = await createSessionClient();
  const [ordersRead, pauseRows] = await Promise.all([supabase.rpc("my_orders"), readPauses(supabase)]);
  const { data, error } = ordersRead;
  if (error) throw new Error(`my_orders: ${error.code} ${error.message}`);

  let byNumber: Map<number, CustomerPause[]> | null = null;
  if (pauseRows) {
    byNumber = new Map();
    for (const row of pauseRows) {
      const number = Number(row.number);
      const list = byNumber.get(number) ?? [];
      list.push({
        id: typeof row.id === "string" && row.id ? row.id : null,
        from: row.from_date,
        to: row.to_date,
        // Without a source (the older function) the pause is treated as staff's: shown, never removable.
        source: row.source === "customer" ? "customer" : "staff",
      });
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
