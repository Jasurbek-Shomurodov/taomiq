"use client";

import { createContext, useContext } from "react";
import { defaultAdminLocale, getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";

/** The signed-in person's panel language, for client parts that render before their page knows it (loading.tsx). */
export const ShellLocaleContext = createContext<Locale>(defaultAdminLocale);

/** "Loading…" for screen readers, in the panel's language (the default one before the shell has loaded). */
export function LoadingStatus() {
  const locale = useContext(ShellLocaleContext);
  return (
    <span className="sr-only" role="status">
      {getAdminDictionary(locale).shell.loading}
    </span>
  );
}
