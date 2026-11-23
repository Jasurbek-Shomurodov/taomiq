import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

/**
 * Secret (service_role) key. Server only, never NEXT_PUBLIC_.
 * The one place the app uses it is submitting orders: submit_order() is not callable with the public key.
 */
export const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY ?? "";

/** False until the secret key is in the environment; the order form then behaves like demo mode. */
export const isOrderingConfigured = Boolean(supabaseUrl && supabaseSecretKey);

/** Bypasses Row Level Security. Use only for calling submit_order(). */
export function createSecretClient() {
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
