"use client";

import { WifiOff } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getAdminDictionary } from "@/i18n/admin";
import type { Locale } from "@/i18n/config";
import { LIVE_COUNTS_PATH, parseLiveCounts, type LiveCounts } from "@/lib/admin/live-counts";
import { Toast, type ToastMessage } from "../kit/Toast";
import { panelPath } from "./nav";
import { pageIsBusy } from "./page-busy";

/** One read every 30 s while the panel is visible. */
const POLL_MS = 30_000;
/** After failures the wait doubles (60 s, then 120 s) and stays at 120 s. */
const MAX_BACKOFF_MS = 120_000;
/** In a background tab one read every 2 minutes, only for the "(N)" in the tab title. */
const HIDDEN_POLL_MS = 120_000;
/** A navigation or a return to the tab reads again, but not within 5 s of the last read. */
const MIN_GAP_MS = 5_000;
/** The browser gives up on one read after 8 s (the server stops at 5 s). */
const FETCH_TIMEOUT_MS = 8_000;
/** The connection notice shows after this many failed reads in a row. */
const FAILS_BEFORE_NOTICE = 2;
/** The pages refreshed in place when the new-order count changes. Never the order form or the editors. */
const REFRESHED_PATHS = new Set(["/", "/orders"]);
/** The "(3) " this module puts before the tab title. */
const TITLE_PREFIX = /^\(\d+\+?\) /;
const NEW_ORDERS_HREF = "/orders?status=new";

export type LiveKey = "newOrders" | "pendingRequests";
type Counts = Partial<Record<LiveKey, number | null>>;

/**
 * A count as one server render of the layout read it. A new object comes with every server render (the first load,
 * router.refresh(), an action that refreshes), and only then, so its identity says "the server read this just now",
 * even when the number is the same as last time.
 */
export type ServerCount = { count: number | null };

type LiveState = {
  /** The latest count per pill: undefined until the server's count (or a read) is in, null when unknown. */
  counts: Counts;
  seed: (key: LiveKey, value: number | null) => void;
  connectionLost: boolean;
  /** New orders seen while the toast is up: `added` grows until it is dismissed. */
  toast: { id: number; added: number } | null;
  dismissToast: () => void;
};

const LiveContext = createContext<LiveState | null>(null);

/**
 * One read of GET /live-counts (src/app/admin/live-counts/route.ts). Same-origin with the session cookies, never
 * cached, given up after 8 s. A 401 is a session that is gone; a timeout, a network error, any other status or a body
 * that is not the expected JSON is a failed read.
 */
