import Link from "next/link";
import type { Dictionary } from "@/i18n";
import { formatSum, plural, type Locale } from "@/i18n/config";
import { pricePerDay, type Duration, type Program } from "@/lib/data/types";

/**
 * One program's prices: per calorie level and order length, the price per day and the total for the period,
 * each level linking to the order form with that program and level chosen. Phones get one card per level,
 * from md a table. Used on the program page and on /prices, so both always show the same figures; the order
 * form and the Offer structured data compute them with the same pricePerDay().
 */
export function ProgramPrices({
  program,
  durations,
  locale,
  t,
}: {
  program: Program;
  durations: Duration[];
  locale: Locale;
  t: Dictionary;
}) {
  const orderHref = (kcal: number) => `/${locale}/order?program=${program.slug}&kcal=${kcal}`;
  // "2 дня", "7 дней": Russian agrees the noun with the number; both Uzbek dictionaries repeat one form.
  const durationLabel = (d: Duration) =>
    `${d.is_trial ? `${t.durations.trial} · ` : ""}${d.days} ${plural(d.days, t.durations.dayForms)}`;

  return (
    <>
      {/* Phones: one card per calorie level, durations as a list, a full-width order button. */}
      <ul className="grid gap-4 md:hidden">
        {program.variants.map((variant) => (
          <li key={variant.id} className="rounded-2xl border border-line bg-white p-5">
            <h3 className="font-serif text-3xl text-forest tabular-nums">
              {variant.kcal} <span className="text-base text-muted">{t.programs.kcal}</span>
            </h3>
            <p className="mt-1 text-xs text-muted">
              {variant.meals_per_day} {plural(variant.meals_per_day, t.programs.mealForms)}
            </p>
            <dl className="mt-4 divide-y divide-line border-y border-line tabular-nums">
              {durations.map((d) => {
                const perDay = pricePerDay(variant.price_per_day, d.markup_pct);
                return (
                  <div key={d.days} className="flex items-baseline justify-between gap-4 py-3">
                    <dt className="text-sm text-graphite">{durationLabel(d)}</dt>
                    <dd className="text-right">
                      <span className="font-semibold text-graphite">{formatSum(perDay)}</span>
                      <span className="block text-xs text-muted">
                        {t.durations.perDay} · {formatSum(perDay * d.days)} {t.durations.total}
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            <Link href={orderHref(variant.kcal)} className="btn btn-gold mt-5 min-h-12 w-full">
              {t.nav.cta}
            </Link>
          </li>
        ))}
      </ul>

      {/* From md: the full table. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-white md:block">
        <table className="w-full min-w-[34rem] text-left tabular-nums">
          <thead>
            <tr className="border-b border-line">
              <th className="label p-4 text-muted">{t.programs.levels}</th>
              {durations.map((d) => (
                <th key={d.days} className="label p-4 text-muted">
                  {durationLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {program.variants.map((variant) => (
              <tr key={variant.id} className="border-b border-line last:border-0">
                <th className="p-4 font-serif text-2xl font-normal text-forest">
                  {variant.kcal} <span className="text-base text-muted">{t.programs.kcal}</span>
                  <span className="block font-sans text-xs text-muted">
                    {variant.meals_per_day} {plural(variant.meals_per_day, t.programs.mealForms)}
                  </span>
                  <Link
                    href={orderHref(variant.kcal)}
                    className="mt-2 inline-block font-sans text-sm font-semibold text-forest underline decoration-gold underline-offset-4"
                  >
                    {t.nav.cta}
                  </Link>
                </th>
                {durations.map((d) => {
                  const perDay = pricePerDay(variant.price_per_day, d.markup_pct);
                  return (
                    <td key={d.days} className="p-4">
                      <span className="font-semibold text-graphite">{formatSum(perDay)}</span>
                      <span className="block text-xs text-muted">
                        {t.durations.perDay} · {formatSum(perDay * d.days)} {t.durations.total}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
