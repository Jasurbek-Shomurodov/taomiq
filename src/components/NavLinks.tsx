"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavLink = {
  href: string;
  label: string;
  /** The path this section owns, e.g. "/ru/programs": the link is current there and on every page under it. */
  section?: string;
};

/** Whether the page at `pathname` belongs to the link's section. */
export function isCurrentSection(pathname: string | null, link: NavLink) {
  if (!pathname || !link.section) return false;
  return pathname === link.section || pathname.startsWith(`${link.section}/`);
}

/**
 * The desktop header's section links. The current section gets aria-current="page", full ivory and a 2 px gold
 * bar 6 px under the word. A client component only for usePathname: the header around it stays on the server.
 */
export function DesktopNavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return links.map((link) => {
    const current = isCurrentSection(pathname, link);
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={current ? "page" : undefined}
        className={`inline-flex min-h-11 items-center transition-colors hover:text-ivory ${current ? "text-ivory" : ""}`}
      >
        <span
          className={`relative ${
            current
              ? "after:absolute after:inset-x-0 after:top-[calc(100%+6px)] after:h-0.5 after:rounded-full after:bg-gold"
              : ""
          }`}
        >
          {link.label}
        </span>
      </Link>
    );
  });
}