async function fetchLiveCounts(): Promise<LiveCounts> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(LIVE_COUNTS_PATH, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401) return { status: "signed-out" };
    if (!response.ok) return { status: "failed" };
    const result = parseLiveCounts(await response.json());
    return result?.status === "ok" ? result : { status: "failed" };
  } catch {
    return { status: "failed" };
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Live updates for the back office (docs/plans/zarkebab-feature-port.md, slice 10a): a poll of a small GET endpoint,
 * not a socket and not a Server Action (an action is queued behind the person's own saves, and one that refreshes
 * the session cookies re-renders the page).
 *
 * When it reads: every 30 s while the panel is visible, and every 2 minutes in a background tab (only the tab title
 * changes there); right after a client navigation, since the layout that seeds the pills is not re-rendered then; on a
 * return to the tab; when the browser comes back online. A read never starts while another is in flight (the next is
 * scheduled only after one ends), failures back off to 2 minutes, and a session that is gone (401) stops it for good:
 * no redirect, the next navigation's own check sends the person to sign in.
 *
 * What a read changes:
 *  - the sidebar pills (useLiveCount), which start from the server's counts; a read that started before the latest
 *    server count arrived is not used for the counts;
 *  - a rise in new orders shows a toast with a link to the new orders. Never for the first reading after the page
 *    loads (that is the baseline); a rise seen in a background tab waits and shows once the tab is visible again;
 *  - "(N) " before the tab title while there are new orders;
 *  - on the dashboard and the orders list, a changed new-order count refreshes the page (router.refresh(), which
 *    keeps client state) once the tab is visible and nothing on it is being edited (page-busy.ts); until then it waits
 *    for the next read;
 *  - two failed reads in a row show the connection notice in the top bar; the next success clears it.
 *
 * Only roles that see a count today poll at all: owners and managers (new orders), the owner (access requests).
 */
export function LiveUpdates({
  watchOrders,
  watchRequests,
  children,
}: {
  /** This role sees the new-orders pill (owner, manager). */
  watchOrders: boolean;
  /** This role sees the access-requests pill (owner). */
  watchRequests: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const path = panelPath(usePathname());
  const [counts, setCounts] = useState<Counts>({});
  const [connectionLost, setConnectionLost] = useState(false);
  const [toast, setToast] = useState<LiveState["toast"]>(null);

  // The latest values as the poll compares them (the state above may not have re-rendered yet).
  const known = useRef<Counts>({});
  // When the server last handed over a count: a read that started earlier is older than it.
  const seededAt = useRef(0);
  const pathRef = useRef(path);
  const refreshDue = useRef(false);
  const toastSeq = useRef(0);
  const readSoon = useRef<(() => void) | null>(null);

  const setCount = useCallback((key: LiveKey, value: number | null) => {
    known.current[key] = value;
    setCounts((current) => (current[key] === value ? current : { ...current, [key]: value }));
  }, []);
  // A count from a server render of the layout.
  const seed = useCallback(
    (key: LiveKey, value: number | null) => {
      seededAt.current = performance.now();
      setCount(key, value);
    },
    [setCount],
  );
  const dismissToast = useCallback(() => setToast(null), []);
  const showToast = useCallback((added: number) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToast((shown) => ({ id, added: (shown?.added ?? 0) + added }));
  }, []);

  // A client navigation: the new page was just rendered by the server, so nothing is left to refresh, but the
  // pills belong to the layout, which is not re-rendered: read the counts again.
  useEffect(() => {
    if (pathRef.current === path) return;
    pathRef.current = path;
    refreshDue.current = false;
    readSoon.current?.();
  }, [path]);

  const enabled = watchOrders || watchRequests;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let inFlight = false;
    let failures = 0;
    // New orders seen while the tab was hidden, for one toast when it is visible again.
    let unseenAdded = 0;
    // The pills start from the server's own read of a moment ago.
    let lastRead = performance.now();
    let timer: number | undefined;

    const visible = () => document.visibilityState === "visible";

    function schedule() {
      window.clearTimeout(timer);
      if (!active) return;
      const delay = visible() ? Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS) : HIDDEN_POLL_MS;
      timer = window.setTimeout(() => void read(true), delay);
    }

    /** `periodic`: a timer, a return to the tab or back online, not a navigation (whose page is fresh already). */
    async function read(periodic: boolean) {
      if (!active || inFlight) return;
      window.clearTimeout(timer);
      inFlight = true;
      const startedAt = performance.now();
      const result = await fetchLiveCounts();
      inFlight = false;
      if (!active) return;
      lastRead = performance.now();
      apply(result, periodic, startedAt);
      schedule();
    }

    function apply(result: LiveCounts, periodic: boolean, startedAt: number) {
      if (result.status === "signed-out") {
        active = false;
        setConnectionLost(false);
        if (watchOrders) setCount("newOrders", null);
        if (watchRequests) setCount("pendingRequests", null);
        return;
      }
      if (result.status === "failed") {
        failures += 1;
        if (failures >= FAILS_BEFORE_NOTICE) setConnectionLost(true);
        return;
      }
      failures = 0;
      setConnectionLost(false);
      // An `ok` answer with no count at all: the role changed under this session and no longer sees any (a failed
      // count is null only beside one that was read). Nothing left to read.
      if (result.newOrders === null && result.pendingRequests === null) active = false;
      // A server render handed over newer counts while this read was on its way: they win.
      if (seededAt.current > startedAt) return;

      if (watchRequests) setCount("pendingRequests", result.pendingRequests);
      if (watchOrders) {
        const before = known.current.newOrders;
        const now = result.newOrders;
        setCount("newOrders", now);
        // Only a change between two real readings counts: an unknown baseline (the first read, a failed count) is
        // never a "new order".
        if (typeof before === "number" && typeof now === "number" && now !== before) {
          if (now > before) {
            if (visible()) showToast(now - before);
            else unseenAdded += now - before;
          }
          if (periodic && REFRESHED_PATHS.has(pathRef.current)) refreshDue.current = true;
        }
      }
      refreshIfSafe();
    }

    function refreshIfSafe() {
      if (!refreshDue.current || !visible() || !REFRESHED_PATHS.has(pathRef.current) || pageIsBusy()) return;
      refreshDue.current = false;
      router.refresh();
    }

    const onVisibility = () => {
      if (!visible()) {
        // Slow down: the next read in 2 minutes.
        if (!inFlight) schedule();
        return;
      }
      if (unseenAdded > 0) {
        showToast(unseenAdded);
        unseenAdded = 0;
      }
      if (performance.now() - lastRead >= MIN_GAP_MS) void read(true);
      else {
        refreshIfSafe();
        if (!inFlight) schedule();
      }
    };
    const onOnline = () => void read(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    readSoon.current = () => {
      if (performance.now() - lastRead >= MIN_GAP_MS) void read(false);
    };
    schedule();

    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      readSoon.current = null;
    };
  }, [enabled, watchOrders, watchRequests, setCount, showToast, router]);

  // "(3) " before the tab title while there are new orders. Next.js replaces the <title> on each navigation, so a
  // watch on <head> puts the prefix back; it is idempotent, so its own change does not loop.
  const titleCount = watchOrders ? counts.newOrders : undefined;
  useEffect(() => {
    const prefix = typeof titleCount === "number" && titleCount > 0 ? `(${titleCount > 99 ? "99+" : titleCount}) ` : "";
    const apply = () => {
      const title = prefix + document.title.replace(TITLE_PREFIX, "");
      if (document.title !== title) document.title = title;
    };
    apply();
    if (!prefix) return;
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = document.title.replace(TITLE_PREFIX, "");
    };
  }, [titleCount]);

  const value = useMemo(
    () => ({ counts, seed, connectionLost, toast, dismissToast }),
    [counts, seed, connectionLost, toast, dismissToast],
  );
  return <LiveContext value={value}>{children}</LiveContext>;
}

