import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";
import { isAccountEnabled } from "@/lib/account/methods";
import { supabaseKey, supabaseUrl } from "@/lib/supabase/env";
import { withoutTrailingSlash } from "@/lib/url-path";

/** How long the proxy waits for Supabase to refresh a customer's session before letting the page render anyway. */
const SESSION_REFRESH_TIMEOUT_MS = 3000;

/** A request for a file (a dot extension at the end), not a page. */
const FILE_PATH = /\.[a-zA-Z0-9]+$/;

function noindex(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

/**
 * The site language for a first visit with no locale in the path, from Accept-Language: the
 * supported language the browser weights highest (q, 1 when absent; q=0 means "not acceptable"),
 * the earlier one on a tie. A language tag cannot tell the two Uzbek scripts apart unless it names
 * the script, so uz-Cyrl → uzc and any other uz → uz (Latin). Once a visitor picks a language, the
 * path carries it and this is not consulted again.
 */
function preferredLocale(acceptLanguage: string): Locale {
  let best: Locale = defaultLocale;
  let bestWeight = 0;
  for (const part of acceptLanguage.toLowerCase().split(",")) {
    const [rawTag, ...params] = part.split(";");
    const tag = rawTag.trim();
    let locale: Locale;
    if (tag === "uz" || tag.startsWith("uz-")) locale = tag.split("-").includes("cyrl") ? "uzc" : "uz";
    else if (tag === "ru" || tag.startsWith("ru-")) locale = "ru";
    else continue;

    const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    const parsed = q ? Number(q.slice(2)) : 1;
    const weight = Number.isFinite(parsed) ? parsed : 1;
    if (weight > bestWeight) {
      best = locale;
      bestWeight = weight;
    }
  }
  return best;
}

/**
 * /[locale]/account and /[locale]/login (pages and their server actions): refresh the customer's Supabase
 * session before the page renders. A Server Component cannot store a refreshed token, so without this an
 * expired access token is refreshed on every visit and never saved, and the single-use refresh token can then
 * sign a returning customer out. The refreshed cookies go both to the page (request) and to the browser
 * (response), with Supabase's no-store headers so a CDN never caches a response that carries a session.
 */
async function refreshSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  // Set once the proxy has answered (also on a timeout): a refresh that finishes later must not change the
  // request or response that are already on their way.
  let done = false;
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        if (done) return;
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Refreshes an expired session (writing the cookies above) and checks the token; the result is not used
    // here: the pages and actions decide access themselves (getCustomer, requireCustomer). Raced against a time
    // limit so an Auth outage cannot hang /login and /account: on a timeout the page renders with the cookies
    // as they came and handles the session itself.
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), SESSION_REFRESH_TIMEOUT_MS);
    });
    if ((await Promise.race([supabase.auth.getClaims(), timedOut])) === "timeout") {
      console.error("proxy: session refresh timed out");
    }
  } catch (error) {
    console.error("proxy: session refresh failed", error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(timer);
    done = true;
  }
  return response;
}

/**
 * Two sites, one app:
 *  - taomiq.uz        → /[locale]/…  (client site, uz + uzc + ru)
 *  - admin.taomiq.uz  → /admin/…     (back office)
 * In development use http://localhost:5555 and http://admin.localhost:5555.
 */
export function proxy(request: NextRequest): NextResponse | Promise<NextResponse> {
  const host = request.headers.get("host") ?? "";
  const { pathname } = request.nextUrl;
  const isAdminHost = host.startsWith("admin.");

  // One URL per page: /uz/menu/ → /uz/menu. Next.js did this itself until skipTrailingSlashRedirect was turned on in
  // next.config.ts for the analytics path (which this proxy never sees on the public host: see the matcher).
  if (pathname.length > 1 && pathname.endsWith("/")) {
    // A plain URL: a clone of nextUrl would put the request's own trailing slash back when it is formatted.
    const url = new URL(request.url);
    // Repeated slashes are collapsed too: //attacker.example/ must not become a protocol-relative Location.
    url.pathname = withoutTrailingSlash(url.pathname);
    return NextResponse.redirect(url, 308);
  }

  if (isAdminHost) {
    // The back office is never indexed: say so in a header on every admin-host response,
    // including files such as /robots.txt that are served as they are (second matcher below).
    if (FILE_PATH.test(pathname)) return noindex(NextResponse.next());
    const url = request.nextUrl.clone();
    url.pathname = `/admin${pathname === "/" ? "" : pathname}`;
    return noindex(NextResponse.rewrite(url));
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    // Local shortcut: localhost:5555/admin → admin.localhost:5555 (admin links are host-relative).
    if (process.env.NODE_ENV === "development") {
      const url = request.nextUrl.clone();
      url.hostname = `admin.${url.hostname}`;
      url.pathname = pathname.slice("/admin".length) || "/";
      return NextResponse.redirect(url);
    }
    // In production the back office is never reachable from the public host.
    return new NextResponse(null, { status: 404 });
  }

  const [, first = "", section] = pathname.split("/");
  if (isLocale(first)) {
    // Only the customer's own pages touch the session; every other page stays cookie-free and static.
    if (isAccountEnabled && (section === "account" || section === "login")) return refreshSession(request);
    return NextResponse.next();
  }

  // The sign-in callback (src/app/auth/callback) has no locale segment: Telegram and Google return
  // there. Skipped only here, on the public host; the admin host rewrites its own /auth/callback under
  // /admin above (src/app/admin/auth/callback, the staff Google sign-in).
  if (first === "auth") return NextResponse.next();

  // No locale in the path: pick one from the browser, default to Uzbek (Latin).
  const preferred = preferredLocale(request.headers.get("accept-language") ?? "");

  const url = request.nextUrl.clone();
  url.pathname = `/${preferred}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Pages on both hosts; files (a dot in the last segment), _next, api and the analytics path are skipped.
    // k7r2 is ANALYTICS_PATH (src/lib/analytics/config.ts): next.config.ts rewrites it to PostHog, and a locale
    // redirect here would break it. A matcher must be a literal, so the name is repeated: change both together.
    "/((?!_next/|api/|k7r2(?:/|$)|.*\\.[a-zA-Z0-9]+$).*)",
    // Files on the admin host only (robots.txt, sitemap.xml, icons), to add X-Robots-Tag.
    // The public host is not matched here, so its files never run the proxy.
    {
      source: "/((?!_next/|api/).*\\.[a-zA-Z0-9]+)",
      has: [{ type: "host", value: "admin\\..*" }],
    },
    // The analytics path on the admin host, where PostHog never runs and next.config.ts does not rewrite it: the
    // proxy sends it under /admin like any admin path (a 404 there), with the noindex header.
    {
      source: "/k7r2/:path*",
      has: [{ type: "host", value: "admin\\..*" }],
    },
  ],
};
