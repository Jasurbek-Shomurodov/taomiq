import "server-only";
import { site } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * Google sign-in on the back-office login: on only when ADMIN_GOOGLE_LOGIN is "on" and Supabase is connected.
 * Server-only and separate from NEXT_PUBLIC_AUTH_METHODS (customer sign-in), so the back office can use Google
 * before customer accounts open. When off, the login page shows no Google button and both the start action
 * (signInWithGoogle) and the callback (src/app/admin/auth/callback) refuse. Read at call time, not at build.
 */
export function isAdminGoogleLoginOn(): boolean {
  return isSupabaseConfigured && process.env.ADMIN_GOOGLE_LOGIN?.trim().toLowerCase() === "on";
}

/**
 * Where Google (through Supabase) sends staff back: the admin host + /auth/callback, which the proxy rewrites to
 * /admin/auth/callback. Built from the configured site URL (https://taomiq.uz → https://admin.taomiq.uz,
 * http://localhost:5555 → http://admin.localhost:5555), never from the request's Host header. It must be the
 * admin host: the PKCE code verifier cookie is set there by the start action.
 */
export function adminGoogleCallbackUrl(): string {
  const url = new URL(site.url);
  url.hostname = `admin.${url.hostname}`;
  return new URL("/auth/callback", url.origin).toString();
}
