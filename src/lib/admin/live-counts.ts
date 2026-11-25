/**
 * The answer of GET /live-counts on the admin host (src/app/admin/live-counts/route.ts), read by the shell's live
 * updates (src/app/admin/shell/live.tsx). Shared by both sides, so not server-only. Counts only, never personal data.
 *
 *   ok          200  each count is null when this role does not see it, or when that one read failed
 *   failed      503  every count this role sees failed to read (or the session check did): retried with back-off
 *   signed-out  401  no session, or no staff row any more: the caller stops for good
 */
export type LiveCounts =
  | { status: "ok"; newOrders: number | null; pendingRequests: number | null }
  | { status: "failed" }
  | { status: "signed-out" };

export const LIVE_COUNTS_PATH = "/live-counts";

export const LIVE_COUNTS_HTTP_STATUS: Record<LiveCounts["status"], number> = {
  ok: 200,
  failed: 503,
  "signed-out": 401,
};

const isCount = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);

/** The body checked field by field: anything else (an HTML error page, a changed shape) is null. */
export function parseLiveCounts(body: unknown): LiveCounts | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.status === "failed" || record.status === "signed-out") return { status: record.status };
  if (record.status !== "ok" || !isCount(record.newOrders) || !isCount(record.pendingRequests)) return null;
  return { status: "ok", newOrders: record.newOrders, pendingRequests: record.pendingRequests };
}
