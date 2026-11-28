import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import type { CalculatorProgram } from "@/lib/calculator";
import { getDurations, getPrograms } from "@/lib/data/catalog";
import { pricePerDay } from "@/lib/data/types";

/**
 * The calculator's shared server parts (also used by the quiz): the catalogue as the calculator needs it, the
 * hero and the "how we calculate" section.
 */

/** Programs with their levels and lowest price per day. Empty when the catalogue cannot be read. */
export async function getCalculatorPrograms(): Promise<CalculatorProgram[]> {
  try {
    const [allPrograms, durations] = await Promise.all([getPrograms(), getDurations()]);
    return allPrograms
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
    console.error("calculator: catalogue unavailable", error);
    return [];
  }
}

/** The forest hero: Home › Calculator, the h1 and the lead. Also states the BreadcrumbList structured data. */
export function CalculatorHero({ locale, t, title, lead }: { locale: Locale; t: Dictionary; title: string; lead: string }) {
  return (
    <section className="bg-forest text-ivory">
      <div className="container-page py-10 md:py-14">
        <Breadcrumbs locale={locale} t={t} trail={[{ name: t.nav.calculator, path: "/calculator" }]} />
        <h1 className="hero-enter mt-5 font-serif text-4xl md:text-6xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-lg text-ivory/80">{lead}</p>
      </div>
    </section>
  );
}

/** How the number is calculated, then the "estimate, not medical advice" note. */
export function CalculatorHow({ t, steps, children }: { t: Dictionary; steps: readonly string[]; children?: ReactNode }) {
  return (
    <section className="bg-ivory-deep py-14 md:py-16">
      <div className="container-page max-w-3xl">
        <h2 className="font-serif text-3xl text-forest md:text-4xl">{t.calculator.howTitle}</h2>
        <ol className="mt-6 grid gap-4">
          {steps.map((text, index) => (
            <li key={text} className="flex gap-4 leading-relaxed text-graphite">
              <span className="font-serif text-2xl leading-none text-gold-ink">0{index + 1}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
        {children}
        <p className="mt-8 border-t border-line pt-5 text-sm leading-relaxed text-muted">{t.calculator.disclaimer}</p>
      </div>
    </section>
  );
}
