"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import type { Locale } from "@/i18n/config";
import { LocaleSwitch } from "./LocaleSwitch";

type NavLink = { href: string; label: string };

/**
 * Phones and tablets: a 44 px menu button that opens the site sections as a bottom sheet. The sheet is a
 * native modal <dialog>, so the browser handles Escape, focus trapping and returning focus to the button.
 * Its links are rendered on the server (closed dialog), so crawlers and the HTML see them. It closes on a
 * link tap, a backdrop tap, Escape and any route change. The page behind cannot scroll while it is open
 * (globals.css, .nav-sheet).
 */
export function MobileNav({
  locale,
  links,
  telegramUrl,
  labels,
}: {
  locale: Locale;
  links: NavLink[];
  telegramUrl: string;
  labels: { sections: string; close: string };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const id = useId();

  // A navigation that did not start from a link in the sheet (back button) still closes it.
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  function onSheetClick(event: MouseEvent<HTMLDialogElement>) {
    const target = event.target as HTMLElement;
    // A click on the dialog box itself, not its content, is a click on the backdrop.
    if (target === event.currentTarget || target.closest("a")) event.currentTarget.close();
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
          dialog.current?.showModal();
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
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="press flex min-h-14 items-center justify-between gap-4 font-serif text-2xl text-ivory"
                  >
                    {link.label}
                    <span aria-hidden className="font-sans text-base text-gold">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mx-5 mt-2 flex items-center justify-between gap-4 border-t border-ivory/10 pt-4">
            <a href={telegramUrl} rel="noopener" className="inline-flex min-h-11 items-center text-sm text-ivory/80 hover:text-ivory">
              Telegram
            </a>
            <LocaleSwitch current={locale} />
          </div>
        </div>
      </dialog>
    </>
  );
}
