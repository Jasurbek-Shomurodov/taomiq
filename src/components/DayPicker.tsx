"use client";

import Link, { useLinkStatus } from "next/link";
import { useLayoutEffect, useRef, ViewTransition } from "react";
import { DAY_CIRCLE, DAY_ROW } from "./menu-styles";

/**
 * The 30 menu cycle days (not calendar dates) as real links. The gold indicator is one named view transition: on a day change
 * the old and new indicator pair up and the browser glides it across. Without view transitions it
 * simply appears on the new day.
 */
export function DayPicker({
  days,
  active,
  hrefPrefix,
  labelledBy,
  describedBy,
}: {
  days: number;
  active: number;
  /** URL up to and including "day=", e.g. "/uz/menu?program=balance&kcal=1800&day=". */
  hrefPrefix: string;
  labelledBy: string;
  /** The hint that says these are menu days, not dates. */
  describedBy?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  // Keep the active day in the middle of the row: at once on mount (landing on day 22 must not show
  // days 1–7), smoothly when the day changes (e.g. from the previous / next buttons).
  useLayoutEffect(() => {
    const row = scroller.current;
    const current = row?.querySelector<HTMLElement>('[aria-current="true"]');
    const first = !mounted.current;
    mounted.current = true;
    if (!row || !current || row.scrollWidth <= row.clientWidth) return;

    const left = current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2;
    const smooth = !first && window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    row.scrollTo({ left, behavior: smooth ? "smooth" : "instant" });
  }, [active]);

  return (
    <nav aria-labelledby={labelledBy} aria-describedby={describedBy}>
      <div ref={scroller} className={DAY_ROW}>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const isActive = d === active;
          return (
            <Link
              key={d}
              href={`${hrefPrefix}${d}`}
              scroll={false}
              aria-current={isActive ? "true" : undefined}
              className={`press ${DAY_CIRCLE} ${
                isActive
                  ? "border-transparent font-semibold text-forest"
                  : "border-line bg-white text-forest hover:border-forest"
              }`}
            >
              {isActive && (
                <ViewTransition name="menu-day-indicator" share="day-glide" default="none">
                  <span aria-hidden className="absolute -inset-px rounded-full bg-gold" />
                </ViewTransition>
              )}
              <PendingRing />
              <span className="relative">{d}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Immediate feedback on the tapped day while its menu loads. Always rendered: no layout shift. */
function PendingRing() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute -inset-[3px] rounded-full border-2 border-gold transition-opacity duration-150 ${
        pending ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
