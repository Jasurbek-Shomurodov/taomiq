import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FaqList } from "@/components/FaqList";
import { MenuDay } from "@/components/MenuDay";
import { PageTransition } from "@/components/PageTransition";
import { HowItWorks, Included } from "@/components/ServiceSections";
import { getDictionary } from "@/i18n";
import { formatSum, isLocale, locales } from "@/i18n/config";
import { getMenuDay, getPrograms, isDemoCatalog } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import { CYCLE_DAYS, lowestPricePerDay, type MenuEntry, type Program } from "@/lib/data/types";
import { brandWith, directAnswer } from "@/lib/direct-answer";
import { GOAL_PAGES, GOAL_SHARED_FAQ, goalPrograms, isGoalPage } from "@/lib/goal-pages";
import { notFoundMetadata, pageMetadata } from "@/lib/seo";

/**
 * As on the program pages: the whole page comes out of a static render, so an unknown goal reaches
 * notFound() before the response starts and is a real 404, not a 200 with a fallback shell.
 */
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return locales.flatMap((locale) => GOAL_PAGES.map((goal) => ({ locale, goal })));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/goals/[goal]">): Promise<Metadata> {
  const { locale, goal } = await params;
  if (!isLocale(locale)) return {};
  if (!isGoalPage(goal)) return notFoundMetadata(locale);
  const page = getDictionary(locale).goals.pages[goal];
  return pageMetadata({ locale, path: `/goals/${goal}`, title: page.metaTitle, description: page.metaDescription });
}

/**
 * A landing page per goal (weight loss, high protein, balanced, halal) on one template: the goal's program(s)
 * with real levels and prices, a sample day from the menu, how it works, what is included, questions and links
 * to the rest of the site. BreadcrumbList only: the shared questions belong to /faq and its FAQPage data.
 */
