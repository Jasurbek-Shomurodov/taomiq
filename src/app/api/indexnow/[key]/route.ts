import { connection } from "next/server";
import { indexNowKey } from "@/lib/indexnow/ping";

/**
 * The IndexNow key file (docs/plans/findability-and-growth.md, slice 2): taomiq.uz/{key}.txt, which next.config.ts
 * rewrites here on the public host. It answers the key as plain text when the path names the key in INDEXNOW_KEY, and
 * 404 for any other name, while the key is unset or invalid, and on the admin host. Read per request, so a key set in
 * Vercel applies with the next deployment and is never baked into a prerender.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/indexnow/[key]">) {
  await connection();
  const key = indexNowKey();
  const { key: asked } = await ctx.params;
  const host = request.headers.get("host") ?? "";
  if (!key || asked !== key || host.startsWith("admin.")) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new Response(key, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": "noindex",
    },
  });
}
