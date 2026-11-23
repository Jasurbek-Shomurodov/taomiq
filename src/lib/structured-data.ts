/**
 * schema.org builders. They state only what the site itself shows: names, descriptions,
 * catalogue prices and the FAQ text. No ratings, reviews, address or phone until those exist.
 */
import type { Locale } from "@/i18n/config";
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
        sameAs: [site.telegram, site.instagram],
      },
      {
        "@type": "WebSite",
        "@id": `${site.url}/${locale}#website`,
        name: site.name,
        url: `${site.url}/${locale}`,
        description,
        inLanguage: locale,
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  };
}

export function faqPage(items: readonly { q: string; a: string }[], locale: Locale) {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    inLanguage: locale,
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/**
 * A program as a Product. One Offer per calorie level and duration, priced per day
 * exactly as the price table on the page shows it.
 */
export function programProduct(program: Program, durations: Duration[], locale: Locale, kcalWord: string) {
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
    "@context": CONTEXT,
    "@type": "Product",
    name: `${site.name} ${program.name}`,
    description: locale === "ru" ? program.description_ru : program.description_uz,
    url,
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
