import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition } from "react";
import { FaqList } from "@/components/FaqList";
import { Monogram } from "@/components/Logo";
import { MenuDay } from "@/components/MenuDay";
import { PageTransition } from "@/components/PageTransition";
import { HowItWorks, Included } from "@/components/ServiceSections";
import { getDictionary } from "@/i18n";
import { formatSum, isLocale } from "@/i18n/config";
import { getMenuDay, getPrograms, getTodayCycleDay, isDemoCatalog } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { lowestPricePerDay } from "@/lib/data/types";
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
  // While the cook is still filling the cycle, fall back to day 1 so the section is never empty.
  const preview = todayMenu.length > 0 || !featuredVariant ? todayMenu : await getMenuDay(featuredVariant.id, 1);

  return (
    <PageTransition>
      {/* Hero */}
      <section className="bg-forest text-ivory">
        <div className="container-page grid gap-10 py-16 md:grid-cols-[1.3fr_1fr] md:items-center md:py-24">
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
            {minPrice !== null && (
              <p className="mt-6 text-sm text-ivory/70">
                {t.hero.from} <span className="font-semibold text-ivory">{formatSum(minPrice)}</span> {t.hero.perDay}
              </p>
            )}
          </div>

          <div className="hidden justify-self-center md:block" aria-hidden>
            <div className="flex h-72 w-72 items-center justify-center rounded-full border border-gold/40">
              <div className="flex h-56 w-56 items-center justify-center rounded-full border border-gold/70">
                <Monogram size={132} />
              </div>
            </div>
          </div>
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

          {/* Phones: a snap row, each card 85 % wide so the next one peeks in (dots where the browser
              draws ::scroll-marker). From md: the three-column grid. The whole card links to the
              program page; the menu link sits above that. */}
          <ul className="program-row reveal -mx-5 mt-10 flex snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-2 md:mx-0 md:grid md:snap-none md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0 md:pb-0">
            {programs.map((program) => {
              const from = Math.min(...program.variants.map((v) => v.price_per_day));
              return (
                <li
                  key={program.id}
                  className="press relative flex w-[85%] shrink-0 snap-start flex-col rounded-3xl bg-forest p-7 text-ivory md:w-auto"
                >
                  <span className="h-1.5 w-12 rounded-full" style={{ background: program.tag_color }} />
                  <p className="label mt-5 text-ivory/60">TAOMIQ</p>
                  <h3 className="font-serif text-4xl">
                    <Link
                      href={`/${locale}/programs/${program.slug}`}
                      className="after:absolute after:inset-0 after:rounded-3xl after:content-['']"
                    >
                      {/* The name grows into the program page's h1 (globals.css, .program-morph). The span
                          is the named box, so the link's card-wide ::after stays out of the snapshot. */}
                      <ViewTransition name={`program-name-${program.slug}`} share="program-morph" default="none">
                        <span className="inline-block">{program.name}</span>
                      </ViewTransition>
                    </Link>
                  </h3>
                  <p className="mt-1 text-gold">{localized(program, "tagline", locale)}</p>
                  <p className="mt-4 text-sm leading-relaxed text-ivory/75">
                    {localized(program, "description", locale)}
                  </p>

                  <p className="label mt-6 text-ivory/60">{t.programs.levels}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {program.variants.map((variant) => (
                      <span key={variant.id} className="rounded-full border border-ivory/25 px-3 py-1 text-sm tabular-nums">
                        {variant.kcal} {t.programs.kcal}
                      </span>
                    ))}
                  </div>

                  <p className="mt-6 text-sm text-ivory/70">
                    {t.hero.from}{" "}
                    <span className="font-serif text-2xl text-ivory">{formatSum(from)}</span> {t.hero.perDay}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-6">
                    {/* Looks like a button; the tap target is the whole card (the link on the name). */}
                    <span aria-hidden className="btn btn-gold !px-5 !py-2.5 !text-sm">
                      {t.programs.details}
                    </span>
                    <Link
                      href={`/${locale}/menu?program=${program.slug}`}
                      className="btn btn-outline relative z-10 !px-5 !py-2.5 !text-sm text-ivory"
                    >
                      {t.programs.viewMenu}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-sm text-muted">{t.programs.priceNote}</p>
        </div>
      </section>

      {/* Today's menu */}
      {featured && featuredVariant && (
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
          {t.faq.all} <span aria-hidden>→</span>
        </Link>
      </section>

      {/* Final call to action */}
      <section className="bg-ivory-deep py-16 md:py-20">
        <div className="container-page text-center">
          <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">{t.cta.title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">{t.cta.text}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/${locale}/order`} className="btn btn-forest">{t.cta.button}</Link>
            <a href={site.telegram} className="btn btn-outline text-forest" rel="noopener">{t.cta.telegram}</a>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
