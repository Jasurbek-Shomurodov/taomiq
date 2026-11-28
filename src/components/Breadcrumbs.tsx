import Link from "next/link";
import type { Dictionary } from "@/i18n";
import type { Locale } from "@/i18n/config";
import { breadcrumbList } from "@/lib/structured-data";
import { JsonLd } from "./JsonLd";

export type Crumb = {
  name: string;
  /** The path after the locale ("/programs"). Without one the crumb is plain text (a section with no page). */
  path?: string;
};

/**
 * Where the page sits, for the forest heroes: Home › Programs › BALANCE. Small label type above the h1, each link
 * a 44 px tap target (its own vertical padding, inside the 44 px row), the last crumb is the page itself
 * (aria-current, not a link). Also states the BreadcrumbList structured data, from the crumbs that have a page, so
 * a page renders this instead of its own breadcrumbList.
 */
export function Breadcrumbs({
  locale,
  t,
  trail,
  className = "",
}: {
  locale: Locale;
  t: Dictionary;
  /** The crumbs after Home; the last one is the current page. */
  trail: readonly Crumb[];
  className?: string;
}) {
  const crumbs: Crumb[] = [{ name: t.nav.home, path: "" }, ...trail];
  const linked = trail.filter((crumb): crumb is Required<Crumb> => crumb.path !== undefined);

  return (
    <>
      <JsonLd data={breadcrumbList(locale, linked)} />
      <nav aria-label={t.nav.breadcrumbs} className={className}>
        <ol className="label -my-3 flex flex-wrap items-center gap-x-2 text-ivory/60">
          {crumbs.map((crumb, index) => (
            <li key={`${index}-${crumb.name}`} className="inline-flex min-h-11 items-center gap-x-2">
              {index > 0 && (
                <span aria-hidden className="text-gold">
                  ›
                </span>
              )}
              {index === crumbs.length - 1 ? (
                <span aria-current="page" className="text-ivory">
                  {crumb.name}
                </span>
              ) : crumb.path !== undefined ? (
                <Link href={`/${locale}${crumb.path}`} className="link py-3.5 transition-colors hover:text-ivory">
                  {crumb.name}
                </Link>
              ) : (
                <span>{crumb.name}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
