import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FaqList } from "@/components/FaqList";
import { MenuDay } from "@/components/MenuDay";
import { PageTransition } from "@/components/PageTransition";
import { ProgramCards } from "@/components/ProgramCards";
import { RationLabel } from "@/components/RationLabel";
import { HowItWorks, Included } from "@/components/ServiceSections";
import { getDictionary } from "@/i18n";
import { formatSum, isLocale } from "@/i18n/config";
import { getDurations, getMenuDay, getPrograms, getTodayCycleDay, isDemoCatalog } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { lowestPricePerDay, sumNutrition, trialAtWeekPrice } from "@/lib/data/types";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({
    locale,
    path: "",
    title: t.meta.title,
    description: t.meta.description,
    absoluteTitle: true,
  });
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  const programs = await getPrograms();
  const minPrice = lowestPricePerDay(programs);

  // "Today's menu" preview: the middle program at its first calorie level.
  const featured = programs.find((p) => p.slug === "balance") ?? programs[0];
  const featuredVariant = featured?.variants[0];
  const today = await getTodayCycleDay();
  const todayMenu = featuredVariant ? await getMenuDay(featuredVariant.id, today) : [];
  // While the cook is still filling the cycle, fall back to day 1. With no dishes on either day the section is left
  // out: an empty box where the proof should be says less than nothing.
  const preview = todayMenu.length > 0 || !featuredVariant ? todayMenu : await getMenuDay(featuredVariant.id, 1);
  // The hero's ration label carries that day's totals only when the day is complete (every meal of the level is
  // on the menu): a half-filled day would print a total the customer never gets.
  const previewTotals =
    featuredVariant && preview.length >= featuredVariant.meals_per_day ? sumNutrition(preview) : undefined;

  // The final call to action invites a trial: where the trial costs the same per day as a week, it says so, so the
  // trial never reads like a discount. Left out if the durations cannot be read.
  let trialNote = "";
  try {
    if (trialAtWeekPrice(await getDurations())) trialNote = t.durations.trialSamePrice;
  } catch (error) {
    console.error("home: durations unavailable", error);
  }

  return (
    <PageTransition>
      {/* Hero */}
      <section className="bg-forest text-ivory">
        <div
          className={`container-page grid gap-10 py-16 md:items-center md:py-24 ${featuredVariant ? "md:grid-cols-[1.3fr_1fr]" : ""}`}
        >
          <div className="hero-enter">
            <p className="label text-gold">{t.hero.eyebrow}</p>
            <h1 className="mt-5 font-serif text-5xl leading-[1.05] sm:text-6xl md:text-7xl">
              {t.hero.title}
              <br />
              <span className="text-gold">{t.hero.titleAccent}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg font-semibold leading-snug text-ivory sm:text-xl">{t.hero.subtitle}</p>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-ivory/80">{t.hero.lead}</p>
            {/* .hero-cta: the phone call-to-action bar waits until these buttons scroll away. */}
            <div className="hero-cta mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link href={`/${locale}/order`} className="btn btn-gold w-full sm:w-auto">{t.hero.cta}</Link>
              <Link href={`/${locale}/menu`} className="btn btn-outline w-full text-ivory sm:w-auto">
                {t.hero.secondary}
              </Link>
            </div>
            <p className="mt-4 text-sm text-ivory/70">
              {t.quiz.teaser}{" "}
              <Link
                href={`/${locale}/quiz`}
                className="link inline-flex min-h-11 items-center font-semibold text-gold sm:min-h-0"
              >
                {t.quiz.teaserLink}&nbsp;<span aria-hidden className="nudge">→</span>
              </Link>
            </p>
            {minPrice !== null && (
              <p className="mt-6 text-sm text-ivory/70">
                {t.hero.from} <span className="font-semibold text-ivory">{formatSum(minPrice)}</span> {t.hero.perDay}
              </p>
            )}
          </div>

          {/* The product instead of a logo: the BALANCE ration's packaging label at its first calorie level, the
              same level as "Today's menu" below, so the day's totals on it are that menu's. Phones: under the
              buttons, never above them. */}
          {featured && featuredVariant &&
            (featured.photo_url ? (
              // With the program's cover photo: a tall frame with the label overlapping its lower left corner (from
              // md). On phones the photo alone, at most 320 px tall.
              <div className="hero-visual relative md:w-full md:max-w-[24rem] md:justify-self-center">
                <div className="relative h-80 overflow-hidden rounded-3xl md:aspect-[4/5] md:h-auto">
                  {/* The largest element of the page: load it at once. */}
                  <Image
                    src={featured.photo_url}
                    alt={`${featured.name} — ${localized(featured, "tagline", locale)}`}
                    fill
                    sizes="(min-width: 768px) 24rem, 100vw"
                    loading="eager"
                    fetchPriority="high"
                    className="object-cover"
                  />
                </div>
                <RationLabel
                  program={featured}
                  variant={featuredVariant}
                  totals={previewTotals}
                  locale={locale}
                  compact
                  className="absolute -bottom-8 -left-8 hidden w-60 md:block"
                />
              </div>
            ) : (
              // No photo yet: the label stands alone. The h1 stays the largest element.
              <RationLabel
                program={featured}
                variant={featuredVariant}
                totals={previewTotals}
                locale={locale}
                className="hero-visual w-full max-w-sm md:max-w-[22rem] md:justify-self-center"
              />
            ))}
        </div>

        <ul className="container-page grid gap-px border-t border-ivory/10 sm:grid-cols-2 lg:grid-cols-4">
          {t.pillars.map((pillar) => (
            <li key={pillar.title} className="py-6 pr-6">
              <p className="label text-gold">{pillar.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-ivory/75">{pillar.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <HowItWorks t={t} id="how" />

      {/* Programs */}
      <section id="programs" className="scroll-mt-20 lg:scroll-mt-28 bg-ivory-deep py-16 md:py-20">
        <div className="container-page">
          <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">{t.programs.title}</h2>
          <p className="mt-3 max-w-2xl text-muted">{t.programs.lead}</p>

          <ProgramCards programs={programs} locale={locale} t={t} />
          <p className="mt-4 text-sm text-muted">{t.programs.priceNote}</p>
        </div>
      </section>

      {/* Today's menu */}
      {featured && featuredVariant && preview.length > 0 && (
        <section className="container-page py-16 md:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label text-muted">
                TAOMIQ {featured.name} / {featuredVariant.kcal}
              </p>
              <h2 className="reveal mt-2 font-serif text-4xl text-forest md:text-5xl">{t.menu.today}</h2>
            </div>
            <Link href={`/${locale}/menu`} className="btn btn-outline text-forest">{t.menu.full}</Link>
          </div>
          <div className="mt-8">
            <MenuDay entries={preview} targetKcal={featuredVariant.kcal} locale={locale} t={t} />
          </div>
          {isDemoCatalog && <p className="mt-4 text-sm text-muted">{t.menu.demoNote}</p>}
        </section>
      )}

      <Included t={t} />

      {/* FAQ */}
      {/* The FAQPage structured data lives on /faq, the page that owns the questions. */}
      <section id="faq" className="container-page scroll-mt-20 lg:scroll-mt-28 py-16 md:py-20">
        <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">{t.faq.title}</h2>
        <div className="mt-8">
          <FaqList items={t.faq.items} />
        </div>
        <Link href={`/${locale}/faq`} className="btn btn-outline mt-8 text-forest">
          {t.faq.all} <span aria-hidden className="nudge">→</span>
        </Link>
      </section>

      {/* Final call to action */}
      <section className="bg-ivory-deep py-16 md:py-20">
        <div className="container-page text-center">
          <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">{t.cta.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">
            {t.cta.text}
            {trialNote && ` ${trialNote}`}
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/${locale}/order`} className="btn btn-forest">{t.cta.button}</Link>
            <a href={site.telegram} className="btn btn-outline text-forest" rel="noopener">{t.cta.telegram}</a>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
