"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { CYCLE_DAYS } from "@/lib/data/types";

export const menuHref = (variant: string, day: number) => `/menu?variant=${variant}&day=${day}`;

export type PickerProps = {
  variants: { id: string; label: string; name: string; kcal: number; color: string }[];
  variantId: string;
  day: number;
  /** Saved dishes per cycle day of the selected calorie level, day 1 first. */
  filledByDay: number[];
  mealsPerDay: number;
  locale: Locale;
};

/** The day editor tells the workspace whether it has unsaved changes. */
const DirtyContext = createContext<(dirty: boolean) => void>(() => {});

/** For the day editor: report unsaved changes (and none once it unmounts or its page is hidden). */
export function useReportDirty(dirty: boolean) {
  const setDirty = useContext(DirtyContext);
  useEffect(() => {
    setDirty(dirty);
  }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);
}

/**
 * The menu screen's frame: the calorie level and day picker, rendered once for the route (search params keep the
 * page's state, so it does not remount when the day changes and focus stays on the day or level just chosen), and
 * the keyed day editor as children.
 *
 * While the editor has unsaved changes, every same-site link on the page (the picker, the sidebar, the top bar)
 * asks first, and closing or reloading the tab gets the browser's own question.
 */
export function MenuWorkspace({ picker, children }: { picker: PickerProps; children: ReactNode }) {
  const router = useRouter();
  const m = getAdminDictionary(picker.locale).menu;
  const [dirty, setDirty] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // Capture phase on the document, ahead of next/link and the browser: a plain left click on a same-site link to
  // another address. New tabs, downloads and other sites go as usual.
  useEffect(() => {
    if (!dirty) return;
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      returnFocus.current = anchor;
      setTarget(`${url.pathname}${url.search}${url.hash}`);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function leave() {
    if (!target) return;
    const href = target;
    // Until the next page reports, nothing is unsaved: the person chose to drop the changes.
    setDirty(false);
    setTarget(null);
    router.push(href);
  }

  return (
    <DirtyContext.Provider value={setDirty}>
      <MenuPicker {...picker} />
      {children}

      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <AlertDialogContent
          onOverlayClick={() => setTarget(null)}
          // Back to the link that was pressed: on the picker it is the newly chosen day or level after leaving.
          finalFocus={() => {
            const el = returnFocus.current;
            return el && el.isConnected && el.getClientRects().length > 0 ? el : true;
          }}
          className="rounded-adm-dialog border border-adm-border bg-adm-surface text-adm-text"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sans text-lg font-semibold text-adm-text">
              {m.leaveTitle(picker.day)}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-adm-muted">{m.leaveText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-adm-btn border-adm-border px-4 py-0 text-sm text-adm-text">
              {m.stay}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={leave} className="rounded-adm-btn px-4 py-0 text-sm">
              {m.leaveButton}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DirtyContext.Provider>
  );
}

const STATE_CELL = {
  selected:
    "border-adm-highlight bg-adm-highlight text-adm-on-highlight font-semibold ring-2 ring-adm-text ring-offset-2 ring-offset-adm-surface",
  complete: "border-adm-accent bg-adm-accent text-adm-on-accent",
  partial: "border-adm-accent bg-adm-surface text-adm-accent-ink",
  empty: "border-dashed border-adm-muted/60 bg-adm-surface text-adm-muted",
} as const;

const STATE_SWATCH = {
  selected: "border-adm-highlight bg-adm-highlight ring-2 ring-adm-text ring-offset-1 ring-offset-adm-surface",
  complete: "border-adm-accent bg-adm-accent",
  partial: "border-adm-accent bg-adm-surface text-adm-accent-ink",
  empty: "border-dashed border-adm-muted/60 bg-adm-surface",
} as const;

/**
 * The calorie levels as a scrolling pill strip and the cycle's days as a grid with a legend, in one panel. Day
 * states differ in shape as well as colour: a ring for the selected day, a fill when complete, a dot when partly
 * filled, a dashed outline when empty.
 */
function MenuPicker({ variants, variantId, day, filledByDay, mealsPerDay, locale }: PickerProps) {
  const m = getAdminDictionary(locale).menu;

  // Bring the selected level into view when the strip scrolls (many levels on a phone).
  const stripRef = useRef<HTMLElement>(null);
  const currentRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const chip = currentRef.current;
    if (!strip || !chip || strip.scrollWidth <= strip.clientWidth) return;
    // The least scroll that shows the whole chip with the strip's own padding around it.
    const pad = parseFloat(getComputedStyle(strip).paddingLeft) || 0;
    const left = chip.offsetLeft - pad;
    const right = chip.offsetLeft + chip.offsetWidth + pad;
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left);
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }, [variantId]);

  return (
    <section className="adm-panel adm-panel-flush">
      <nav
        ref={stripRef}
        aria-label={m.variantsAria}
        className="relative flex gap-2 overflow-x-auto border-b border-adm-border px-4 py-3 [scrollbar-width:thin] sm:px-5"
      >
        {variants.map((v) => {
          const current = v.id === variantId;
          return (
            <Link
              key={v.id}
              ref={current ? currentRef : undefined}
              href={menuHref(v.id, day)}
              aria-current={current ? "true" : undefined}
              className={`flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors ${
                current
                  ? "border-adm-accent bg-adm-accent text-adm-on-accent"
                  : "border-adm-border bg-adm-surface text-adm-text hover:border-adm-accent"
              }`}
            >
              <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: v.color }} />
              {v.name} / <span className="tabular-nums">{v.kcal}</span>
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-4 p-4 sm:p-5">
        <nav aria-label={m.daysAria} className="grid grid-cols-6 gap-2 sm:max-w-xl sm:grid-cols-10">
          {Array.from({ length: CYCLE_DAYS }, (_, i) => i + 1).map((d) => {
            const filled = filledByDay[d - 1] ?? 0;
            const partial = filled > 0 && filled < mealsPerDay;
            const state = d === day ? "selected" : filled >= mealsPerDay ? "complete" : partial ? "partial" : "empty";
            const tooltip = m.dayTooltip(d, filled, mealsPerDay);
            return (
              <Link
                key={d}
                href={menuHref(variantId, d)}
                title={tooltip}
                aria-current={d === day ? "true" : undefined}
                className={`relative flex aspect-square w-full flex-col items-center justify-center rounded-lg border text-sm tabular-nums ${STATE_CELL[state]}`}
              >
                <span aria-hidden="true">{d}</span>
                {partial && (
                  <span aria-hidden="true" className="absolute bottom-1.5 size-1.5 rounded-full bg-current" />
                )}
                <span className="sr-only">{tooltip}</span>
              </Link>
            );
          })}
        </nav>

        <ul aria-label={m.legendAria} className="adm-caption flex flex-wrap gap-x-5 gap-y-2">
          {(["selected", "complete", "partial", "empty"] as const).map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`relative flex size-4 shrink-0 items-end justify-center rounded border pb-0.5 ${STATE_SWATCH[key]}`}
              >
                {key === "partial" && <span className="size-1 rounded-full bg-current" />}
              </span>
              {m.legend[key]}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
