import { NextResponse, type NextRequest } from "next/server";
import { defaultLocale, isLocale, locales } from "@/i18n/config";

/**
 * Two sites, one app:
 *  - taomiq.uz        → /[locale]/…  (client site, uz + ru)
 *  - admin.taomiq.uz  → /admin/…     (back office)
 * In development use http://localhost:3000 and http://admin.localhost:3000.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const { pathname } = request.nextUrl;
  const isAdminHost = host.startsWith("admin.");

  if (isAdminHost) {
    const url = request.nextUrl.clone();
    url.pathname = `/admin${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  // The back office is never reachable from the public host.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
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
  matcher: ["/((?!_next/|api/|.*\\.[a-zA-Z0-9]+$).*)"],
};
