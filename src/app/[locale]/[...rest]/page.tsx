import { notFound } from "next/navigation";

/**
 * Any path under /[locale] that no other route matches. Throwing here (instead of letting
 * Next fall through to its default 404) renders [locale]/not-found.tsx inside the locale
 * layout, so the 404 has the site header, footer and the visitor's language. Status stays 404.
 */
export default function CatchAllNotFound() {
  notFound();
}
