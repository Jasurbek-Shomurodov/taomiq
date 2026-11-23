import type { MetadataRoute } from "next";
import { locales } from "@/i18n/config";
import { getPrograms } from "@/lib/data/catalog";
import { site } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const programs = await getPrograms();
  const paths = ["", "/menu", ...programs.map((p) => `/programs/${p.slug}`)];

  return paths.flatMap((path) =>
    locales.map((locale) => ({
      url: `${site.url}/${locale}${path}`,
      alternates: {
        languages: Object.fromEntries(locales.map((l) => [l, `${site.url}/${l}${path}`])),
      },
    })),
  );
}
