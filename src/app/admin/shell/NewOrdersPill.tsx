"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { readNewOrderCount } from "@/lib/admin/actions";

/**
 * One read per path, shared by the two copies of the sidebar (rail and phone drawer), so a navigation asks once.
 */
let inflight: { path: string; count: Promise<number | null> } | null = null;
function countFor(path: string) {
  if (inflight?.path !== path) inflight = { path, count: readNewOrderCount().catch(() => null) };
  return inflight.count;
}

/**
 * The gold pill on the Orders row. Starts from the count the layout read on the server and reads it again (server
 * action, owners and managers only) whenever the path changes, because a client navigation does not re-render the layout. A
 * fresh server count (after an order action refreshes the page) replaces it too. No pill at 0, none when unknown:
 * never a made-up 0. No polling, no realtime.
 */
export function NewOrdersPill({ initialCount, locale }: { initialCount: number | null; locale: Locale }) {
  const pathname = usePathname();
  const [count, setCount] = useState(initialCount);

  // A new server-rendered count wins over the last client read.
  const [seed, setSeed] = useState(initialCount);
  if (initialCount !== seed) {
    setSeed(initialCount);
    setCount(initialCount);
  }

  // The path the current count belongs to: the first render's is the server's own read.
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
  const label = getAdminDictionary(locale).shell.newOrders(count);
  return (
    <span className="adm-count adm-count-highlight" title={label}>
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
