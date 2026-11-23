import type { Dictionary } from "@/i18n";
import { CYCLE_DAYS } from "@/lib/data/types";
import { CHIP, DAY_CIRCLE, DAY_ROW, DISH_BODY, DISH_CARD, DISH_IMAGE, DISH_LIST } from "./menu-styles";

/**
 * Loading state of the menu browser: chips row, day row and three dish cards, built from the same
 * class lists as the real thing so nothing moves when the menu streams in. The labels are real text
 * (they never change); everything else is a placeholder.
 */
export function MenuSkeleton({ t }: { t: Dictionary }) {
  const block = "rounded-md bg-ivory-deep";
  const chip = (text: string) => (
    <span className={`${CHIP} animate-pulse border-line bg-ivory-deep text-transparent`}>{text}</span>
  );

  return (
    <div aria-busy="true">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="label text-muted">{t.menu.program}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {chip("LIGHT")}
            {chip("BALANCE")}
            {chip("PROTEIN")}
          </div>
        </div>
        <div>
          <p className="label text-muted">{t.menu.level}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {chip(`1800 ${t.programs.kcal}`)}
            {chip(`2200 ${t.programs.kcal}`)}
          </div>
        </div>
      </div>

      <p className="label mt-8 text-muted">{t.menu.day}</p>
      <div className="mt-2">
        <div className={`${DAY_ROW} overflow-hidden`}>
          {Array.from({ length: CYCLE_DAYS }, (_, i) => (
            <span key={i} className={`${DAY_CIRCLE} animate-pulse border-line bg-ivory-deep`} />
          ))}
        </div>
      </div>

      <div className="mt-8">
        <p className="label mb-4 text-transparent">
          <span className={`${block} animate-pulse`}>TAOMIQ BALANCE / 1800 · {t.menu.day} 1</span>
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
                <span className={`${block} mt-auto h-4 w-3/5 animate-pulse`} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
