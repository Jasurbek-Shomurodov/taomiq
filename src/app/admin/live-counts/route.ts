import { isAuthApiError, isAuthSessionMissingError } from "@supabase/supabase-js";
import { connection } from "next/server";
import { pendingRequestCount } from "@/lib/admin/team";
import { LIVE_COUNTS_HTTP_STATUS, type LiveCounts } from "@/lib/admin/live-counts";
import { newOrderCount } from "@/lib/admin/queries";
import { canHandleOrders } from "@/lib/admin/roles";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSessionClient } from "@/lib/supabase/server";

/** The most the server spends on one answer; the browser gives up at 8 s (shell/live.tsx). */
const TIMEOUT_MS = 5000;

/** Never stored by a browser or a CDN: the answer depends on the session. */
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

/**
 * The sidebar counts for the back office's live updates (docs/plans/zarkebab-feature-port.md, slice 10a), served as
 * admin.taomiq.uz/live-counts: the proxy rewrites every admin-host path under /admin, and the public host never
 * reaches /admin/* (a 404 in production; src/proxy.ts), the same as the reports export. A GET route handler, not a
 * Server Action: it is not queued behind the person's own saves, survives a deploy, and does not re-render the page
 * when the session cookies are refreshed (the refreshed cookies go out on this response).
 *
 * The role is decided here, as the pages do: new orders for owners and managers (canHandleOrders), access requests
 * for the owner; RLS returns nothing to anyone else either way. Counts only. The answer shapes and their statuses are
 * in lib/admin/live-counts.ts.
 */
export async function GET(): Promise<Response> {
  // Request time only, never prerendered at build: outside the reads below, whose catch would otherwise take the
  // prerender's stop for a failed read.
  await connection();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<LiveCounts>((resolve) => {
    timer = setTimeout(() => {
      console.error("live counts: timed out");
      resolve({ status: "failed" });
    }, TIMEOUT_MS);
  });
  let result: LiveCounts;
  try {
    result = await Promise.race([readLiveCounts(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
  return Response.json(result, { status: LIVE_COUNTS_HTTP_STATUS[result.status], headers: HEADERS });
}

async function readLiveCounts(): Promise<LiveCounts> {
  if (!isSupabaseConfigured) return { status: "signed-out" };
  try {
    const supabase = await createSessionClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (!user) {
      // No session, or Auth refused it (an expired refresh token, a deleted user): signed out. Auth unreachable,
      // rate-limited or failing on its side is a failed read, retried later.
      const refused =
        isAuthApiError(authError) && authError.status >= 400 && authError.status < 500 && authError.status !== 429;
      if (!authError || isAuthSessionMissingError(authError) || refused) return { status: "signed-out" };
      console.error("live counts: session check failed", authError.message);
      return { status: "failed" };
    }
    const { data: staff, error: staffError } = await supabase
      .from("staff")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (staffError) {
      console.error("live counts: staff check failed", staffError.code);
      return { status: "failed" };
    }
    if (!staff) return { status: "signed-out" };

    const seesOrders = canHandleOrders(staff.role);
    const seesRequests = staff.role === "owner";
    // One failed count does not hide the other: it is null on its own, and only when every count this role sees
    // failed is the whole answer a failure.
    const [orders, requests] = await Promise.allSettled([
      seesOrders ? newOrderCount(supabase) : Promise.resolve(null),
      seesRequests ? pendingRequestCount(supabase) : Promise.resolve(null),
    ]);
    if (orders.status === "rejected") console.error("live counts: new orders failed", message(orders.reason));
    if (requests.status === "rejected") console.error("live counts: access requests failed", message(requests.reason));
    const seen = [...(seesOrders ? [orders] : []), ...(seesRequests ? [requests] : [])];
    if (seen.length > 0 && seen.every((read) => read.status === "rejected")) return { status: "failed" };
    return {
      status: "ok",
      newOrders: orders.status === "fulfilled" ? orders.value : null,
      pendingRequests: requests.status === "fulfilled" ? requests.value : null,
    };
  } catch (error) {
    console.error("live counts: read failed", message(error));
    return { status: "failed" };
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
