"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { LocaleSwitch } from "./LocaleSwitch";
import { isCurrentSection, type NavLink } from "./NavLinks";

/**
 * Phones and tablets: a 44 px menu button that opens the site sections as a bottom sheet. The sheet is a
 * native modal <dialog>, so the browser handles Escape, focus trapping and returning focus to the button.
 * Its links are rendered on the server (closed dialog), so crawlers and the HTML see them. It closes on a
 * link tap, a backdrop tap, Escape and any route change (at once, so the page transition plays alone). The page
 * behind cannot scroll while it is open (globals.css, .nav-sheet).
 */
export function MobileNav({
  locale,
  links,
  telegramUrl,
  labels,
  account,
}: {
  locale: Locale;
  links: NavLink[];
  telegramUrl: string;
  labels: { sections: string; close: string };
  /** The sign-in / account link (AccountLink), when sign-in is switched on. */
  account?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const id = useId();

  // A navigation that did not start from a link in the sheet (back button) still closes it.
  useEffect(() => {
    if (dialog.current?.open) closeForNavigation(dialog.current);
  }, [pathname]);

  function onSheetClick(event: MouseEvent<HTMLDialogElement>) {
    const sheet = event.currentTarget;
    const target = event.target as HTMLElement;
    const link = target.closest("a");
    if (link && new URL(link.href, location.href).pathname !== location.pathname) closeForNavigation(sheet);
    // A click on the dialog box itself, not its content, is a click on the backdrop.
    else if (target === sheet || link) sheet.close();
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-label={labels.sections}
        onClick={() => {
          if (!dialog.current) return;
          delete dialog.current.dataset.instant;
          dialog.current.showModal();
          setOpen(true);
        }}
        className="press -mr-2 inline-flex size-11 items-center justify-center rounded-full text-ivory lg:hidden"
      >
        <svg aria-hidden width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 7h16M3 15h16" strokeLinecap="round" />
        </svg>
      </button>

      <dialog
        ref={dialog}
        id={id}
        aria-label={labels.sections}
        onClick={onSheetClick}
        onClose={() => setOpen(false)}
        className="nav-sheet bg-forest text-ivory"
      >
        <div className="pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-4 border-b border-ivory/10 px-5 pb-2 pt-3">
            <p className="label text-ivory/60">{labels.sections}</p>
            <button
              type="button"
              aria-label={labels.close}
              onClick={() => dialog.current?.close()}
              className="press -mr-2 inline-flex size-11 items-center justify-center rounded-full text-ivory"
            >
              <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <nav className="px-5 py-2">
            <ul className="divide-y divide-ivory/10">
              {links.map((link) => {
                const current = isCurrentSection(pathname, link);
                return (
                  <li key={link.href}>
                    {/* The current section: a gold dot in the gutter to the left of the word (no shift). */}
                    <Link
                      href={link.href}
                      aria-current={current ? "page" : undefined}
                      className="press relative flex min-h-14 items-center justify-between gap-4 font-serif text-2xl text-ivory"
                    >
                      {current && (
                        <span aria-hidden className="absolute -left-3.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-gold" />
                      )}
                      {link.label}
                      <span aria-hidden className="font-sans text-base text-gold">→</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mx-5 mt-2 flex items-center justify-between gap-4 border-t border-ivory/10 pt-4">
            <div className="flex items-center gap-5">
              {account}
              <a href={telegramUrl} rel="noopener" className="inline-flex min-h-11 items-center text-sm text-ivory/80 hover:text-ivory">
                Telegram
              </a>
            </div>
            <LocaleSwitch current={locale} />
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * Closing because the page changes. Where the browser runs view transitions, the sheet goes at once instead
 * of sliding away: React keeps it live underneath the transition overlay, so its 160 ms exit would play behind
 * the fading page snapshots. Without view transitions it slides away over the new page as usual.
 */
function closeForNavigation(sheet: HTMLDialogElement) {
  if ("startViewTransition" in document) sheet.dataset.instant = "";
  sheet.close();
}
