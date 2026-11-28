import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, ViewTransition } from "react";
import { DayPicker } from "@/components/DayPicker";
import { JsonLd } from "@/components/JsonLd";
import { MenuDay } from "@/components/MenuDay";
import { MenuSkeleton } from "@/components/MenuSkeleton";
import { PageTransition } from "@/components/PageTransition";
import { ProgramLinks } from "@/components/ProgramLinks";
import { CHIP } from "@/components/menu-styles";
import { getDictionary, type Dictionary } from "@/i18n";
import { isLocale, plural, type Locale } from "@/i18n/config";
import { ALLERGEN_KEYS, allergenName, allergenWords, allergensIn, normalizeTags, parseAllergenParam, type AllergenKey } from "@/lib/allergens";
import { currentCycleDay, getMenuDay, getPrograms, hasAnyMenu, hasMenu, isDemoCatalog } from "@/lib/data/catalog";
import { CYCLE_DAYS, lowestPricePerDay, type MenuEntry, type Program } from "@/lib/data/types";
import { brandWith, directAnswer } from "@/lib/direct-answer";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { breadcrumbList } from "@/lib/structured-data";

export async function generateMetadata({ params }: PageProps<"/[locale]/menu">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({ locale, path: "/menu", title: t.menu.metaTitle, description: t.menu.metaDescription });
}

export default async function MenuPage({ params, searchParams }: PageProps<"/[locale]/menu">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // Links to the program pages under the menu. The menu itself still renders without them.
  // The lead (the direct answer) promises a menu seen before paying; until any level has dishes it says the menu comes
  // before launch instead.
  let programs: Program[] = [];
  let published = true;
  try {
    programs = await getPrograms();
    published = await hasAnyMenu(programs);
  } catch (error) {
    console.error("menu page: catalogue unavailable", error);
  }

  return (
    <PageTransition>
      <JsonLd data={breadcrumbList(locale, [{ name: t.menu.title, path: "/menu" }])} />
      <section className="bg-forest text-ivory">
        <div className="container-page py-12 md:py-16">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-5xl md:text-6xl">{t.menu.title}</h1>
          <p className="mt-3 max-w-2xl text-ivory/80">
            {directAnswer(
              t.answer,
              published ? t.answer.menu : t.answer.menuSoon,
              { brand: brandWith(t.answer, programs.filter((p) => p.variants.length > 0).map((p) => p.name)) },
              lowestPricePerDay(programs),
            )}
          </p>
        </div>
      </section>

      <section className="container-page py-10 md:py-14">
        {/* The selection comes from the URL, so this part renders per request. The skeleton leaves
            quickly and the menu rises in after it (Suspense reveal). Later day changes keep the
            revealed menu on screen until the next day is ready, so the skeleton shows only once. */}
        <Suspense
          fallback={
            <ViewTransition exit="menu-skeleton-out" default="none">
              <MenuSkeleton t={t} />
            </ViewTransition>
          }
        >
          <ViewTransition enter="menu-content-in" default="none">
            <MenuBrowser locale={locale} t={t} searchParams={searchParams} />
          </ViewTransition>
        </Suspense>
      </section>

      <div className="bg-ivory-deep">
        <ProgramLinks programs={programs} locale={locale} t={t} />
      </div>
    </PageTransition>
  );
}

