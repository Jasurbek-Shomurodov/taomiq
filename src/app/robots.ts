import type { MetadataRoute } from "next";
import { ANALYTICS_PATH } from "@/lib/analytics/config";
import { site } from "@/lib/site";

/**
 * Search and AI crawlers named on purpose (docs/plans/findability-and-growth.md, slice 2), so allowing them is an
 * explicit choice: OpenAI's search, training and user-triggered agents, Perplexity, Anthropic's crawler and search,
 * Yandex, Google (Google-Extended is the token for Gemini's use), Bing (which also feeds ChatGPT search and Copilot).
 * A crawler follows only the most specific group that names it, so the named group repeats the same disallows.
 */
const NAMED_CRAWLERS = [
  "OAI-SearchBot",
  "GPTBot",
  "ChatGPT-User",
  "PerplexityBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "YandexBot",
  "Googlebot",
  "Google-Extended",
  "Bingbot",
];

/**
 * Never pages: the back office path (404 on this host), the API, the sign-in callback and the analytics path.
 * The order, success and account pages are not blocked here: crawlers must be able to fetch them to see their
 * `noindex` (a blocked URL can still be indexed from links, without its content).
 */
const DISALLOW = ["/admin", "/api/", "/auth/", ANALYTICS_PATH];

/**
 * The public host's robots.txt. The admin host answers its own (src/app/admin/robots.txt/route.ts: everything
 * disallowed), through the rewrite in src/proxy.ts.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: NAMED_CRAWLERS, allow: "/", disallow: DISALLOW },
      { userAgent: "*", allow: "/", disallow: DISALLOW },
    ],
    sitemap: `${site.url}/sitemap.xml`,
  };
}
