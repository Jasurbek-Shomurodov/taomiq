"use client";

import Image from "next/image";
import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { DishBadges, DishDataLine, type NutritionLabels } from "./dish-parts";

/** What the sheet shows for one dish: only fields the catalogue actually has. */
export type DishDetail = {
  name: string;
  slot: string;
  photoUrl: string | null;
  ingredients: string;
  /** Allergen names in the page's language. */
  allergens: string[];
  /** Badge texts in the page's language. */
  badges: string[];
  weight: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
};

export type DishSheetLabels = NutritionLabels & { close: string; ingredients: string; allergens: string };

const OpenDish = createContext<((index: number, trigger: HTMLElement) => void) | null>(null);

/**
 * The dish detail sheet for one day's dish list. The cards themselves stay server-rendered (children); each card's
 * DishButton opens this one native modal <dialog> with that dish. Phones: a bottom sheet (same motion as the
 * navigation sheet); from md a centred modal (globals.css, .dish-sheet). The browser handles Escape and the focus
 * trap; a backdrop tap closes it; focus goes back to the card's button; the page behind does not scroll.
 */
export function DishSheet({
  dishes,
  labels,
  children,
}: {
  dishes: DishDetail[];
  labels: DishSheetLabels;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const titleId = useId();
  const dish = index === null ? null : dishes[index];
  // Without a photo the text starts at the top of the sheet: the slot and the title keep clear of the close button.
  const clearClose = dish && !dish.photoUrl ? "pr-12" : "";

  function open(next: number, from: HTMLElement) {
    if (!dialog.current) return;
    trigger.current = from;
    // The sheet must hold the new dish before it opens, or its first frame would show the previous one.
    flushSync(() => setIndex(next));
    dialog.current.showModal();
  }

  return (
    <OpenDish.Provider value={open}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClick={(event) => {
          // A click on the dialog box itself, not its content, is a click on the backdrop.
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        onClose={() => trigger.current?.focus({ preventScroll: true })}
        className="dish-sheet bg-ivory text-graphite"
      >
        {dish && (
          <div className="pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {/* Zero-height sticky row: the close button stays reachable while the sheet scrolls. */}
            <div className="sticky top-0 z-10 flex h-0 justify-end">
              <button
                type="button"
                aria-label={labels.close}
                onClick={() => dialog.current?.close()}
                className="press mr-3 mt-3 inline-flex size-11 items-center justify-center rounded-full bg-ivory/90 text-forest shadow-sm"
              >
                <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {dish.photoUrl && (
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-ivory-deep">
                <Image
                  src={dish.photoUrl}
                  alt={dish.name}
                  fill
                  sizes="(min-width: 768px) 40rem, 100vw"
                  className="object-cover"
                />
              </div>
            )}

            <div className={`px-5 sm:px-6 ${dish.photoUrl ? "pt-5" : "pt-6"}`}>
              <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${clearClose}`}>
                <p className="label text-muted">{dish.slot}</p>
                <DishBadges badges={dish.badges} />
              </div>
              <h2 id={titleId} className={`mt-2 font-serif text-2xl leading-snug text-forest sm:text-3xl ${clearClose}`}>
                {dish.name}
              </h2>
              <DishDataLine
                kcal={dish.kcal}
                protein={dish.protein}
                fat={dish.fat}
                carbs={dish.carbs}
                weight={dish.weight}
                labels={labels}
                className="mt-2"
              />

              {/* The detailed macros, in full words. */}
              <dl className="mt-5 grid grid-cols-3 divide-x divide-line rounded-2xl border border-line bg-white">
                {(
                  [
                    [labels.proteinFull, dish.protein],
                    [labels.fatFull, dish.fat],
                    [labels.carbsFull, dish.carbs],
                  ] as const
                ).map(([label, grams]) => (
                  <div key={label} className="px-3 py-3 sm:px-4">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mt-0.5 font-serif text-xl tabular-nums text-forest">
                      {grams} {labels.weight}
                    </dd>
                  </div>
                ))}
              </dl>

              {dish.ingredients && (
                <section className="mt-6 border-t border-line pt-4">
                  <h3 className="label text-muted">{labels.ingredients}</h3>
                  <p className="mt-2 leading-relaxed">{dish.ingredients}</p>
                </section>
              )}
              {dish.allergens.length > 0 && (
                <section className="mt-5 border-t border-line pt-4">
                  <h3 className="label text-muted">{labels.allergens}</h3>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {dish.allergens.map((allergen) => (
                      <li key={allergen} className="rounded-full border border-line bg-white px-3 py-1 text-sm text-forest">
                        {allergen}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        )}
      </dialog>
    </OpenDish.Provider>
  );
}

/**
 * The card's trigger: a real button holding the dish name (its accessible name). Its ::after covers the whole
 * card (the card is `relative`), so a tap anywhere on the card opens the sheet.
 */
export function DishButton({ index, children }: { index: number; children: ReactNode }) {
  const open = useContext(OpenDish);
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={(event) => open?.(index, event.currentTarget)}
      className="cursor-pointer text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
    >
      {children}
    </button>
  );
}
