import type { NextRequest } from "next/server";
import { recordAccessRequest } from "@/lib/admin/access";
import { isAdminGoogleLoginOn } from "@/lib/admin/google";
import { rememberStaffLocale } from "@/lib/admin/locale";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Where Google (through Supabase) sends staff back after "Sign in with Google" on the back-office login
 * (signInWithGoogle in src/lib/admin/actions.ts). Served as admin.taomiq.uz/auth/callback: the proxy rewrites
 * every admin-host path under /admin. The customer callback (src/app/auth/callback) is the public host's.
 *
 * Exchanges the one-time code for a session (the PKCE verifier is in a cookie on this host), then checks the
 * staff table: Google never grants access by itself. A Google account with no staff row is recorded as an access
 * request for the owner (src/lib/admin/access.ts) and signed out again on the spot. Redirects stay on the host the request came to (see `to`), which is where the session cookies were set.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // A relative Location (always one of the fixed paths below): the browser resolves it against the admin host it
  // asked for. Not request.nextUrl.origin: after the proxy's rewrite that is the server's own host (localhost under
  // `next start`), which would send staff to the public site. Session cookies set through cookies() are merged into
  // this response by Next.
  const to = (path: "/" | "/login" | "/login?error=google" | "/login?error=not-staff" | "/login?error=requested") =>
    new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });

  if (!isAdminGoogleLoginOn()) return to("/login");

  const code = params.get("code");
  if (!code) {
    // Google or Supabase reports why. A bare access_denied is the person pressing Cancel (no error shown then);
    // with an error_code it is Supabase refusing (sign-ups off, for example), which must not look like a cancel.
    const reason = params.get("error") ?? "";
    const errorCode = params.get("error_code") ?? "";
    if (reason === "access_denied" && !errorCode) return to("/login");
    console.error("admin: Google callback error", reason, errorCode, params.get("error_description") ?? "");
    return to("/login?error=google");
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("admin: Google code exchange failed", error?.code, error?.message);
    return to("/login?error=google");
  }

  // The caller's own staff row (RLS lets a staff member read it). No row: not staff, so no session stays behind.
  const { data: staff, error: staffError } = await supabase
    .from("staff")
    .select("locale")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (staffError) {
    console.error("admin: staff check after Google sign-in failed", staffError.code, staffError.message);
    await supabase.auth.signOut({ scope: "local" });
    return to("/login?error=google");
  }
  if (!staff) {
    // Recorded for the owner to approve (once per account); a declined account just sees "no access".
    const outcome = await recordAccessRequest(data.user);
    await supabase.auth.signOut({ scope: "local" });
    return to(outcome === "requested" ? "/login?error=requested" : "/login?error=not-staff");
  }

  await rememberStaffLocale(staff.locale);
  return to("/");
}
