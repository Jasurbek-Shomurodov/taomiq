import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale } from "@/i18n/config";
import { isAccountEnabled, safeNext } from "@/lib/account/methods";
import { syncProfile } from "@/lib/account/profile";
import { createSessionClient } from "@/lib/supabase/server";

/**
 * Where Telegram and Google send the customer back (public host only: on the admin host the proxy
 * rewrites every path under /admin, where this route does not exist). Exchanges the one-time code for a
 * session (the PKCE verifier is in a cookie set by startOAuth), syncs the profile, then goes on to
 * `next`. Redirects stay on the host the request came to, which is where the session cookies were set.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawLocale = params.get("locale") ?? "";
  const locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const next = safeNext(params.get("next"), locale);
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);

  if (!isAccountEnabled) return to(`/${locale}`);

  const loginError = (error: "failed" | "cancelled") =>
    to(`/${locale}/login?error=${error}&next=${encodeURIComponent(next)}`);

  const code = params.get("code");
  if (!code) {
    // The provider or Supabase reports why (access_denied when the customer pressed Cancel).
    const reason = params.get("error") ?? "";
    if (reason && reason !== "access_denied") {
      console.error("account: OAuth callback error", reason, params.get("error_description") ?? "");
    }
    return loginError(reason === "access_denied" ? "cancelled" : "failed");
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("account: code exchange failed", error?.code, error?.message);
    return loginError("failed");
  }

  await syncProfile(data.user.id, locale);
  return to(next);
}
