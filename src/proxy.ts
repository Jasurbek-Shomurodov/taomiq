import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";

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
 * Two sites, one app:
 *  - taomiq.uz        → /[locale]/…  (client site, uz + uzc + ru)
 *  - admin.taomiq.uz  → /admin/…     (back office)
 * In development use http://localhost:5555 and http://admin.localhost:5555.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const { pathname } = request.nextUrl;
  const isAdminHost = host.startsWith("admin.");

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

  const first = pathname.split("/")[1] ?? "";
  if (isLocale(first)) return NextResponse.next();

  // No locale in the path: pick one from the browser, default to Uzbek (Latin).
  const preferred = preferredLocale(request.headers.get("accept-language") ?? "");

  const url = request.nextUrl.clone();
  url.pathname = `/${preferred}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Pages on both hosts; files (a dot in the last segment), _next and api are skipped.
    "/((?!_next/|api/|.*\\.[a-zA-Z0-9]+$).*)",
    // Files on the admin host only (robots.txt, sitemap.xml, icons), to add X-Robots-Tag.
    // The public host is not matched here, so its files never run the proxy.
    {
      source: "/((?!_next/|api/).*\\.[a-zA-Z0-9]+)",
      has: [{ type: "host", value: "admin\\..*" }],
    },
  ],
};
