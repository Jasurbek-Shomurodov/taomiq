"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "./env";

/** Browser client, used by the back office for direct photo uploads. */
export function createBrowserSupabase() {
  return createBrowserClient(supabaseUrl, supabaseKey);
}
