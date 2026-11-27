import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { breadcrumbList } from "@/lib/structured-data";
import { CalculatorHero, CalculatorHow, getCalculatorPrograms } from "../suite";
import { BodyGoalCalculator } from "./BodyGoalCalculator";

export async function generateMetadata({ params }: PageProps<"/[locale]/calculator/body">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const tool = getDictionary(locale).calcTools.body;
  return pageMetadata({
    locale,
    path: "/calculator/body",
    title: tool.metaTitle,
    description: tool.metaDescription,
  });
}

export default async function BodyGoalCalculatorPage({ params }: PageProps<"/[locale]/calculator/body">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);
  const tool = t.calcTools.body;

  // The numbers work without the catalogue; only the program suggestion needs it.
  const programs = await getCalculatorPrograms();

  return (
    <PageTransition>
      <JsonLd
        data={breadcrumbList(locale, [
          { name: t.calcTools.crumb, path: "/calculator" },
          { name: tool.title, path: "/calculator/body" },
        ])}
      />
      <CalculatorHero locale={locale} t={t} current="body" title={tool.title} lead={tool.lead} />
      <BodyGoalCalculator
        locale={locale}
        t={{ calculator: t.calculator, tools: t.calcTools }}
        programs={programs}
        telegramUrl={site.telegram}
      />
      <CalculatorHow t={t} steps={tool.how} />
    </PageTransition>
  );
}
