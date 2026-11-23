import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { MenuDay } from "@/components/MenuDay";
import { getDictionary } from "@/i18n";
import { formatSum, isLocale, locales } from "@/i18n/config";
import { getDurations, getMenuDay, getPrograms, isDemoCatalog } from "@/lib/data/catalog";
import { pricePerDay } from "@/lib/data/types";
import { pageMetadata } from "@/lib/seo";
import { programProduct } from "@/lib/structured-data";

export async function generateStaticParams() {
  const programs = await getPrograms();
  return locales.flatMap((locale) => programs.map((p) => ({ locale, slug: p.slug })));
}

export async function generateMetadata({ params }: PageProps<"/[locale]/programs/[slug]">): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const program = (await getPrograms()).find((p) => p.slug === slug);
  if (!program) return {};
  return pageMetadata({
    locale,
    path: `/programs/${slug}`,
    title: `${program.name} — ${locale === "ru" ? program.tagline_ru : program.tagline_uz}`,
    description: locale === "ru" ? program.description_ru : program.description_uz,
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

  return (
    <>
      <JsonLd data={programProduct(program, durations, locale, t.programs.kcal)} />
      <section className="bg-forest text-ivory">
        <div className="container-page py-14 md:py-20">
          <span className="block h-1.5 w-12 rounded-full" style={{ background: program.tag_color }} />
          <p className="label mt-5 text-ivory/60">TAOMIQ</p>
          <h1 className="font-serif text-6xl md:text-7xl">{program.name}</h1>
          <p className="mt-2 text-xl text-gold">{locale === "ru" ? program.tagline_ru : program.tagline_uz}</p>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ivory/80">
            {locale === "ru" ? program.description_ru : program.description_uz}
          </p>
          <Link href={`/${locale}/order?program=${program.slug}`} className="btn btn-gold mt-8">
            {t.nav.cta}
          </Link>
        </div>
      </section>

      {/* Prices by calorie level and duration */}
      <section className="container-page py-14 md:py-16">
        <h2 className="font-serif text-4xl text-forest">{t.durations.title}</h2>

        {/* Phones: one card per calorie level, durations as a list, a full-width order button. */}
        <ul className="mt-6 grid gap-4 md:hidden">
          {program.variants.map((variant) => (
            <li key={variant.id} className="rounded-2xl border border-line bg-white p-5">
              <h3 className="font-serif text-3xl text-forest tabular-nums">
                {variant.kcal} <span className="text-base text-muted">{t.programs.kcal}</span>
              </h3>
              <p className="mt-1 text-xs text-muted">
                {variant.meals_per_day} {t.programs.mealsPerDay}
              </p>
              <dl className="mt-4 divide-y divide-line border-y border-line tabular-nums">
                {durations.map((d) => {
                  const perDay = pricePerDay(variant.price_per_day, d.markup_pct);
                  return (
                    <div key={d.days} className="flex items-baseline justify-between gap-4 py-3">
                      <dt className="text-sm text-graphite">
                        {d.is_trial ? `${t.durations.trial} · ` : ""}
                        {d.days} {t.durations.days}
                      </dt>
                      <dd className="text-right">
                        <span className="font-semibold text-graphite">{formatSum(perDay)}</span>
                        <span className="block text-xs text-muted">
                          {t.durations.perDay} · {formatSum(perDay * d.days)} {t.durations.total}
                        </span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <Link
                href={`/${locale}/order?program=${program.slug}&kcal=${variant.kcal}`}
                className="btn btn-gold mt-5 min-h-12 w-full"
              >
                {t.nav.cta}
              </Link>
            </li>
          ))}
        </ul>

        {/* From md: the full table. */}
        <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
          <table className="w-full min-w-[34rem] text-left tabular-nums">
            <thead>
              <tr className="border-b border-line">
                <th className="label p-4 text-muted">{t.programs.levels}</th>
                {durations.map((d) => (
                  <th key={d.days} className="label p-4 text-muted">
                    {d.is_trial ? `${t.durations.trial} · ` : ""}
                    {d.days} {t.durations.days}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {program.variants.map((variant) => (
                <tr key={variant.id} className="border-b border-line last:border-0">
                  <th className="p-4 font-serif text-2xl font-normal text-forest">
                    {variant.kcal} <span className="text-base text-muted">{t.programs.kcal}</span>
                    <span className="block font-sans text-xs text-muted">
                      {variant.meals_per_day} {t.programs.mealsPerDay}
                    </span>
                    <Link
                      href={`/${locale}/order?program=${program.slug}&kcal=${variant.kcal}`}
                      className="mt-2 inline-block font-sans text-sm font-semibold text-forest underline decoration-gold underline-offset-4"
                    >
                      {t.nav.cta}
                    </Link>
                  </th>
                  {durations.map((d) => {
                    const perDay = pricePerDay(variant.price_per_day, d.markup_pct);
                    return (
                      <td key={d.days} className="p-4">
                        <span className="font-semibold text-graphite">{formatSum(perDay)}</span>
                        <span className="block text-xs text-muted">
                          {t.durations.perDay} · {formatSum(perDay * d.days)} {t.durations.total}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
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
    </>
  );
}