async function MenuBrowser({
  locale,
  t,
  searchParams,
}: {
  locale: Locale;
  t: Dictionary;
  searchParams: PageProps<"/[locale]/menu">["searchParams"];
}) {
  const query = await searchParams;
  const pick = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const programs = await getPrograms();
  const program = programs.find((p) => p.slug === pick("program")) ?? programs[0];
  if (!program) return <p className="text-muted">{t.menu.empty}</p>;

  const variant = program.variants.find((v) => String(v.kcal) === pick("kcal")) ?? program.variants[0];
  // ?allergens=milk,nuts: the dishes holding any of them are outlined (docs/plans/allergen-exclusions.md). Rendered here,
  // on the server, so the outlined menu is in the HTML; unknown keys are dropped.
  const flagged = parseAllergenParam(query.allergens);
  const allergensParam: Record<string, string> = flagged.length > 0 ? { allergens: flagged.join(",") } : {};
  // The day is the menu's cycle day (1–30), never the calendar date. Without ?day= it is the day the kitchen cooks
  // today, and the caption says so.
  const requestedDay = Number(pick("day"));
  // Per request (not cached): the "cooked today" mark and the default day turn over at midnight in Tashkent.
  const todayDay = await currentCycleDay();
  const day = Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= CYCLE_DAYS ? requestedDay : todayDay;
  const dayOf = (n: number) => t.menu.dayOf.replace("{n}", String(n)).replace("{total}", String(CYCLE_DAYS));

  const [entries, levelHasMenu] = variant
    ? await Promise.all([getMenuDay(variant.id, day), hasMenu(variant.id)])
    : [[] as MenuEntry[], false];

  /** A query string with the allergen list's commas kept readable (?allergens=milk,nuts). */
  const searchOf = (params: Record<string, string>) => new URLSearchParams(params).toString().replace(/%2C/g, ",");

  const href = (next: { program?: string; kcal?: number; day?: number; allergens?: readonly AllergenKey[] }) => {
    const p = next.program ?? program.slug;
    // Switching program resets the calorie level to that program's first one.
    const k = next.program ? undefined : (next.kcal ?? variant?.kcal);
    const d = next.day ?? day;
    const a = next.allergens ?? flagged;
    return `/${locale}/menu?${searchOf({
      program: p,
      ...(k ? { kcal: String(k) } : {}),
      ...(a.length > 0 ? { allergens: a.join(",") } : {}),
      day: String(d),
    })}`;
  };

  const chip = (active: boolean) =>
    `press ${CHIP} ${active ? "border-forest bg-forest text-ivory" : "border-line bg-white text-forest hover:border-forest"}`;

  // The cycle repeats, so the day before day 1 is day 30.
  const prevDay = day === 1 ? CYCLE_DAYS : day - 1;
  const nextDay = day === CYCLE_DAYS ? 1 : day + 1;
  const dayHref = `/${locale}/menu?${searchOf({
    program: program.slug,
    ...(variant ? { kcal: String(variant.kcal) } : {}),
    ...allergensParam,
  })}&day=`;

  // The line under the day: how many of its dishes hold the picked allergens, and the swap rule.
  const capitalized = (text: string) => text.charAt(0).toLocaleUpperCase(locale === "uz" ? "uz" : "ru") + text.slice(1);
  const flaggedCount = entries.filter((entry) => allergensIn(entry.dish.allergens, flagged).length > 0).length;
  const flaggedWords = allergenWords(flagged, locale);
  const flaggedLine =
    flaggedCount > 0
      ? `${capitalized(
          t.allergens.dayCount
            .replace("{names}", flaggedWords)
            .replace("{n}", String(flaggedCount))
            .replace("{dishes}", plural(flaggedCount, t.allergens.dishForms)),
        )} ${t.allergens.swapNote}`
      : t.allergens.dayNone.replace("{names}", flaggedWords);

  return (
    <div>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="label text-muted">{t.menu.program}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {programs.map((p) => (
              <Link key={p.id} href={href({ program: p.slug })} scroll={false} className={chip(p.id === program.id)}>
                {p.name}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p className="label text-muted">{t.menu.level}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {program.variants.map((v) => (
              <Link key={v.id} href={href({ kcal: v.kcal })} scroll={false} className={`${chip(v.id === variant?.id)} tabular-nums`}>
                {v.kcal} {t.programs.kcal}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {levelHasMenu ? (
        <>
          <div className="mt-6">
            <p id="menu-allergens-label" className="label text-muted">
              {t.allergens.filter}
            </p>
            <div
              role="group"
              aria-labelledby="menu-allergens-label"
              aria-describedby="menu-allergens-hint"
              className="mt-2 flex flex-wrap gap-2"
            >
              {ALLERGEN_KEYS.map((key) => {
                const on = flagged.includes(key);
                const next = on ? flagged.filter((k) => k !== key) : normalizeTags([...flagged, key]);
                return (
                  <Link
                    key={key}
                    href={href({ allergens: next })}
                    scroll={false}
                    aria-current={on || undefined}
                    className={chip(on)}
                  >
                    {on && <span aria-hidden>✓ </span>}
                    {allergenName(key, locale)}
                  </Link>
                );
              })}
              {flagged.length > 0 && (
                <Link
                  href={href({ allergens: [] })}
                  scroll={false}
                  className="press inline-flex min-h-11 items-center px-2 text-sm font-semibold text-forest underline decoration-gold underline-offset-4"
                >
                  {t.allergens.clear}
                </Link>
              )}
            </div>
            <p id="menu-allergens-hint" className="mt-2 text-sm text-muted">
              {t.allergens.filterHint}
            </p>
          </div>

          {/* Anchor for the previous / next buttons: they bring the reader back to the top of the day. */}
          <div id="menu-day" className="scroll-mt-20 lg:scroll-mt-24">
            <p id="menu-day-label" className="label mt-8 text-muted">
              {t.menu.cycleDay}
            </p>
            <div className="mt-2">
              <DayPicker
                days={CYCLE_DAYS}
                active={day}
                hrefPrefix={dayHref}
                labelledBy="menu-day-label"
                describedBy="menu-day-hint"
              />
            </div>
            <p id="menu-day-hint" className="mt-2 text-sm text-muted">
              {t.menu.cycleHint.replace("{total}", String(CYCLE_DAYS))}
            </p>
          </div>

          {variant && (
            <div className="mt-8">
              {/* Same place, different content: the old day fades out and the new one in. */}
              <ViewTransition key={`${variant.id}-${day}`} name="menu-day-content" share="day-fade" default="none">
                <div>
                  {/* The day's heading (h2), so the dish names (h3) sit under it in the outline. */}
                  <h2 className="label mb-4 text-muted">
                    TAOMIQ {program.name} / {variant.kcal} · {dayOf(day)}
                    {day === todayDay && ` · ${t.menu.todayMark}`}
                  </h2>
                  {flagged.length > 0 && entries.length > 0 && (
                    <p className="mb-4 rounded-2xl bg-ivory-deep px-4 py-3 text-sm text-forest" data-allergen-summary>
                      {flaggedLine}
                    </p>
                  )}
                  <MenuDay
                    entries={entries}
                    targetKcal={variant.kcal}
                    locale={locale}
                    t={t}
                    eagerFirstImage
                    flagged={flagged}
                  />
                </div>
              </ViewTransition>

              <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:justify-between">
                <Link
                  href={`${dayHref}${prevDay}#menu-day`}
                  aria-label={`${t.menu.prevDay}: ${dayOf(prevDay)}`}
                  className="btn btn-outline min-h-12 text-forest"
                >
                  <span aria-hidden>←</span> {t.menu.day} {prevDay}
                </Link>
                <Link
                  href={`${dayHref}${nextDay}#menu-day`}
                  aria-label={`${t.menu.nextDay}: ${dayOf(nextDay)}`}
                  className="btn btn-outline min-h-12 text-forest"
                >
                  {t.menu.day} {nextDay} <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          )}
        </>
      ) : (
        // Nothing on any day of this level yet: one calm block instead of 30 empty days.
        <div className="mt-8 rounded-3xl border border-line bg-white p-6 md:p-8">
          <h2 className="font-serif text-3xl text-forest">{t.menu.unpublished}</h2>
          <p className="mt-3 max-w-xl text-muted">{t.menu.unpublishedText}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href={`/${locale}/order?${new URLSearchParams({
                program: program.slug,
                ...(variant ? { kcal: String(variant.kcal) } : {}),
              })}`}
              className="btn btn-gold"
            >
              {t.nav.cta}
            </Link>
            <a href={site.telegram} className="btn btn-outline text-forest" rel="noopener">
              {t.cta.telegram}
            </a>
          </div>
        </div>
      )}
      {isDemoCatalog && <p className="mt-4 text-sm text-muted">{t.menu.demoNote}</p>}
    </div>
  );
}
