import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { ProgramPrices } from "@/components/ProgramPrices";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { getDurations, getPrograms } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { lowestPricePerDay, trialAtWeekPrice, type Duration, type Program } from "@/lib/data/types";
import { directAnswer } from "@/lib/direct-answer";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { breadcrumbList, programPriceList } from "@/lib/structured-data";

export async function generateMetadata({ params }: PageProps<"/[locale]/prices">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({ locale, path: "/prices", title: t.prices.metaTitle, description: t.prices.metaDescription });
}

/**
 * Every program × calorie level × order length from the catalogue: the price per day and the total for the
 * period, built by the same component as the program page's price table (ProgramPrices), so the figures can
 * never differ from the program pages or the order form.
 */
export default async function PricesPage({ params }: PageProps<"/[locale]/prices">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // The page still renders (heading, rules, Telegram) if the catalogue cannot be read.
  let programs: Program[] = [];
  let durations: Duration[] = [];
  try {
    [programs, durations] = await Promise.all([getPrograms(), getDurations()]);
  } catch (error) {
    console.error("prices page: catalogue unavailable", error);
  }
  const listed = durations.length > 0 ? programs.filter((p) => p.variants.length > 0) : [];

  // The price rules as the site already states them (order form, delivery page, "included" list).
  // Where the trial costs the same per day as a week, that is a rule too: the trial is not a discount.
  const rules = [
    t.prices.perDayRule,
    t.order.daysNote,
    ...(trialAtWeekPrice(durations) ? [t.durations.trialSamePrice] : []),
    t.delivery.priceText,
    t.prices.samePrice,
  ];

  return (
    <PageTransition>
      {listed.length > 0 && (
        <JsonLd data={programPriceList(listed, durations, locale, t.programs.kcal, t.prices.title)} />
      )}
      <JsonLd data={breadcrumbList(locale, [{ name: t.prices.title, path: "/prices" }])} />
      <section className="bg-forest text-ivory">
        <div className="container-page py-12 md:py-16">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-4xl md:text-6xl">{t.prices.title}</h1>
          <p className="mt-3 max-w-2xl text-lg text-ivory/80">
            {directAnswer(t.answer, t.answer.prices, { brand: "TAOMIQ" }, lowestPricePerDay(listed))}
          </p>
          <ul className="mt-6 grid max-w-2xl gap-2 text-ivory/80">
            {rules.map((rule) => (
              <li key={rule} className="flex gap-3">
                <span className="mt-3 h-px w-4 shrink-0 bg-gold" aria-hidden />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {listed.length > 0 ? (
        <div className="container-page grid gap-14 py-12 md:gap-16 md:py-16">
          {listed.map((program) => (
            <section key={program.id} aria-labelledby={`prices-${program.slug}`}>
              <span className="block h-1.5 w-12 rounded-full" style={{ background: program.tag_color }} aria-hidden />
              <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div>
                  <h2 id={`prices-${program.slug}`} className="font-serif text-4xl text-forest">
                    TAOMIQ {program.name}
                  </h2>
                  <p className="mt-1 text-gold-ink">{localized(program, "tagline", locale)}</p>
                </div>
                <Link
                  href={`/${locale}/programs/${program.slug}`}
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-forest underline decoration-gold underline-offset-4"
                >
                  {t.programs.details} <span aria-hidden>&nbsp;→</span>
                </Link>
              </div>
              <div className="mt-6">
                <ProgramPrices program={program} durations={durations} locale={locale} t={t} />
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="container-page py-14 text-center md:py-20">
          <p className="mx-auto max-w-xl text-lg text-muted">{t.order.empty}</p>
          <a href={site.telegram} className="btn btn-forest mt-6" rel="noopener">
            {t.order.telegram}
          </a>
        </section>
      )}
    </PageTransition>
  );
}
