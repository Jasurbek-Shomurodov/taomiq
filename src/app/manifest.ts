import type { MetadataRoute } from "next";
import { defaultLocale, htmlLang } from "@/i18n/config";
import { getDictionary } from "@/i18n";
import { site } from "@/lib/site";

/** Web app manifest (/manifest.webmanifest): name, brand colours and the icons in src/app. */
export default function manifest(): MetadataRoute.Manifest {
  const t = getDictionary(defaultLocale);
  return {
    name: site.name,
    short_name: site.name,
    description: t.meta.description,
    lang: htmlLang[defaultLocale],
    // The root picks the site language from the browser language (src/proxy.ts).
    start_url: "/",
    scope: "/",
    display: "browser",
    theme_color: "#183C34",
    background_color: "#F6F1E8",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
