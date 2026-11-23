import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

// Order pages are not blocked here: crawlers must be able to fetch them to see their `noindex`.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin"] }],
    sitemap: `${site.url}/sitemap.xml`,
  };
}