export default async function GoalPage({ params }: PageProps<"/[locale]/goals/[goal]">) {
  const { locale, goal } = await params;
  if (!isLocale(locale) || !isGoalPage(goal)) notFound();
  const t = getDictionary(locale);
  const page = t.goals.pages[goal];

  // The page still renders (copy, steps, questions, links) if the catalogue cannot be read.
  let programs: Program[] = [];
  let sample: MenuEntry[] = [];
  try {
    programs = goalPrograms(
      (await getPrograms()).filter((p) => p.variants.length > 0),
      goal,
    );
  } catch (error) {
    console.error("goal page: catalogue unavailable", error);
  }
  // Sample day: the goal's program at its first level, day 1, as on the program page. A goal shown with
  // every program (halal) previews the home page's featured program.
  const featured = programs.length === 1 ? programs[0] : (programs.find((p) => p.slug === "balance") ?? programs[0]);
  const featuredVariant = featured?.variants[0];
  if (featuredVariant) {
    try {
      sample = await getMenuDay(featuredVariant.id, 1);
    } catch (error) {
      console.error("goal page: menu unavailable", error);
    }
  }

  const single = programs.length === 1 ? programs[0] : null;
  const orderHref = `/${locale}/order${single ? `?program=${single.slug}` : ""}`;
  const minPrice = lowestPricePerDay(programs);

  const faq = [
    ...page.faq,
    ...GOAL_SHARED_FAQ[goal].flatMap((id) => t.faq.items.filter((item) => item.id === id)),
  ];

  const links = [
    ...GOAL_PAGES.filter((other) => other !== goal).map((other) => ({
      href: `/${locale}/goals/${other}`,
      label: t.goals.pages[other].short,
    })),
    { href: `/${locale}/programs`, label: t.goals.allPrograms },
    { href: `/${locale}/menu`, label: t.nav.menu },
    { href: `/${locale}/quiz`, label: t.quiz.short },
    { href: `/${locale}/calculator`, label: t.nav.calculator },
    { href: `/${locale}/prices`, label: t.nav.prices },
    { href: `/${locale}/delivery`, label: t.nav.delivery },
  ];

  return (
    <PageTransition>
      <section className="bg-forest text-ivory">
        <div className="hero-enter container-page py-10 md:py-16">
          {/* "Питание по цели" has no page of its own: a plain crumb, left out of the BreadcrumbList data. */}
          <Breadcrumbs
            locale={locale}
            t={t}
            trail={[{ name: t.goals.label }, { name: page.short, path: `/goals/${goal}` }]}
          />
          {/* 30 px on phones: the longest title word ("Сбалансированное") fits a 360 px screen whole. */}
          <h1 className="mt-5 max-w-4xl font-serif text-3xl leading-[1.1] sm:text-5xl md:text-6xl">{page.title}</h1>
          {/* The direct answer: what, where, the "from" price and how to order (src/lib/direct-answer.ts). */}
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ivory/80">
            {directAnswer(t.answer, t.answer.goals[goal], { brand: brandWith(t.answer, programs.map((p) => p.name)) }, minPrice)}
          </p>
          {/* .hero-cta: the phone call-to-action bar waits until these buttons scroll away. */}
          <div className="hero-cta mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Link href={orderHref} className="btn btn-gold w-full sm:w-auto">
              {t.nav.cta}
            </Link>
            <Link
              href={`/${locale}/menu${single ? `?program=${single.slug}` : ""}`}
              className="btn btn-outline w-full text-ivory sm:w-auto"
            >
              {t.hero.secondary}
            </Link>
          </div>
          {minPrice !== null && (
            <p className="mt-6 text-sm text-ivory/70">
              {t.hero.from} <span className="font-semibold text-ivory">{formatSum(minPrice)}</span> {t.hero.perDay}
            </p>
          )}
        </div>
      </section>

      {/* The goal's program, or every program when the goal is true of all of them */}
      {programs.length > 0 && (
        <section className="container-page py-14 md:py-16">
          <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">
            {single ? t.goals.programTitle : t.goals.programsTitle}
          </h2>
          <ul className={`mt-8 grid gap-4 ${single ? "max-w-xl" : "md:grid-cols-3"}`}>
            {programs.map((program) => (
              <li key={program.id} className="flex flex-col rounded-3xl border border-line bg-white p-6">
                <span className="h-1.5 w-12 rounded-full" style={{ background: program.tag_color }} aria-hidden />
                <p className="label mt-5 text-muted">TAOMIQ</p>
                <h3 className="font-serif text-4xl text-forest">{program.name}</h3>
                <p className="mt-1 text-gold-ink">{localized(program, "tagline", locale)}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted">{localized(program, "description", locale)}</p>
                <p className="label mt-5 text-muted">{t.programs.levels}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {program.variants.map((variant) => (
                    <span
                      key={variant.id}
                      className="rounded-full border border-line px-3 py-1 text-sm text-forest tabular-nums"
                    >
                      {variant.kcal} {t.programs.kcal}
                    </span>
                  ))}
                </div>
                <p className="mt-5 text-sm text-muted">
                  {t.hero.from}{" "}
                  <span className="font-serif text-2xl text-forest tabular-nums">
                    {formatSum(lowestPricePerDay([program]) ?? 0)}
                  </span>{" "}
                  {t.hero.perDay}
                </p>
                <div className="mt-auto flex flex-wrap gap-2 pt-6">
                  <Link href={`/${locale}/order?program=${program.slug}`} className="btn btn-gold min-h-11 !px-5 !py-2.5 !text-sm">
                    {t.nav.cta}
                  </Link>
                  <Link
                    href={`/${locale}/programs/${program.slug}`}
                    className="btn btn-outline min-h-11 !px-5 !py-2.5 !text-sm text-forest"
                  >
                    {t.programs.details}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">{t.programs.priceNote}</p>
        </section>
      )}

      {/* Sample day: hidden while the menu for it is empty (no empty state on a landing page) */}
      {featured && featuredVariant && sample.length > 0 && (
        <section className="container-page pb-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label text-muted">
                TAOMIQ {featured.name} / {featuredVariant.kcal} ·{" "}
                {t.menu.dayOf.replace("{n}", "1").replace("{total}", String(CYCLE_DAYS))}
              </p>
              <h2 className="reveal mt-2 font-serif text-4xl text-forest">{t.goals.sampleTitle}</h2>
            </div>
            <Link href={`/${locale}/menu?program=${featured.slug}`} className="btn btn-outline text-forest">
              {t.menu.full}
            </Link>
          </div>
          <div className="mt-8">
            <MenuDay entries={sample} targetKcal={featuredVariant.kcal} locale={locale} t={t} />
          </div>
          {isDemoCatalog && <p className="mt-4 text-sm text-muted">{t.menu.demoNote}</p>}
        </section>
      )}

      <div className="bg-ivory-deep">
        <HowItWorks t={t} />
      </div>

      <Included t={t} />

      <section className="container-page py-16 md:py-20">
        <h2 className="reveal font-serif text-4xl text-forest md:text-5xl">{t.goals.faqTitle}</h2>
        <div className="mt-8">
          <FaqList items={faq} />
        </div>
        <Link href={`/${locale}/faq`} className="btn btn-outline mt-8 text-forest">
          {t.faq.all} <span aria-hidden className="nudge">→</span>
        </Link>
      </section>

      {/* Cross-links: the other goals and the pages every visitor of a goal page looks for next */}
      <nav aria-labelledby="goal-more" className="bg-ivory-deep py-14 md:py-16">
        <div className="container-page">
          <h2 id="goal-more" className="font-serif text-3xl text-forest md:text-4xl">
            {t.goals.moreTitle}
          </h2>
          <ul className="mt-6 flex flex-wrap gap-2">
            {links.map((link) => (
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
        </div>
      </nav>
    </PageTransition>
  );
}
