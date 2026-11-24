"use client";

/**
 * A script that runs while the HTML is parsed, before the first paint (server render only). On the client it is
 * inert text/plain, so React neither warns about a <script> nor runs it again on a client navigation.
 * From node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
