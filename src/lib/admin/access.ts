import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSecretClient, isOrderingConfigured } from "@/lib/supabase/secret";

/** What the login page tells someone who signed in without a staff row: "request sent" or the old "no access". */
export type AccessOutcome = "requested" | "declined";

const EMAIL_MAX = 320;
const NAME_MAX = 80;
/** Anyone with a Google account can reach this path: past this many waiting requests, no more are stored. */
const PENDING_CAP = 200;

/** The display name from the provider (Google: full_name, else name). Only a label for the owner. */
function displayName(user: User): string {
  const metadata = user.user_metadata ?? {};
  for (const key of ["full_name", "name"]) {
    const value = metadata[key];
    // Cut by code points, not UTF-16 units: a split surrogate pair would fail the insert.
    if (typeof value === "string" && value.trim()) return Array.from(value.trim()).slice(0, NAME_MAX).join("");
  }
  return "";
}

/**
 * Records a back-office access request for a signed-in account that has no staff row (once per account), for
 * the owner to approve or decline (migration 0008, the Team screen). Called by both sign-in paths right before
 * they sign the session out: the Google callback (src/app/admin/auth/callback) and the password signIn action.
 * Not by requireStaff(), which runs on every panel render.
 *
 * Email and name come from the verified session user, never from the request. Written with the secret key:
 * clients cannot insert into staff_requests. A declined account stays declined (nothing is re-opened).
 *
 * Never throws. Any failure is logged (codes only: the email is personal data and never goes into logs) and
 * returns "declined", which shows the old "no access, contact the owner" text.
 */
export async function recordAccessRequest(user: User): Promise<AccessOutcome> {
  try {
    if (!isOrderingConfigured) {
      console.error("admin: SUPABASE_SECRET_KEY is not set; access request not recorded");
      return "declined";
    }
    // Only a confirmed email identifies the account to the owner.
    if (!user.email_confirmed_at) return "declined";
    const email = (user.email ?? "").trim();
    if (!email || email.length > EMAIL_MAX) return "declined";

    const admin = createSecretClient();

    const { data: existing, error: readError } = await admin
      .from("staff_requests")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) {
      console.error("admin: access request read failed", readError.code, readError.message);
      return "declined";
    }
    if (existing) return existing.status === "pending" ? "requested" : "declined";

    const { count, error: countError } = await admin
      .from("staff_requests")
      .select("user_id", { count: "exact", head: true })
      .eq("status", "pending");
    if (countError) {
      console.error("admin: access request count failed", countError.code, countError.message);
      return "declined";
    }
    if ((count ?? 0) >= PENDING_CAP) {
      console.error("admin: access request not recorded, pending cap reached");
      return "declined";
    }

    // on conflict (user_id) do nothing: a second sign-in at the same moment cannot overwrite the first row.
    const { error: insertError } = await admin
      .from("staff_requests")
      .upsert({ user_id: user.id, email, name: displayName(user) }, { onConflict: "user_id", ignoreDuplicates: true });
    if (insertError) {
      console.error("admin: access request insert failed", insertError.code, insertError.message);
      return "declined";
    }
    return "requested";
  } catch (error) {
    console.error("admin: access request failed", error instanceof Error ? error.message : "unknown error");
    return "declined";
  }
}
