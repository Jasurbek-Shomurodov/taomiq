import { ViewTransition, type ReactNode } from "react";

/**
 * The page change: the old page fades out (160 ms), then the new one fades in and rises 12 px (240 ms).
 * Styles: globals.css, "Page change".
 *
 * Every public page.tsx wraps its content in this, not the layout: layouts persist across navigations, so
 * enter and exit would never fire there. `default="none"`: an update of a page that stays mounted (the menu's
 * day and program links, a Suspense reveal, a server action) does not fade the whole page, so the menu's own
 * day cross-fade and skeleton reveal play alone. The header and the phone call-to-action bar are named in
 * the layout and never animate (globals.css).
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page-in" exit="page-out" default="none">
      {children}
    </ViewTransition>
  );
}
