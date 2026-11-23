import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MenuDay } from "@/components/MenuDay";
import { getDictionary, type Dictionary } from "@/i18n";
import { isLocale, type Locale } from "@/i18n/config";
import { getMenuDay, getPrograms, getTodayCycleDay, isDemoCatalog } from "@/lib/data/catalog";
import { CYCLE_DAYS } from "@/lib/data/types";

export async function generateMetadata({ params }: PageProps<"/[locale]/menu">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return {
    title: t.menu.title,
    description: t.menu.lead,
    alternates: {
      canonical: `/${locale}/menu`,
      languages: { uz: "/uz/menu", ru: "/ru/menu", "x-default": "/uz/menu" },
    },
  };
}

export default async function MenuPage({ params, searchParams }: PageProps<"/[locale]/menu">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  return (
    <>
      <section className="bg-forest text-ivory">
        <div className="container-page py-12 md:py-16">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-5xl md:text-6xl">{t.menu.title}</h1>
          <p className="mt-3 max-w-xl text-ivory/80">{t.menu.lead}</p>
        </div>
      </section>

      <section className="container-page py-10 md:py-14">
        {/* The selection comes from the URL, so this part renders per request. */}
        <Suspense fallback={<div className="h-96 animate-pulse rounded-2xl bg-ivory-deep" />}>
          <MenuBrowser locale={locale} t={t} searchParams={searchParams} />
        </Suspense>
      </section>
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
    `rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
      active ? "border-forest bg-forest text-ivory" : "border-line bg-white text-forest hover:border-forest"
    }`;

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

      <p className="label mt-8 text-muted">{t.menu.day}</p>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-2">
        {Array.from({ length: CYCLE_DAYS }, (_, i) => i + 1).map((d) => (
          <Link
            key={d}
            href={href({ day: d })}
            scroll={false}
            aria-current={d === day ? "true" : undefined}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm tabular-nums transition-colors ${
              d === day ? "border-gold bg-gold font-semibold text-forest" : "border-line bg-white text-forest hover:border-forest"
            }`}
          >
            {d}
          </Link>
        ))}
      </div>

      {variant && (
        <div className="mt-8">
          <p className="label mb-4 text-muted">
            TAOMIQ {program.name} / {variant.kcal} · {t.menu.day} {day}
          </p>
          <MenuDay entries={entries} targetKcal={variant.kcal} locale={locale} t={t} />
        </div>
      )}
      {isDemoCatalog && <p className="mt-4 text-sm text-muted">{t.menu.demoNote}</p>}
    </div>
  );
}
