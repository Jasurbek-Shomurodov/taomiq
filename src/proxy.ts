import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, locales } from "@/i18n/config";

/** A request for a file (a dot extension at the end), not a page. */
const FILE_PATH = /\.[a-zA-Z0-9]+$/;

function noindex(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

/**
 * Two sites, one app:
 *  - taomiq.uz        → /[locale]/…  (client site, uz + ru)
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

  // No locale in the path: pick one from the browser, default to Uzbek.
  const accepted = (request.headers.get("accept-language") ?? "").toLowerCase();
  const preferred =
    accepted
      .split(",")
      .map((part) => part.split(";")[0].trim().slice(0, 2))
      .find((code) => (locales as readonly string[]).includes(code)) ?? defaultLocale;

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
