import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { breadcrumbList } from "@/lib/structured-data";
import { CalculatorHow, getCalculatorPrograms } from "../calculator/suite";
import { Quiz } from "./Quiz";

export async function generateMetadata({ params }: PageProps<"/[locale]/quiz">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = getDictionary(locale);
  return pageMetadata({ locale, path: "/quiz", title: t.quiz.metaTitle, description: t.quiz.metaDescription });
}

/**
 * The program finder: three questions, then the recommended program and calorie level (src/lib/calculator.ts),
 * with the catalogue price and a pre-filled order link. Below it, how the number is worked out.
 */
export default async function QuizPage({ params }: PageProps<"/[locale]/quiz">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // The questions work without the catalogue; only the program suggestion needs it.
  const programs = await getCalculatorPrograms();

  return (
    <PageTransition>
      <JsonLd data={breadcrumbList(locale, [{ name: t.quiz.short, path: "/quiz" }])} />
      <section className="bg-forest text-ivory">
        <div className="hero-enter container-page py-10 md:py-14">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 max-w-3xl font-serif text-3xl leading-tight sm:text-4xl md:text-5xl">{t.quiz.title}</h1>
          <p className="mt-3 max-w-xl text-ivory/80">{t.quiz.lead}</p>
        </div>
      </section>

      <Quiz locale={locale} t={t.quiz} c={t.calculator} programs={programs} telegramUrl={site.telegram} />

      <CalculatorHow t={t} steps={t.calculator.how} />
    </PageTransition>
  );
}
