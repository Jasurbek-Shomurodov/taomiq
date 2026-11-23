import Image from "next/image";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";
import { portionNutrition, sumNutrition, type MenuEntry } from "@/lib/data/types";
import { Monogram } from "./Logo";

/** One day's meals with weights, kcal and Б/Ж/У, plus the day total. */
export function MenuDay({
  entries,
  targetKcal,
  locale,
  t,
}: {
  entries: MenuEntry[];
  targetKcal: number;
  locale: Locale;
  t: Dictionary;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line bg-white/50 p-8 text-center text-muted">
        {t.menu.empty}
      </p>
    );
  }

  const total = sumNutrition(entries);

  return (
    <div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => {
          const n = portionNutrition(entry.dish, entry.weight_g);
          const name = locale === "ru" ? entry.dish.name_ru : entry.dish.name_uz;
          const ingredients = locale === "ru" ? entry.dish.ingredients_ru : entry.dish.ingredients_uz;
          return (
            <li key={entry.id} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white">
              <div className="relative aspect-[4/3] bg-ivory-deep">
                {entry.dish.photo_url ? (
                  <Image
                    src={entry.dish.photo_url}
                    alt={name}
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center" aria-hidden>
                    <Monogram size={80} onDark={false} className="opacity-50" />
                  </div>
                )}
                <span className="label absolute left-3 top-3 rounded-full bg-forest px-3 py-1.5 text-ivory">
                  {t.slots[entry.slot]}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-4">
                <h3 className="font-serif text-xl leading-snug text-forest">{name}</h3>
                {ingredients && <p className="mt-1.5 text-sm text-muted">{ingredients}</p>}
                <p className="mt-auto pt-4 text-sm tabular-nums text-graphite">
                  <span className="font-semibold">{n.kcal} {t.programs.kcal}</span>
                  <span className="text-muted">
                    {" · "}{entry.weight_g} {t.menu.weight}
                    {" · "}{t.menu.protein} {n.protein}
                    {" · "}{t.menu.fat} {n.fat}
                    {" · "}{t.menu.carbs} {n.carbs}
                  </span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-forest-soft text-ivory sm:grid-cols-4">
        {[
          { label: t.menu.total, value: `${total.kcal} ${t.programs.kcal}`, hint: `${t.menu.target} ${targetKcal}` },
          { label: t.menu.proteinFull, value: `${total.protein} ${t.menu.weight}` },
          { label: t.menu.fatFull, value: `${total.fat} ${t.menu.weight}` },
          { label: t.menu.carbsFull, value: `${total.carbs} ${t.menu.weight}` },
        ].map((cell) => (
          <div key={cell.label} className="bg-forest p-4">
            <dt className="label text-gold">{cell.label}</dt>
            <dd className="mt-1 font-serif text-2xl tabular-nums">{cell.value}</dd>
            {cell.hint && <dd className="text-xs text-ivory/60">{cell.hint}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}
