import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { ProgramCards } from "@/components/ProgramCards";
import { getDictionary, type Dictionary } from "@/i18n";
import { formatSum, isLocale, type Locale } from "@/i18n/config";
import { getPrograms } from "@/lib/data/catalog";
import { localized } from "@/lib/data/localized";
import type { Program } from "@/lib/data/types";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { programList } from "@/lib/structured-data";

export async function generateMetadata({ params }: PageProps<"/[locale]/programs">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({
    locale,
    path: "/programs",
    title: t.programs.metaTitle,
    description: t.programs.metaDescription,
  });
}

/**
 * Every program on one page: the home page's program cards, then a comparison (calorie levels, meals per day,
 * protein, "from" price per day, who it is for) with a menu and an order link per program, then the quiz and the
 * calculator for visitors who are not sure yet. The header's Programs link comes here.
 */
export default async function ProgramsPage({ params }: PageProps<"/[locale]/programs">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // The page still renders (heading, quiz, calculator, Telegram) if the catalogue cannot be read.
  let programs: Program[] = [];
  try {
    programs = (await getPrograms()).filter((p) => p.variants.length > 0);
  } catch (error) {
    console.error("programs page: catalogue unavailable", error);
  }

  return (
    <PageTransition>
      {programs.length > 0 && <JsonLd data={programList(programs, locale, t.programs.title)} />}
      <section className="bg-forest text-ivory">
        <div className="container-page py-10 md:py-14">
          <Breadcrumbs locale={locale} t={t} trail={[{ name: t.nav.programs, path: "/programs" }]} />
          <h1 className="hero-enter mt-5 font-serif text-4xl md:text-6xl">{t.programs.title}</h1>
          <p className="mt-3 max-w-2xl text-lg text-ivory/80">{t.programs.lead}</p>
        </div>
      </section>

      {programs.length > 0 ? (
        <>
          <section className="bg-ivory-deep py-12 md:py-16">
            <div className="container-page">
              <ProgramCards programs={programs} locale={locale} t={t} className="" />
              <p className="mt-4 text-sm text-muted">{t.programs.priceNote}</p>
            </div>
          </section>

          <section aria-labelledby="programs-compare" className="container-page py-14 md:py-16">
            <h2 id="programs-compare" className="reveal font-serif text-4xl text-forest md:text-5xl">
              {t.programs.compareTitle}
            </h2>
            <div className="mt-8">
              <Comparison programs={programs} locale={locale} t={t} />
            </div>
            <p className="mt-4 text-sm text-muted">{t.programs.priceNote}</p>
          </section>
        </>
      ) : (
        <section className="container-page py-14 text-center md:py-20">
          <p className="mx-auto max-w-xl text-lg text-muted">{t.order.empty}</p>
          <a href={site.telegram} className="btn btn-forest mt-6" rel="noopener">
            {t.order.telegram}
          </a>
        </section>
      )}

      {/* Not sure yet: the 1-minute test or the calculator */}
      <section className="bg-ivory-deep py-14 md:py-16">
        <div className="container-page text-center">
          <h2 className="font-serif text-3xl text-forest md:text-4xl">{t.quiz.teaser}</h2>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap">
            <Link href={`/${locale}/quiz`} className="btn btn-forest">
              {t.quiz.teaserLink} <span aria-hidden className="nudge">→</span>
            </Link>
            <Link href={`/${locale}/calculator`} className="btn btn-outline text-forest">
              {t.nav.calculator}
            </Link>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}

/** One program's facts for the comparison, in the order of the rows. */
function facts(program: Program, locale: Locale, t: Dictionary) {
  const meals = program.variants.map((v) => v.meals_per_day);
  const low = Math.min(...meals);
  const high = Math.max(...meals);
  const from = Math.min(...program.variants.map((v) => v.price_per_day));
  const profile = t.programs.profile[program.slug];
  return [
    {
      label: t.programs.levels,
      value: `${program.variants.map((v) => v.kcal).join(" · ")} ${t.programs.kcal}`,
    },
    { label: t.programs.compare.meals, value: low === high ? String(low) : `${low}–${high}` },
    { label: t.programs.compare.protein, value: profile?.protein ?? "—" },
    { label: t.programs.compare.price, value: `${t.hero.from} ${formatSum(from)} ${t.hero.perDay}` },
    { label: t.programs.compare.audience, value: profile?.audience ?? localized(program, "tagline", locale) },
  ];
}

/**
 * The comparison: from md a table with one column per program, on phones one stacked card per program with the
 * same rows. Each program ends with its menu link and the order form with the program chosen.
 */
function Comparison({ programs, locale, t }: { programs: Program[]; locale: Locale; t: Dictionary }) {
  const rows = programs.map((program) => facts(program, locale, t));
  const menuHref = (program: Program) => `/${locale}/menu?program=${program.slug}`;
  const orderHref = (program: Program) => `/${locale}/order?program=${program.slug}`;

  return (
    <>
      {/* Phones: one card per program */}
      <ul className="grid gap-4 md:hidden">
        {programs.map((program, index) => (
          <li key={program.id} className="rounded-2xl border border-line bg-white p-5">
            <span className="block h-1 w-8 rounded-full" style={{ background: program.tag_color }} aria-hidden />
            <h3 className="mt-3 font-serif text-3xl text-forest">{program.name}</h3>
            <dl className="mt-4 divide-y divide-line border-y border-line">
              {rows[index].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="shrink-0 text-sm text-muted">{row.label}</dt>
                  <dd className="text-right text-sm font-semibold text-graphite tabular-nums">{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Link href={menuHref(program)} className="btn btn-outline min-h-12 text-forest">
                {t.nav.menu}
              </Link>
              <Link href={orderHref(program)} className="btn btn-gold min-h-12">
                {t.programs.choose}
              </Link>
            </div>
          </li>
        ))}
      </ul>

      {/* From md: one column per program */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
        <table className="w-full min-w-[40rem] table-fixed text-left">
          <thead>
            <tr className="border-b border-line">
              <td className="w-48 p-4" />
              {programs.map((program) => (
                <th key={program.id} scope="col" className="p-4 align-bottom">
                  <span className="block h-1 w-8 rounded-full" style={{ background: program.tag_color }} aria-hidden />
                  <Link
                    href={`/${locale}/programs/${program.slug}`}
                    className="link mt-3 inline-block font-serif text-3xl font-normal text-forest"
                  >
                    {program.name}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows[0].map((row, rowIndex) => (
              <tr key={row.label} className="border-b border-line">
                <th scope="row" className="label p-4 align-top text-muted">
                  {row.label}
                </th>
                {programs.map((program, index) => (
                  <td key={program.id} className="p-4 align-top text-graphite tabular-nums">
                    {rows[index][rowIndex].value}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="p-4" />
              {programs.map((program) => (
                <td key={program.id} className="p-4">
                  <div className="flex flex-wrap gap-2">
                    <Link href={orderHref(program)} className="btn btn-gold !px-5 !py-2.5 !text-sm">
                      {t.programs.choose}
                    </Link>
                    <Link href={menuHref(program)} className="btn btn-outline !px-5 !py-2.5 !text-sm text-forest">
                      {t.nav.menu}
                    </Link>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
