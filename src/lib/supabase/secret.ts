import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

/**
 * Secret (service_role) key. Server only, never NEXT_PUBLIC_.
 * The app uses it for submitting orders (submit_order() is not callable with the public key) and for
 * reading back the saved amounts of a new order for the staff alert (src/lib/order/telegram.ts).
 */
export const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? "";

/** False until the secret key is in the environment; the order form then behaves like demo mode. */
export const isOrderingConfigured = Boolean(supabaseUrl && supabaseSecretKey);

/**
 * Bypasses Row Level Security. Use only for submit_order(), the order alert's amount read, customer profile sync
 * (src/lib/account/profile.ts), recording back-office access requests (src/lib/admin/access.ts) and the owner group's
 * Telegram outbox: its drain (src/lib/telegram/drain.ts) and the daily endpoint (src/app/api/telegram/daily), which call
 * the service_role-only functions of migration 0026.
 */
export function createSecretClient() {
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
