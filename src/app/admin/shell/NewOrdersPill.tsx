"use client";

import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { useLiveCount, type ServerCount } from "./live";

/**
 * The gold pill on the Orders row. Starts from the count the layout read on the server; the shell's live updates
 * (live.tsx: every 30 s while visible and after each client navigation, owners and managers only) replace it, and a
 * fresh server count (after an order action refreshes the page) wins again. No pill at 0, none when unknown: never
 * a made-up 0.
 */
export function NewOrdersPill({ server, locale }: { server: ServerCount; locale: Locale }) {
  const count = useLiveCount("newOrders", server);
  if (count === null || count <= 0) return null;
  const label = getAdminDictionary(locale).shell.newOrders(count);
  return (
    <span className="adm-count adm-count-highlight" title={label}>
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
