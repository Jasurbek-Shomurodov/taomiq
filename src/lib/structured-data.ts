/**
 * schema.org builders. They state only what the site itself shows: names, descriptions,
 * catalogue prices and the FAQ text. No ratings, reviews, address or phone until those exist.
 */
import { htmlLang, type Locale } from "@/i18n/config";
import { localized } from "@/lib/data/localized";
import { pricePerDay, type Duration, type Program } from "@/lib/data/types";
import { site } from "@/lib/site";

const CONTEXT = "https://schema.org";
const ORGANIZATION_ID = `${site.url}/#organization`;

export function organizationAndWebsite(locale: Locale, description: string) {
  return {
    "@context": CONTEXT,
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: site.name,
        url: site.url,
        logo: `${site.url}/brand/logo-512.png`,
        sameAs: [site.telegram, site.instagram],
      },
      {
        "@type": "WebSite",
        "@id": `${site.url}/${locale}#website`,
        name: site.name,
        url: `${site.url}/${locale}`,
        description,
        inLanguage: htmlLang[locale],
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  };
}

/**
 * BreadcrumbList from the home page down to the current page. `trail` is the pages after home, each
 * with its name and its path after the locale ("/menu", "/programs/light"); the last one is the page itself.
 */
export function breadcrumbList(locale: Locale, trail: readonly { name: string; path: string }[]) {
  const items = [{ name: site.name, path: "" }, ...trail];
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${site.url}/${locale}${item.path}`,
    })),
  };
}

export function faqPage(items: readonly { q: string; a: string }[], locale: Locale) {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    inLanguage: htmlLang[locale],
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/**
 * A program as a Product (program page). One Offer per calorie level and duration, priced per day
 * exactly as the price table on the page shows it.
 */
export function programProduct(program: Program, durations: Duration[], locale: Locale, kcalWord: string) {
  return { "@context": CONTEXT, ...programProductNode(program, durations, locale, kcalWord) };
}

/**
 * The price list (/prices): every program as the same Product node the program page states, with the same
 * @id and Offers, so search engines read one product per program however many pages list it.
 */
export function programPriceList(
  programs: Program[],
  durations: Duration[],
  locale: Locale,
  kcalWord: string,
  name: string,
) {
  return {
    "@context": CONTEXT,
    "@type": "ItemList",
    name,
    url: `${site.url}/${locale}/prices`,
    itemListElement: programs.map((program, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: programProductNode(program, durations, locale, kcalWord),
    })),
  };
}

function programProductNode(program: Program, durations: Duration[], locale: Locale, kcalWord: string) {
  const url = `${site.url}/${locale}/programs/${program.slug}`;
  const offers = program.variants.flatMap((variant) =>
    durations.map((duration) => {
      const price = pricePerDay(variant.price_per_day, duration.markup_pct);
      return {
        "@type": "Offer",
        name: `${site.name} ${program.name} / ${variant.kcal} ${kcalWord}`,
        price,
        priceCurrency: "UZS",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price,
          priceCurrency: "UZS",
          unitCode: "DAY",
        },
        eligibleQuantity: { "@type": "QuantitativeValue", value: duration.days, unitCode: "DAY" },
        url: `${site.url}/${locale}/order?program=${program.slug}&kcal=${variant.kcal}`,
      };
    }),
  );
  const prices = offers.map((offer) => offer.price);

  return {
    "@type": "Product",
    "@id": `${url}#product`,
    name: `${site.name} ${program.name}`,
    description: localized(program, "description", locale),
    url,
    // The cover photo, only once the owner has uploaded one (src/app/admin/(panel)/programs).
    ...(program.photo_url ? { image: program.photo_url } : {}),
    brand: { "@type": "Brand", name: site.name },
    ...(offers.length > 0 && {
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "UZS",
        lowPrice: Math.min(...prices),
        highPrice: Math.max(...prices),
        offerCount: offers.length,
        offers,
      },
    }),
  };
}
