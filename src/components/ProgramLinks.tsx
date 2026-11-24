import Link from "next/link";
import type { Dictionary } from "@/i18n";
import { formatSum, type Locale } from "@/i18n/config";
import type { Program } from "@/lib/data/types";

/**
 * Compact links to every program page (name, calorie levels, "from … per day"), for pages that talk about
 * the service without selling a program themselves: menu and delivery. Renders nothing without programs.
 */
export function ProgramLinks({ programs, locale, t }: { programs: Program[]; locale: Locale; t: Dictionary }) {
  const listed = programs.filter((p) => p.variants.length > 0);
  if (listed.length === 0) return null;

  return (
    <section className="container-page py-14 md:py-16">
      <h2 className="font-serif text-3xl text-forest md:text-4xl">{t.programs.title}</h2>
      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {listed.map((program) => (
          <li key={program.id}>
            <Link
              href={`/${locale}/programs/${program.slug}`}
              className="press lift flex h-full flex-col rounded-2xl border border-line bg-white p-5 text-forest"
            >
              <span className="h-1 w-8 rounded-full" style={{ background: program.tag_color }} aria-hidden />
              <span className="mt-3 flex items-baseline justify-between gap-3">
                <span className="font-serif text-2xl">{program.name}</span>
                <span aria-hidden className="nudge text-gold">→</span>
              </span>
              <span className="mt-1 text-sm text-muted tabular-nums">
                {program.variants.map((v) => v.kcal).join(" · ")} {t.programs.kcal}
              </span>
              <span className="mt-2 text-sm text-graphite">
                {t.hero.from}{" "}
                <span className="font-semibold tabular-nums">
                  {formatSum(Math.min(...program.variants.map((v) => v.price_per_day)))}
                </span>{" "}
                {t.hero.perDay}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
