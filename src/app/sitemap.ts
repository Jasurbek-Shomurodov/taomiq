import type { MetadataRoute } from "next";
import { defaultLocale, htmlLang, locales } from "@/i18n/config";
import { getDishesLastModified, getPrograms } from "@/lib/data/catalog";
import { GOAL_PAGES } from "@/lib/goal-pages";
import { site } from "@/lib/site";

// `lastModified` only where the database records a real change time: /menu, from the dishes' updated_at. Programs,
// prices and settings have no change time, so their pages state none; a date that moves on every deploy ("now")
// teaches crawlers to ignore it.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const programs = await getPrograms();
  let dishesChanged: string | null = null;
  try {
    dishesChanged = await getDishesLastModified();
  } catch (error) {
    console.error("sitemap: dishes date unavailable", error);
  }
  const lastModified: Record<string, string | null> = { "/menu": dishesChanged };
  const paths = [
    "",
    "/menu",
    "/programs",
    ...programs.map((p) => `/programs/${p.slug}`),
    ...GOAL_PAGES.map((goal) => `/goals/${goal}`),
    "/prices",
    "/quiz",
    "/calculator",
    "/delivery",
    "/faq",
    "/privacy",
  ];

  return paths.flatMap((path) =>
    locales.map((locale) => ({
      url: `${site.url}/${locale}${path}`,
      ...(lastModified[path] ? { lastModified: lastModified[path] } : {}),
      alternates: {
        languages: {
          ...Object.fromEntries(locales.map((l) => [htmlLang[l], `${site.url}/${l}${path}`])),
          "x-default": `${site.url}/${defaultLocale}${path}`,
        },
      },
    })),
  );
}
