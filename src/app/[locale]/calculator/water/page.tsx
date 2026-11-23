import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/lib/seo";
import { breadcrumbList } from "@/lib/structured-data";
import { CalculatorHero, CalculatorHow } from "../suite";
import { WaterCalculator } from "./WaterCalculator";

export async function generateMetadata({ params }: PageProps<"/[locale]/calculator/water">): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const tool = getDictionary(locale).calcTools.water;
  return pageMetadata({ locale, path: "/calculator/water", title: tool.metaTitle, description: tool.metaDescription });
}

export default async function WaterCalculatorPage({ params }: PageProps<"/[locale]/calculator/water">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);
  const tool = t.calcTools.water;

  return (
    <PageTransition>
      <JsonLd
        data={breadcrumbList(locale, [
          { name: t.calcTools.crumb, path: "/calculator" },
          { name: tool.title, path: "/calculator/water" },
        ])}
      />
      <CalculatorHero locale={locale} t={t} current="water" title={tool.title} lead={tool.lead} />
      <WaterCalculator locale={locale} t={{ calculator: t.calculator, tools: t.calcTools }} />
      <CalculatorHow t={t} steps={tool.how} />
    </PageTransition>
  );
}
