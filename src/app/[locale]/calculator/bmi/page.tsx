import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { CalculatorHero, CalculatorHow } from "../suite";
import { BmiCalculator } from "./BmiCalculator";

export async function generateMetadata({ params }: PageProps<"/[locale]/calculator/bmi">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const tool = getDictionary(locale).calcTools.bmi;
  return pageMetadata({ locale, path: "/calculator/bmi", title: tool.metaTitle, description: tool.metaDescription });
}

export default async function BmiCalculatorPage({ params }: PageProps<"/[locale]/calculator/bmi">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);
  const tool = t.calcTools.bmi;

  return (
    <PageTransition>
      <JsonLd
        data={breadcrumbList(locale, [
          { name: t.calcTools.crumb, path: "/calculator" },
          { name: tool.title, path: "/calculator/bmi" },
        ])}
      />
      <CalculatorHero locale={locale} t={t} current="bmi" title={tool.title} lead={tool.lead} />
      <BmiCalculator locale={locale} t={{ calculator: t.calculator, tools: t.calcTools }} />
      <CalculatorHow t={t} steps={tool.how} />
    </PageTransition>
  );
}
