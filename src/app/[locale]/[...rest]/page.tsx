import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { notFoundMetadata } from "@/lib/seo";

/** The 404's own title and description in the visitor's language (the not-found file's metadata does not apply here). */
export async function generateMetadata({ params }: PageProps<"/[locale]/[...rest]">): Promise<Metadata> {
  const { locale } = await params;
  return notFoundMetadata(locale);
}

/**
 * Any path under /[locale] that no other route matches. Throwing here (instead of letting
 * Next fall through to its default 404) renders [locale]/not-found.tsx inside the locale
 * layout, so the 404 has the site header, footer and the visitor's language. Status stays 404.
 */
export default function CatchAllNotFound() {
  notFound();
}
