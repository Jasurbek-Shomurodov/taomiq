/**
 * admin.taomiq.uz/robots.txt (src/proxy.ts rewrites it here): the back office is never crawled. Every admin response
 * also carries X-Robots-Tag: noindex (the proxy), and every page needs a sign-in. Static: it never changes. On the
 * public host /admin/* is a 404, so this is never served there.
 */
export function GET() {
  return new Response("User-Agent: *\nDisallow: /\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