/**
 * A sidebar pill's count: the server's count it was rendered with, replaced by each live read. Every server render of
 * the layout hands over a new `server` object, which wins over the last read even when the number is unchanged (after
 * an order is confirmed the pill drops at once, and that number is the baseline the next read is compared with).
 */
export function useLiveCount(key: LiveKey, server: ServerCount): number | null {
  const live = useContext(LiveContext);
  const seed = live?.seed;
  useLayoutEffect(() => {
    seed?.(key, server.count);
  }, [seed, key, server]);
  const value = live?.counts[key];
  return value === undefined ? server.count : value;
}

/**
 * The top bar's connection notice: after two failed reads in a row, "No connection — figures may be old", short on
 * phones. Announced through a live region that is always in the page.
 */
export function ConnectionNotice({ locale }: { locale: Locale }) {
  const lost = useContext(LiveContext)?.connectionLost ?? false;
  const t = getAdminDictionary(locale).shell.live;
  return (
    <>
      <span role="status" className="sr-only">
        {lost ? t.offline : ""}
      </span>
      {lost && (
        <span aria-hidden="true" title={t.offline} className="adm-badge adm-tone-caution">
          <WifiOff />
          <span className="lg:hidden">{t.offlineShort}</span>
          <span className="hidden lg:inline">{t.offline}</span>
        </span>
      )}
    </>
  );
}

const noop = () => {};

/** The new-order toast, with a link to the new orders. */
export function LiveToast({ locale }: { locale: Locale }) {
  const live = useContext(LiveContext);
  const t = getAdminDictionary(locale).shell.live;
  const toast = live?.toast ?? null;
  const message: ToastMessage | null = toast
    ? { id: toast.id, text: t.newOrders(toast.added), action: { href: NEW_ORDERS_HREF, label: t.open } }
    : null;
  return <Toast message={message} onDismiss={live?.dismissToast ?? noop} dismissLabel={t.dismiss} />;
}
