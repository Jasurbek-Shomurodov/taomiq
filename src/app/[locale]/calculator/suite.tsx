import Link from "next/link";
import type { ReactNode } from "react";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { CALCULATOR_TOOLS, type CalculatorTool } from "@/lib/calculator";
import { getDurations, getPrograms } from "@/lib/data/catalog";
import { pricePerDay } from "@/lib/data/types";
import type { CalculatorProgram } from "./Calculator";

/**
 * The calculator suite's shared server parts: the catalogue as the calculators need it, the tab row between
 * the four calculators, the hero and the "how we calculate" section.
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

/** The calorie calculator, then the tools; real links, the current one marked. Scrolls sideways on narrow phones. */
export function CalculatorTabs({
  locale,
  t,
  current,
}: {
  locale: Locale;
  t: Dictionary;
  current: "calories" | CalculatorTool;
}) {
  const tabs = [
    { key: "calories" as const, href: `/${locale}/calculator` },
    ...CALCULATOR_TOOLS.map((tool) => ({ key: tool, href: `/${locale}/calculator/${tool}` })),
  ];
  return (
    <nav aria-label={t.calcTools.crumb} className="-mx-5 overflow-x-auto px-5 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`press inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${
                  active ? "border-gold bg-gold text-forest" : "border-ivory/30 text-ivory/85 hover:border-ivory hover:text-ivory"
                }`}
              >
                {t.calcTools.tabs[tab.key]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function CalculatorHero({
  locale,
  t,
  current,
  title,
  lead,
}: {
  locale: Locale;
  t: Dictionary;
  current: "calories" | CalculatorTool;
  title: string;
  lead: string;
}) {
  return (
    <section className="bg-forest text-ivory">
      <div className="container-page pb-12 pt-6 md:pb-16 md:pt-8">
        <CalculatorTabs locale={locale} t={t} current={current} />
        <div className="hero-enter mt-8 md:mt-10">
          <p className="label text-gold">TAOMIQ</p>
          <h1 className="mt-3 font-serif text-4xl md:text-6xl">{title}</h1>
          <p className="mt-3 max-w-xl text-lg text-ivory/80">{lead}</p>
        </div>
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
              <span className="font-serif text-2xl leading-none text-gold">0{index + 1}</span>
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
