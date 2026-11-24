import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition } from "react";
import { JsonLd } from "@/components/JsonLd";
import { MenuDay } from "@/components/MenuDay";
import { PageTransition } from "@/components/PageTransition";
import { ProgramPrices } from "@/components/ProgramPrices";
import { getDictionary } from "@/i18n";
import { isLocale, locales } from "@/i18n/config";
import { getDurations, getMenuDay, getPrograms, isDemoCatalog } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { goalsForProgram } from "@/lib/goal-pages";
import { pageMetadata } from "@/lib/seo";
import { breadcrumbList, programProduct } from "@/lib/structured-data";

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
  if (!program) return {};
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
  const subtitle = t.programs.seo[program.slug]?.subtitle;
  const sample = firstVariant ? await getMenuDay(firstVariant.id, 1) : [];
  const tagline = localized(program, "tagline", locale);

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
      {subtitle && <p className="mt-4 max-w-2xl text-lg font-semibold leading-snug text-ivory">{subtitle}</p>}
      <p className={`${subtitle ? "mt-3" : "mt-5"} max-w-2xl text-lg leading-relaxed text-ivory/80`}>
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
      <JsonLd data={breadcrumbList(locale, [{ name: program.name, path: `/programs/${program.slug}` }])} />
      <section className="bg-forest text-ivory">
        {program.photo_url ? (
          // With a cover photo: above the text on phones, beside the heading from md.
          <div className="container-page grid gap-8 py-14 md:grid-cols-[1.3fr_1fr] md:items-center md:gap-12 md:py-20">
            <div className="relative aspect-[3/2] overflow-hidden rounded-3xl md:order-last">
              {/* The largest element of the page: load it at once. */}
              <Image
                src={program.photo_url}
                alt={`${program.name} — ${tagline}`}
                fill
                sizes="(min-width: 768px) 45vw, 100vw"
                loading="eager"
                fetchPriority="high"
                className="object-cover"
              />
            </div>
            <div>{intro}</div>
          </div>
        ) : (
          <div className="container-page py-14 md:py-20">{intro}</div>
        )}
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

      {/* Sample day */}
      {firstVariant && (
        <section className="container-page pb-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label text-muted">
                TAOMIQ {program.name} / {firstVariant.kcal} · {t.menu.day} 1
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
      )}
    </PageTransition>
  );
}
