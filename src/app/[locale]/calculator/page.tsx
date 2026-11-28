import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { getPrograms } from "@/lib/data/catalog";
import { lowestPricePerDay, type Program } from "@/lib/data/types";
import { directAnswer } from "@/lib/direct-answer";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { BodyGoalCalculator } from "./BodyGoalCalculator";
import { CalculatorHero, CalculatorHow, getCalculatorPrograms } from "./suite";

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

/**
 * The one calculator (docs/plans/site-ux-navigation-pass.md, slice 4): the body goal calculator, prefilled with an
 * example so the result shows at once. The old protein, BMI, water and body URLs redirect here (next.config.ts).
 */
export default async function CalculatorPage({ params }: PageProps<"/[locale]/calculator">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // The numbers work without the catalogue; only the program suggestion needs it.
  const programs = await getCalculatorPrograms();
  // The lead's "from" price: the same figure as the hero and the phone bar (lowestPricePerDay), left out if the
  // catalogue cannot be read.
  let catalogue: Program[] = [];
  try {
    catalogue = await getPrograms();
  } catch (error) {
    console.error("calculator: catalogue unavailable", error);
  }
  const lead = directAnswer(t.answer, t.answer.calculator, { brand: "TAOMIQ" }, lowestPricePerDay(catalogue));

  return (
    <PageTransition>
      <CalculatorHero locale={locale} t={t} title={t.calculator.title} lead={lead} />
      <BodyGoalCalculator
        locale={locale}
        t={{ calculator: t.calculator, tool: t.bodyGoal }}
        programs={programs}
        telegramUrl={site.telegram}
      />
      <CalculatorHow t={t} steps={t.bodyGoal.how} />
    </PageTransition>
  );
}
