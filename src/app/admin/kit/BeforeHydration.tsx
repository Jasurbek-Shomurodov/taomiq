"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const noop = () => () => {};

/**
 * Its children only in the server HTML and until the page's scripts have run: a stand-in for a control that lives in
 * the top bar (TopBarActions), whose slots fill only after hydration. On a slow connection "Add dish" or "Save" is
 * still there; once the bar has them, this goes. useSyncExternalStore reads the server snapshot during hydration, so
 * the first client render matches the HTML and the next one drops it.
 */
export function BeforeHydration({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return hydrated ? null : children;
}
