import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { Manrope, Noto_Serif_Display, Onest } from "next/font/google";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { MobileCtaBar } from "@/components/MobileCtaBar";
import { Footer, Header } from "@/components/SiteChrome";
import { getDictionary } from "@/i18n";
import { htmlLang, isLocale, locales, ogLocale, type Locale } from "@/i18n/config";
import { getPrograms } from "@/lib/data/catalog";
import { lowestPricePerDay, type Program } from "@/lib/data/types";
import { site } from "@/lib/site";
import { organizationAndWebsite } from "@/lib/structured-data";
import "../globals.css";

// `subsets` only picks the files that are preloaded; every subset's @font-face is still in the CSS, so a letter outside
// them loads its file on demand (unicode-range). Preloaded: latin (Uzbek Latin, ʻ included) and cyrillic (Russian, and
// the Ў of Cyrillic Uzbek). Not latin-ext: no page's text needs it, and the serif's latin-ext file alone was 170 KB.
// Cyrillic stays preloaded on the Uzbek Latin pages too: next/font preloads per layout file, not per locale, and two of
// the three languages draw their h1 (the LCP) in it. The TQ monogram is an SVG path (components/Logo.tsx), so no 800.
const serif = Noto_Serif_Display({
  variable: "--font-noto-serif-display",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  display: "swap",
});

const sans = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

// Manrope has no Қ Ғ Ҳ (nor the ʻ of Latin Uzbek). Onest, a grotesque with nearly the same
// proportions, draws just those letters on Cyrillic Uzbek pages. It is in the font stack only on
// those pages and is not preloaded: the browser fetches its files by unicode-range when needed.
const uzbekLetters = Onest({
  subsets: ["cyrillic-ext"],
  preload: false,
  display: "swap",
});

/**
 * The sans stack per language. For Cyrillic Uzbek, Onest goes right after Manrope and before
 * Manrope's metric-matched system fallback (Arial), so a missing letter never comes from Arial.
 */
function sansOverride(locale: Locale): CSSProperties | undefined {
  if (locale !== "uzc") return undefined;
  const families = (font: { style: { fontFamily: string } }) => font.style.fontFamily.split(",").map((f) => f.trim());
  const [manrope, ...manropeFallbacks] = families(sans);
  const [onest] = families(uzbekLetters); // without Onest's own Arial fallback: Manrope's metrics apply
  const stack = [manrope, onest, ...manropeFallbacks, "system-ui", "sans-serif"].join(", ");
  return { "--font-sans": stack } as CSSProperties;
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// viewport-fit=cover lets the page use the full screen on notched phones; .container-page
// pads by the safe-area insets so nothing sits under the notch.
export const viewport: Viewport = { themeColor: "#183C34", viewportFit: "cover" };

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  // Site-wide defaults only. Canonical, hreflang and page Open Graph come from each page
  // (src/lib/seo.ts), so a page that forgets them never canonicalises to the home page.
  return {
    metadataBase: new URL(site.url),
    title: { default: t.meta.title, template: "%s · TAOMIQ" },
    description: t.meta.description,
    openGraph: {
      siteName: site.name,
      locale: ogLocale[locale],
      type: "website",
    },
    verification: siteVerification(),
  };
}

/**
 * Search Console, Yandex Webmaster and Bing Webmaster Tools ownership tags, from the environment (each unset or empty
 * value leaves its tag out). On the public site only: the admin layout never states them. Read at build time, when
 * this layout is prerendered, so a changed value applies with the next deployment.
 */
function siteVerification(): Metadata["verification"] {
  const value = (name: string) => process.env[name]?.trim() || undefined;
  const google = value("GOOGLE_SITE_VERIFICATION");
  const yandex = value("YANDEX_VERIFICATION");
  const bing = value("BING_SITE_VERIFICATION");
  if (!google && !yandex && !bing) return undefined;
  return { google, yandex, ...(bing ? { other: { "msvalidate.01": bing } } : {}) };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // The footer's program links and the phone bar's "from" price. The chrome still renders without them.
  let programs: Program[] = [];
  try {
    programs = await getPrograms();
  } catch (error) {
    console.error("layout: catalogue unavailable", error);
  }

  return (
    // data-scroll-behavior: globals.css scrolls smoothly (in-page anchors); this tells Next to jump, not glide,
    // to the top of a new page. Without it the new page lands 1–2 screens of smooth scrolling later, after the
    // page transition has measured it, and the program-name morph finds no heading on screen to pair with.
    <html
      data-scroll-behavior="smooth"
      lang={htmlLang[locale]}
      className={`${serif.variable} ${sans.variable} antialiased`}
      style={sansOverride(locale)}
    >
      <body className="flex min-h-dvh flex-col">
        <JsonLd data={organizationAndWebsite(locale, t.meta.description)} />
        <Header locale={locale} t={t} />
        <main className="flex-1">{children}</main>
        <Footer locale={locale} t={t} programs={programs} />
        <MobileCtaBar
          locale={locale}
          fromPrice={lowestPricePerDay(programs)}
          labels={{ cta: t.nav.cta, from: t.hero.from, perDay: t.hero.perDay }}
        />
      </body>
    </html>
  );
}
