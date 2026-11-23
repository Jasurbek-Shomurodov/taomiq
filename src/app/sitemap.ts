import type { MetadataRoute } from "next";
import { defaultLocale, htmlLang, locales } from "@/i18n/config";
import { CALCULATOR_TOOLS } from "@/lib/calculator";
import { getPrograms } from "@/lib/data/catalog";
import { GOAL_PAGES } from "@/lib/goal-pages";
import { site } from "@/lib/site";

// No `lastModified`: there is no per-page change date to state yet, and a date that
// moves on every deploy teaches crawlers to ignore it.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const programs = await getPrograms();
  const paths = [
    "",
    "/menu",
    ...programs.map((p) => `/programs/${p.slug}`),
    ...GOAL_PAGES.map((goal) => `/goals/${goal}`),
    "/prices",
    "/calculator",
    ...CALCULATOR_TOOLS.map((tool) => `/calculator/${tool}`),
    "/delivery",
    "/faq",
    "/privacy",
  ];

  return paths.flatMap((path) =>
    locales.map((locale) => ({
      url: `${site.url}/${locale}${path}`,
      alternates: {
        languages: {
          ...Object.fromEntries(locales.map((l) => [htmlLang[l], `${site.url}/${l}${path}`])),
          "x-default": `${site.url}/${defaultLocale}${path}`,
        },
      },
    })),
  );
}
