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

/** Bypasses Row Level Security. Use only for submit_order() and the order alert's amount read. */
export function createSecretClient() {
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
