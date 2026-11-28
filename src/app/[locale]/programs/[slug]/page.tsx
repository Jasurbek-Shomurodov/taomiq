import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { MenuDay } from "@/components/MenuDay";
import { PageTransition } from "@/components/PageTransition";
import { ProgramLinks } from "@/components/ProgramLinks";
import { ProgramPrices } from "@/components/ProgramPrices";
import { RationLabel } from "@/components/RationLabel";
import { getDictionary } from "@/i18n";
import { isLocale, locales } from "@/i18n/config";
import { getDurations, getMenuDay, getPrograms, isDemoCatalog } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { CYCLE_DAYS, lowestPricePerDay, sumNutrition } from "@/lib/data/types";
import { brandWith, directAnswer, joinWords } from "@/lib/direct-answer";
import { goalsForProgram } from "@/lib/goal-pages";
import { notFoundMetadata, pageMetadata } from "@/lib/seo";
import { programProduct } from "@/lib/structured-data";

/**
 * The whole page must come out of a static render, also for a slug the build did not list. Next then
 * renders an unlisted slug completely before answering, instead of streaming a fallback shell first:
 * a program added in the back office later is rendered (and cached) on its first visit, and an unknown
 * slug reaches notFound() before the response starts, so it is a real 404 rather than a 200.
 */
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  const programs = await getPrograms();
  return locales.flatMap((locale) => programs.map((p) => ({ locale, slug: p.slug })));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/programs/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const program = (await getPrograms()).find((p) => p.slug === slug);
  if (!program) return notFoundMetadata(locale);
  // Keyword copy for the known programs; a program added later in admin uses its own tagline and text.
  const seo = getDictionary(locale).programs.seo[program.slug];
  return pageMetadata({
    locale,
    path: `/programs/${slug}`,
    title: `${program.name} — ${seo?.title ?? localized(program, "tagline", locale)}`,
    description: seo?.description ?? localized(program, "description", locale),
  });
}

