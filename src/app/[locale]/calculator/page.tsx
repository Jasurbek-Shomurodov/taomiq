import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { getDurations, getPrograms } from "@/lib/data/catalog";
import { pricePerDay } from "@/lib/data/types";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { breadcrumbList } from "@/lib/structured-data";
import { Calculator, type CalculatorProgram } from "./Calculator";

export async function generateMetadata({ params }: PageProps<"/[locale]/calculator">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({
    locale,
    path: "/calculator",
    title: t.calculator.metaTitle,
    description: t.calculator.metaDescription,
  });
}

export default async function CalculatorPage({ params }: PageProps<"/[locale]/calculator">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // The calculator works without the catalogue; only the plan suggestion needs it.
  let programs: CalculatorProgram[] = [];
  try {
    const [allPrograms, durations] = await Promise.all([getPrograms(), getDurations()]);
    programs = allPrograms
      .filter((p) => p.variants.length > 0)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        tagColor: p.tag_color,
        variants: p.variants.map((v) => ({
          kcal: v.kcal,
          // Lowest price per day across durations, as "from … per day" elsewhere on the site.
          fromPrice:
            durations.length > 0
              ? Math.min(...durations.map((d) => pricePerDay(v.price_per_day, d.markup_pct)))
              : v.price_per_day,
        })),
      }));
  } catch (error) {
    console.error("calculator page: catalogue unavailable", error);
  }

  return (
    <PageTransition>
      <JsonLd data={breadcrumbList(locale, [{ name: t.calculator.title, path: "/calculator" }])} />
      <section className="bg-forest text-ivory">
        <div className="container-page py-12 md:py-16">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-4xl md:text-6xl">{t.calculator.title}</h1>
          <p className="mt-3 max-w-xl text-lg text-ivory/80">{t.calculator.lead}</p>
        </div>
      </section>

      <Calculator locale={locale} t={t.calculator} programs={programs} telegramUrl={site.telegram} />

      <section className="bg-ivory-deep py-14 md:py-16">
        <div className="container-page max-w-3xl">
          <h2 className="font-serif text-3xl text-forest md:text-4xl">{t.calculator.howTitle}</h2>
          <ol className="mt-6 grid gap-4">
            {t.calculator.how.map((text, index) => (
              <li key={text} className="flex gap-4 leading-relaxed text-graphite">
                <span className="font-serif text-2xl leading-none text-gold">0{index + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
          <p className="mt-8 border-t border-line pt-5 text-sm leading-relaxed text-muted">
            {t.calculator.disclaimer}
          </p>
        </div>
      </section>
    </PageTransition>
  );
}
