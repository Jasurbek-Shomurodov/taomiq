import type { Metadata, Viewport } from "next";
import { Manrope, Noto_Serif_Display } from "next/font/google";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { Footer, Header } from "@/components/SiteChrome";
import { getDictionary } from "@/i18n";
import { isLocale, locales } from "@/i18n/config";
import { site } from "@/lib/site";
import { organizationAndWebsite } from "@/lib/structured-data";
import "../globals.css";

const serif = Noto_Serif_Display({
  variable: "--font-noto-serif-display",
  subsets: ["latin", "latin-ext", "cyrillic"],
  weight: ["400", "500"],
  display: "swap",
});

const sans = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext", "cyrillic"],
  display: "swap",
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = { themeColor: "#183C34" };

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
      locale: locale === "ru" ? "ru_UZ" : "uz_UZ",
      type: "website",
    },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  return (
    <html lang={locale} className={`${serif.variable} ${sans.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <JsonLd data={organizationAndWebsite(locale, t.meta.description)} />
        <Header locale={locale} t={t} />
        <main className="flex-1">{children}</main>
        <Footer locale={locale} t={t} />
      </body>
    </html>
  );
}
