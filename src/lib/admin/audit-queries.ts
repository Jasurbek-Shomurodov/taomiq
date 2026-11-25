import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUDIT_PAGE_SIZE, isAuditArea, type AuditArea, type AuditCursor, type AuditItem } from "./audit";

/**
 * One page of the audit feed (public.audit_feed, migration 0019), newest first, through the signed-in owner's session
 * client. The function refuses anyone but the owner (not_owner). Throws on a failed read, so the page decides what to
 * show. `older` is the cursor of the next (older) page, null on the last one. Rows of an area this build does not know
 * (a later migration) are left out rather than shown wrong.
 */
export async function loadAuditFeed(
  supabase: SupabaseClient,
  { area, search, cursor }: { area: AuditArea | null; search: string; cursor: AuditCursor | null },
): Promise<{ items: AuditItem[]; older: AuditCursor | null }> {
  const { data, error } = await supabase.rpc("audit_feed", {
    p_area: area,
    p_search: search || null,
    p_before: cursor?.before ?? null,
    p_before_key: cursor?.key ?? null,
    // One more than a page: whether an older page exists.
    p_limit: AUDIT_PAGE_SIZE + 1,
  });
  if (error) throw new Error(`audit_feed: ${error.code} ${error.message}`);

  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const last = page.at(-1);
  const older =
    rows.length > AUDIT_PAGE_SIZE && last ? { before: String(last.at), key: String(last.item_key) } : null;

  const items: AuditItem[] = [];
  for (const row of page) {
    if (!isAuditArea(row.area)) continue;
    const summary = row.summary;
    items.push({
      key: String(row.item_key),
      at: String(row.at),
      actor: typeof row.actor === "string" ? row.actor : null,
      actorName: typeof row.actor_name === "string" ? row.actor_name : "",
      area: row.area,
      action: String(row.action ?? ""),
      subject: String(row.subject ?? ""),
      summary:
        summary && typeof summary === "object" && !Array.isArray(summary) ? (summary as Record<string, unknown>) : {},
      targetExists: row.target_exists === true,
    });
  }
  return { items, older };
}
