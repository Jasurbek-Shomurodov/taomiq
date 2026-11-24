"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { readPendingRequestCount } from "@/lib/admin/actions";

/** One read per path, shared by the two copies of the sidebar (rail and phone drawer). */
let inflight: { path: string; count: Promise<number | null> } | null = null;
function countFor(path: string) {
  if (inflight?.path !== path) inflight = { path, count: readPendingRequestCount().catch(() => null) };
  return inflight.count;
}

/**
 * The gold pill on the Team row: how many people wait for access. Same behaviour as NewOrdersPill: starts from the
 * server's count, reads it again whenever the path changes, and a fresh server count (after approve or decline
 * refreshes the page) replaces it. No pill at 0, none when unknown. No polling, no realtime.
 */
export function TeamRequestsPill({ initialCount, locale }: { initialCount: number | null; locale: Locale }) {
  const pathname = usePathname();
  const [count, setCount] = useState(initialCount);

  const [seed, setSeed] = useState(initialCount);
  if (initialCount !== seed) {
    setSeed(initialCount);
    setCount(initialCount);
  }

  const readFor = useRef(pathname);
  useEffect(() => {
    if (readFor.current === pathname) return;
    readFor.current = pathname;
    let current = true;
    countFor(pathname).then((next) => {
      if (current) setCount(next);
    });
    return () => {
      current = false;
    };
  }, [pathname]);

  if (count === null || count <= 0) return null;
  const label = getAdminDictionary(locale).team.pendingBadge(count);
  return (
    <span className="adm-count adm-count-highlight" title={label}>
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
