"use client";

import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { useLiveCount, type ServerCount } from "./live";

/**
 * The gold pill on the Team row: how many people wait for access. Same behaviour as NewOrdersPill: starts from the
 * server's count, the shell's live updates (live.tsx, owner only) replace it, and a fresh server count (after
 * approve or decline refreshes the page) wins again. No pill at 0, none when unknown.
 */
export function TeamRequestsPill({ server, locale }: { server: ServerCount; locale: Locale }) {
  const count = useLiveCount("pendingRequests", server);
  if (count === null || count <= 0) return null;
  const label = getAdminDictionary(locale).team.pendingBadge(count);
  return (
    <span className="adm-count adm-count-highlight" title={label}>
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
