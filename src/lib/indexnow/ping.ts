import "server-only";

import { after } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient } from "@/lib/supabase/public";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_HOST,
  changedUrls,
  indexNowBody,
  indexNowKeyFrom,
  type CatalogueOutline,
  type SiteChange,
} from "./shared";

/** The IndexNow key (INDEXNOW_KEY), or null when it is unset or invalid: then the key file is a 404 and nothing is sent. */
export function indexNowKey(): string | null {
  return indexNowKeyFrom(process.env.INDEXNOW_KEY);
}

/** Only the Production deployment pings: a preview or a laptop must never announce taomiq.uz URLs. */
const isProduction = () => process.env.VERCEL_ENV === "production";

const TIMEOUT_MS = 10_000;

/** Each active program's slug and level ids, read fresh (no cache: the action has just changed them). */
async function catalogueOutline(): Promise<CatalogueOutline> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await createPublicClient()
    .from("programs")
    .select("slug, variants:program_variants(id)")
    .eq("active", true)
    .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
  if (error) {
    console.error("indexnow: catalogue read failed", error.code);
    return [];
  }
  return (data ?? []).map((row) => ({
    slug: String(row.slug),
    variantIds: (row.variants as { id: string }[] | null)?.map((v) => v.id) ?? [],
  }));
}

/**
 * Tells IndexNow (Yandex and Bing) which public pages a back-office change touched, after the response is sent
 * (after()), so it never slows the action down or fails it. Call it once the change is saved, before any redirect().
 * Does nothing outside Production or without a valid INDEXNOW_KEY. Errors are logged, never thrown.
 */
export function notifySiteChange(changes: SiteChange | SiteChange[]): void {
  if (!isProduction()) return;
  const key = indexNowKey();
  if (!key) return;
  try {
    after(async () => {
      try {
        const urls = changedUrls(changes, await catalogueOutline());
        if (urls.length === 0) return;
        const response = await fetch(INDEXNOW_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(indexNowBody(key, urls, INDEXNOW_HOST)),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // 200 and 202 are accepted; anything else (403 key not found, 422 URLs not on the host, 429) is logged.
        if (response.status !== 200 && response.status !== 202) {
          console.error("indexnow: submission refused", response.status);
        }
      } catch (error) {
        console.error("indexnow: submission failed", error instanceof Error ? error.name : "unknown");
      }
    });
  } catch (error) {
    console.error("indexnow: not scheduled", error instanceof Error ? error.name : "unknown");
  }
}