export default async function ProgramPage({ params }: PageProps<"/[locale]/programs/[slug]">) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  const [programs, durations] = await Promise.all([getPrograms(), getDurations()]);
  const program = programs.find((p) => p.slug === slug);
  if (!program) notFound();

  const firstVariant = program.variants[0];
  const sample = firstVariant ? await getMenuDay(firstVariant.id, 1) : [];
  const tagline = localized(program, "tagline", locale);
  // The ration label prints the sample day's totals only when that day is complete (every meal of the level).
  const sampleTotals = firstVariant && sample.length >= firstVariant.meals_per_day ? sumNutrition(sample) : undefined;

  const intro = (
    <>
      <span className="block h-1.5 w-12 rounded-full" style={{ background: program.tag_color }} />
      <p className="label mt-5 text-ivory/60">TAOMIQ</p>
      <h1 className="font-serif text-6xl md:text-7xl">
        {/* The home card's program name grows into this heading (globals.css, .program-morph). */}
        <ViewTransition name={`program-name-${program.slug}`} share="program-morph" default="none">
          <span className="inline-block">{program.name}</span>
        </ViewTransition>
      </h1>
      <p className="mt-2 text-xl text-gold">{tagline}</p>
      {/* The direct answer: what, where, levels, the "from" price and how to order (src/lib/direct-answer.ts). */}
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ivory">
        {directAnswer(
          t.answer,
          t.answer.program,
          {
            brand: brandWith(t.answer, [program.name]),
            kind: t.answer.programKinds[program.slug] ?? t.answer.programKind,
            levels: joinWords(
              program.variants.map((v) => String(v.kcal)),
              t.answer.or,
            ),
            kcal: t.programs.kcal,
          },
          lowestPricePerDay([program]),
        )}
      </p>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-ivory/80">
        {localized(program, "description", locale)}
      </p>
      {/* .hero-cta: the phone call-to-action bar waits until this button scrolls away. */}
      <Link href={`/${locale}/order?program=${program.slug}`} className="hero-cta btn btn-gold mt-8">
        {t.nav.cta}
      </Link>
    </>
  );

  return (
    <PageTransition>
      <JsonLd data={programProduct(program, durations, locale, t.programs.kcal)} />
      <section className="bg-forest text-ivory">
        {/* Above the photo on phones too: the hero grid below orders the photo first. */}
        <Breadcrumbs
          locale={locale}
          t={t}
          trail={[
            { name: t.nav.programs, path: "/programs" },
            { name: program.name, path: `/programs/${program.slug}` },
          ]}
          className="container-page pt-6 md:pt-8"
        />
        <div
          className={`container-page grid gap-8 pb-14 pt-6 md:gap-12 md:pb-20 md:pt-10 ${
            program.photo_url || firstVariant ? "md:grid-cols-[1.3fr_1fr] md:items-center" : ""
          }`}
        >
          <div className="md:col-start-1 md:row-start-1">{intro}</div>
          {program.photo_url ? (
            // With a cover photo: above the text on phones, the ration label under it. From md the photo is a tall
            // frame beside the heading with the label overlapping its lower left corner. Phones: the wrapper is
            // display: contents, so the photo and the label are ordered in the hero's own grid.
            <div className="contents md:relative md:col-start-2 md:row-start-1 md:block md:w-full md:max-w-[24rem] md:justify-self-center">
              <div className="relative order-first aspect-[3/2] overflow-hidden rounded-3xl md:order-none md:aspect-[4/5]">
                {/* The largest element of the page: load it at once. */}
                <Image
                  src={program.photo_url}
                  alt={`${program.name} — ${tagline}`}
                  fill
                  sizes="(min-width: 768px) 24rem, 100vw"
                  loading="eager"
                  fetchPriority="high"
                  className="object-cover"
                />
              </div>
              {firstVariant && (
                <RationLabel
                  program={program}
                  variant={firstVariant}
                  totals={sampleTotals}
                  locale={locale}
                  compact
                  className="hero-visual order-last w-full max-w-sm md:absolute md:-bottom-8 md:-left-8 md:w-60"
                />
              )}
            </div>
          ) : (
            firstVariant && (
              // No photo yet: the label fills the right half from md and sits under the text on phones. The h1 stays
              // the largest element.
              <RationLabel
                program={program}
                variant={firstVariant}
                totals={sampleTotals}
                locale={locale}
                className="hero-visual w-full max-w-sm md:col-start-2 md:row-start-1 md:max-w-[22rem] md:justify-self-center"
              />
            )
          )}
        </div>
      </section>

      {/* Prices by calorie level and duration */}
      <section className="container-page py-14 md:py-16">
        <h2 className="font-serif text-4xl text-forest">{t.durations.title}</h2>

        <div className="mt-6">
          <ProgramPrices program={program} durations={durations} locale={locale} t={t} />
        </div>

        {/* The goal pages this program serves */}
        <div className="mt-8 border-t border-line pt-6">
          <p className="label text-muted">{t.goals.forProgram}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {goalsForProgram(program.slug).map((goal) => (
              <li key={goal}>
                <Link
                  href={`/${locale}/goals/${goal}`}
                  className="press inline-flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-sm font-semibold text-forest hover:border-forest"
                >
                  {t.goals.pages[goal].short}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Sample day: left out while day 1 has no dishes (no empty box where the proof should be); the link to the
          full menu stays, and the menu page explains itself. */}
      {firstVariant && sample.length > 0 ? (
        <section className="container-page pb-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label text-muted">
                TAOMIQ {program.name} / {firstVariant.kcal} ·{" "}
                {t.menu.dayOf.replace("{n}", "1").replace("{total}", String(CYCLE_DAYS))}
              </p>
              <h2 className="mt-2 font-serif text-4xl text-forest">{t.menu.title}</h2>
            </div>
            <Link href={`/${locale}/menu?program=${program.slug}`} className="btn btn-outline text-forest">
              {t.menu.full}
            </Link>
          </div>
          <div className="mt-8">
            <MenuDay entries={sample} targetKcal={firstVariant.kcal} locale={locale} t={t} />
          </div>
          {isDemoCatalog && <p className="mt-4 text-sm text-muted">{t.menu.demoNote}</p>}
        </section>
      ) : (
        <div className="container-page pb-16">
          <Link href={`/${locale}/menu?program=${program.slug}`} className="btn btn-outline text-forest">
            {t.menu.full}
          </Link>
        </div>
      )}

      {/* Wayfinding: the sibling programs, then the next steps for a visitor still choosing */}
      <div className="bg-ivory-deep">
        <ProgramLinks
          programs={programs.filter((p) => p.id !== program.id)}
          locale={locale}
          t={t}
          title={t.programs.others}
        />
        <nav aria-labelledby="program-more" className="container-page pb-14 md:pb-16">
          <h2 id="program-more" className="label text-muted">
            {t.goals.moreTitle}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {[
              { href: `/${locale}/programs`, label: t.goals.allPrograms },
              { href: `/${locale}/menu?program=${program.slug}`, label: t.nav.menu },
              { href: `/${locale}/calculator`, label: t.nav.calculator },
              { href: `/${locale}/quiz`, label: t.quiz.short },
            ].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="press inline-flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-sm font-semibold text-forest hover:border-forest"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </PageTransition>
  );
}
