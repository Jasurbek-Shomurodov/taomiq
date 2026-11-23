import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, ViewTransition } from "react";
import { DayPicker } from "@/components/DayPicker";
import { JsonLd } from "@/components/JsonLd";
import { MenuDay } from "@/components/MenuDay";
import { MenuSkeleton } from "@/components/MenuSkeleton";
import { ProgramLinks } from "@/components/ProgramLinks";
import { CHIP } from "@/components/menu-styles";
import { getDictionary, type Dictionary } from "@/i18n";
import { isLocale, type Locale } from "@/i18n/config";
import { getMenuDay, getPrograms, getTodayCycleDay, isDemoCatalog } from "@/lib/data/catalog";
import { CYCLE_DAYS, type Program } from "@/lib/data/types";
import { pageMetadata } from "@/lib/seo";
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
  let programs: Program[] = [];
  try {
    programs = await getPrograms();
  } catch (error) {
    console.error("menu page: catalogue unavailable", error);
  }

  return (
    <>
      <JsonLd data={breadcrumbList(locale, [{ name: t.menu.title, path: "/menu" }])} />
      <section className="bg-forest text-ivory">
        <div className="container-page py-12 md:py-16">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-5xl md:text-6xl">{t.menu.title}</h1>
          <p className="mt-3 max-w-xl text-ivory/80">{t.menu.lead}</p>
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
    </>
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
  const requestedDay = Number(pick("day"));
  const day =
    Number.isInteger(requestedDay) && requestedDay >= 1 && requestedDay <= CYCLE_DAYS
      ? requestedDay
      : await getTodayCycleDay();

  const entries = variant ? await getMenuDay(variant.id, day) : [];

  const href = (next: { program?: string; kcal?: number; day?: number }) => {
    const p = next.program ?? program.slug;
    // Switching program resets the calorie level to that program's first one.
    const k = next.program ? undefined : (next.kcal ?? variant?.kcal);
    const d = next.day ?? day;
    const qs = new URLSearchParams({ program: p, ...(k ? { kcal: String(k) } : {}), day: String(d) });
    return `/${locale}/menu?${qs}`;
  };

  const chip = (active: boolean) =>
    `press ${CHIP} ${active ? "border-forest bg-forest text-ivory" : "border-line bg-white text-forest hover:border-forest"}`;

  // The cycle repeats, so the day before day 1 is day 30.
  const prevDay = day === 1 ? CYCLE_DAYS : day - 1;
  const nextDay = day === CYCLE_DAYS ? 1 : day + 1;
  const dayHref = `/${locale}/menu?${new URLSearchParams({
    program: program.slug,
    ...(variant ? { kcal: String(variant.kcal) } : {}),
  })}&day=`;

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

      {/* Anchor for the previous / next buttons: they bring the reader back to the top of the day. */}
      <div id="menu-day" className="scroll-mt-20 lg:scroll-mt-24">
        <p id="menu-day-label" className="label mt-8 text-muted">
          {t.menu.day}
        </p>
        <div className="mt-2">
          <DayPicker days={CYCLE_DAYS} active={day} hrefPrefix={dayHref} labelledBy="menu-day-label" />
        </div>
      </div>

      {variant && (
        <div className="mt-8">
          {/* Same place, different content: the old day fades out and the new one in. */}
          <ViewTransition key={`${variant.id}-${day}`} name="menu-day-content" share="day-fade" default="none">
            <div>
              <p className="label mb-4 text-muted">
                TAOMIQ {program.name} / {variant.kcal} · {t.menu.day} {day}
              </p>
              <MenuDay entries={entries} targetKcal={variant.kcal} locale={locale} t={t} eagerFirstImage />
            </div>
          </ViewTransition>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:justify-between">
            <Link
              href={`${dayHref}${prevDay}#menu-day`}
              aria-label={`${t.menu.prevDay}: ${t.menu.day} ${prevDay}`}
              className="btn btn-outline min-h-12 text-forest"
            >
              <span aria-hidden>←</span> {t.menu.day} {prevDay}
            </Link>
            <Link
              href={`${dayHref}${nextDay}#menu-day`}
              aria-label={`${t.menu.nextDay}: ${t.menu.day} ${nextDay}`}
              className="btn btn-outline min-h-12 text-forest"
            >
              {t.menu.day} {nextDay} <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      )}
      {isDemoCatalog && <p className="mt-4 text-sm text-muted">{t.menu.demoNote}</p>}
    </div>
  );
}
