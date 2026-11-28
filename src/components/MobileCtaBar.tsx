"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatSum, type Locale } from "@/i18n/config";
import { GOAL_PROGRAM, isGoalPage } from "@/lib/goal-pages";

/**
 * Pages without the bar: the order flow, the calculator, which has its own result bar (.calc-bar), the program
 * finder (/quiz), which pins its own Continue button, and sign-in and the account page (/login, /account), which are not selling.
 */
const OWN_ACTION = /^\/[^/]+\/(order|calculator|quiz|login|account)(\/|$)/;
const PROGRAM_PAGE = /^\/[^/]+\/programs\/([^/]+)\/?$/;
const GOAL_PAGE = /^\/[^/]+\/goals\/([^/]+)\/?$/;

/**
 * Phones: the primary action stays within thumb reach. A fixed bar with "from X so'm per day" and the
 * gold "Choose plan" button, above the home indicator (safe-area inset).
 *
 * The bar sits in an in-flow box of its own height after the footer, so the page can always scroll the
 * footer's last line above it. While a page's own hero call to action (.hero-cta) is on screen the bar
 * stays down and slides up as that CTA scrolls away (globals.css, scroll-driven). Browsers without
 * scroll-driven animations show the bar all the time.
 */
export function MobileCtaBar({
  locale,
  fromPrice,
  labels,
}: {
  locale: Locale;
  /** Lowest catalogue price per day, or null when the catalogue is unavailable. */
  fromPrice: number | null;
  labels: { cta: string; from: string; perDay: string };
}) {
  const pathname = usePathname() ?? "";
  if (OWN_ACTION.test(pathname)) return null;
  // On a program page, and on a goal page that sells one program, the order form opens with that program
  // chosen, like the page's own button.
  const goal = GOAL_PAGE.exec(pathname)?.[1];
  const program = PROGRAM_PAGE.exec(pathname)?.[1] ?? (goal && isGoalPage(goal) ? GOAL_PROGRAM[goal] : null);
  const href = `/${locale}/order${program ? `?program=${program}` : ""}`;

  // The spacer is only room for the bar (aria-hidden); the bar itself is a labelled landmark of its own, so nothing on
  // the page sits outside a landmark.
  return (
    <>
      <div className="cta-bar-space bg-forest-deep md:hidden" aria-hidden />
      <aside
        aria-label={labels.cta}
        className="cta-bar fixed inset-x-0 bottom-0 z-30 border-t border-ivory/10 bg-forest text-ivory md:hidden"
      >
        <div className="container-page flex items-center justify-between gap-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          {fromPrice !== null ? (
            <p className="min-w-0 text-sm leading-tight text-ivory/70">
              {labels.from}{" "}
              <span className="whitespace-nowrap font-serif text-xl text-ivory tabular-nums">{formatSum(fromPrice)}</span>{" "}
              {labels.perDay}
            </p>
          ) : (
            <span />
          )}
          <Link href={href} className="btn btn-gold h-12 shrink-0 !px-5 !py-0">
            {labels.cta}
          </Link>
        </div>
      </aside>
    </>
  );
}
