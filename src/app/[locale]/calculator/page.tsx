import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/JsonLd";
import { PageTransition } from "@/components/PageTransition";
import { getDictionary } from "@/i18n";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";
import { breadcrumbList } from "@/lib/structured-data";
import { Calculator } from "./Calculator";
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

export default async function CalculatorPage({ params }: PageProps<"/[locale]/calculator">) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = getDictionary(locale);

  // The calculator works without the catalogue; only the plan suggestion needs it.
  const programs = await getCalculatorPrograms();

  return (
    <PageTransition>
      <JsonLd data={breadcrumbList(locale, [{ name: t.calculator.title, path: "/calculator" }])} />
      <CalculatorHero locale={locale} t={t} current="calories" title={t.calculator.title} lead={t.calculator.lead} />

      <Calculator locale={locale} t={t.calculator} programs={programs} telegramUrl={site.telegram} />

      <CalculatorHow t={t} steps={t.calculator.how} />
    </PageTransition>
  );
}
