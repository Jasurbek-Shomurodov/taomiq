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
import { ProteinCalculator } from "./ProteinCalculator";

export async function generateMetadata({ params }: PageProps<"/[locale]/calculator/protein">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const tool = getDictionary(locale).calcTools.protein;
  return pageMetadata({
    locale,
    path: "/calculator/protein",
    title: tool.metaTitle,
    description: tool.metaDescription,
  });
}

export default async function ProteinCalculatorPage({ params }: PageProps<"/[locale]/calculator/protein">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);
  const tool = t.calcTools.protein;

  // The range works without the catalogue; only the program suggestion needs it.
  const programs = await getCalculatorPrograms();

  return (
    <PageTransition>
      <JsonLd
        data={breadcrumbList(locale, [
          { name: t.calcTools.crumb, path: "/calculator" },
          { name: tool.title, path: "/calculator/protein" },
        ])}
      />
      <CalculatorHero locale={locale} t={t} current="protein" title={tool.title} lead={tool.lead} />
      <ProteinCalculator
        locale={locale}
        t={{ calculator: t.calculator, tools: t.calcTools }}
        programs={programs}
        telegramUrl={site.telegram}
      />
      <CalculatorHow t={t} steps={tool.how} />
    </PageTransition>
  );
}
