import type { Dictionary } from "@/i18n";
import { CYCLE_DAYS } from "@/lib/data/types";
import { CHIP, DAY_CIRCLE, DAY_ROW, DISH_BODY, DISH_CARD, DISH_IMAGE, DISH_LIST } from "./menu-styles";

/**
 * Loading state of the menu browser: chips row, day row and three dish cards, built from the same
 * class lists as the real thing so nothing moves when the menu streams in. The labels are real text
 * (they never change); everything else is a placeholder without words. It is the static shell of /menu, sent before
 * the URL's ?program=&kcal=&day= is read, so it names no program, level or day: a crawler, or a phone still waiting
 * for the stream, never sees a program other than the one asked for (docs/plans/customer-site-round-2.md, item 7).
 */
export function MenuSkeleton({ t }: { t: Dictionary }) {
  const block = "rounded-md bg-ivory-deep";
  // Same height as a chip (padding + one line of text); the width stands in for the words.
  const chip = (width: string, key: number) => (
    <span key={key} className={`${CHIP} ${width} animate-pulse border-line bg-ivory-deep`} aria-hidden>
      &nbsp;
    </span>
  );

  return (
    <div aria-busy="true">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="label text-muted">{t.menu.program}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {["w-20", "w-28", "w-28"].map(chip)}
          </div>
        </div>
        <div>
          <p className="label text-muted">{t.menu.level}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {["w-24", "w-24"].map(chip)}
          </div>
        </div>
      </div>

      {/* The allergen filter row (one chip per allergen of src/lib/allergens.ts). */}
      <p className="label mt-6 text-muted">{t.allergens.filter}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {["w-20", "w-20", "w-16", "w-20", "w-20", "w-16", "w-32", "w-20", "w-16", "w-24"].map(chip)}
      </div>
      <p className="mt-2 text-sm text-muted">{t.allergens.filterHint}</p>

      <p className="label mt-8 text-muted">{t.menu.cycleDay}</p>
      <div className="mt-2">
        <div className={`${DAY_ROW} overflow-hidden`}>
          {Array.from({ length: CYCLE_DAYS }, (_, i) => (
            <span key={i} className={`${DAY_CIRCLE} animate-pulse border-line bg-ivory-deep`} />
          ))}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">{t.menu.cycleHint.replace("{total}", String(CYCLE_DAYS))}</p>

      <div className="mt-8">
        <p className="label mb-4" aria-hidden>
          <span className={`${block} inline-block w-64 max-w-full animate-pulse`}>&nbsp;</span>
        </p>
        <ul className={DISH_LIST}>
          {[0, 1, 2].map((i) => (
            <li key={i} className={`${DISH_CARD} max-sm:min-h-[11.25rem]`}>
              <div className={`${DISH_IMAGE} animate-pulse`} />
              <div className={DISH_BODY} aria-hidden>
                <span className={`${block} mt-1 h-3 w-20 animate-pulse sm:hidden`} />
                <span className={`${block} mt-2 h-5 w-4/5 animate-pulse sm:mt-1`} />
                <span className={`${block} mt-3 h-3.5 w-full animate-pulse`} />
                <span className={`${block} mt-2 h-3.5 w-2/3 animate-pulse`} />
                {/* The data line: kcal · Б · Ж · У · weight. */}
                <span className="mt-auto pt-3 sm:pt-4">
                  <span className={`${block} block h-3.5 w-3/4 animate-pulse`} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
