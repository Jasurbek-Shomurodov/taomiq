import type { Metadata } from "next";
import shareImage from "@/app/[locale]/opengraph-image.jpg";
import { defaultLocale, htmlLang, locales, ogLocale, type Locale } from "@/i18n/config";
import { site } from "@/lib/site";

/**
 * The share image (1200 × 630). The home page gets it from the file convention
 * (src/app/[locale]/opengraph-image.jpg, twitter-image.jpg); every other page sets its own `openGraph`,
 * which replaces the parent's, so the same file is attached here explicitly. Alt text as in
 * opengraph-image.alt.txt.
 */
const SHARE_IMAGE = {
  url: shareImage.src,
  width: shareImage.width,
  height: shareImage.height,
  alt: "TAOMIQ logo: TQ monogram in a gold ring, premium daily nutrition",
};

type PageMetadataInput = {
  locale: Locale;
  /** Path after the locale: "" for home, "/menu", "/programs/light". */
  path: string;
  title: string;
  description?: string;
  /** false → noindex, follow; no canonical and no hreflang. Defaults to true. */
  index?: boolean;
  /** Use the title as is, without the layout's "%s · TAOMIQ" template (home). */
  absoluteTitle?: boolean;
};

/**
 * Metadata for one public page. Every page under /[locale] builds its metadata here so that
 * canonical, hreflang and Open Graph always describe the page itself, never the home page.
 * Relative URLs resolve against `metadataBase` (site.url) set in the locale layout.
 */
export function pageMetadata({
  locale,
  path,
  title,
  description,
  index = true,
  absoluteTitle = false,
}: PageMetadataInput): Metadata {
  const url = `/${locale}${path}`;

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    ...(index
      ? {
          alternates: {
            canonical: url,
            languages: {
              ...Object.fromEntries(locales.map((l) => [htmlLang[l], `/${l}${path}`])),
              "x-default": `/${defaultLocale}${path}`,
            },
          },
        }
      : { robots: { index: false, follow: true } }),
    openGraph: {
      url,
      title,
      description,
      locale: ogLocale[locale],
      siteName: site.name,
      type: "website",
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [SHARE_IMAGE],
    },
  };
}
