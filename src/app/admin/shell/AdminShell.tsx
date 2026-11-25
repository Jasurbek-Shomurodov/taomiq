"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { ConnectionNotice, LiveToast, LiveUpdates } from "./live";
import { MobileDrawer } from "./MobileDrawer";
import type { NavItemView } from "./nav";
import { setRailCollapsed, syncRailFromStorage, useRailCollapsed } from "./rail";
import { ShellLocaleContext } from "./ShellLocale";
import { Sidebar, type ShellAccount, type ShellLabels } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * The back-office frame: grouped sidebar on the left (a 256 px rail from lg, folded away and remembered per
 * device; a drawer below lg), the top bar, and <main>, the only part that scrolls. Live updates (live.tsx) keep
 * the sidebar counts current for the roles that see them, with a toast for new orders and a connection notice.
 */
export function AdminShell({
  lang,
  locale,
  items,
  badges,
  account,
  labels,
  live,
  children,
}: {
  /** BCP 47 tag of the panel language: the root <html lang> cannot know it. */
  lang: string;
  locale: Locale;
  items: NavItemView[];
  badges: Partial<Record<NavItemView["key"], ReactNode>>;
  account: ShellAccount;
  labels: ShellLabels;
  /** Which counts this role sees, so which ones the live updates read (none: no reads at all). */
  live: { orders: boolean; requests: boolean };
  children: ReactNode;
}) {
  const collapsed = useRailCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A soft navigation into the panel (sign-in) skips the inline RailScript: apply the saved fold here.
  useEffect(() => {
    syncRailFromStorage();
  }, []);

  // Folding makes the rail inert and unfolding hides the button just pressed, so focus would fall to <body>. After
  // a fold or unfold the person asked for, move it to the control that now does the opposite.
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const railHideRef = useRef<HTMLButtonElement>(null);
  const focusAfterFold = useRef<"drawer-button" | "rail" | null>(null);
  useEffect(() => {
    const target = focusAfterFold.current;
    if (!target) return;
    focusAfterFold.current = null;
    const frame = window.requestAnimationFrame(() => {
      (target === "rail" ? railHideRef : drawerButtonRef).current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [collapsed]);

  function foldRail() {
    focusAfterFold.current = "drawer-button";
    setRailCollapsed(true);
  }

  // Any navigation closes the drawer (a row, the logo, Back in the browser).
  const pathname = usePathname();
  const [drawerPath, setDrawerPath] = useState(pathname);
  if (pathname !== drawerPath) {
    setDrawerPath(pathname);
    setDrawerOpen(false);
  }

  function openDrawer() {
    if (window.matchMedia("(min-width: 64rem)").matches) {
      focusAfterFold.current = "rail";
      setRailCollapsed(false);
    } else setDrawerOpen(true);
  }

  const titles = Object.fromEntries(items.map((item) => [item.key, item.label]));
  const sidebar = { items, badges, account, locale, labels };

  return (
    <LiveUpdates watchOrders={live.orders} watchRequests={live.requests}>
      <div lang={lang} className="adm-shell">
        <div className="adm-rail" inert={collapsed} aria-hidden={collapsed || undefined}>
          <Sidebar placement="rail" onHide={foldRail} hideButtonRef={railHideRef} {...sidebar} />
        </div>

        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} label={labels.mainNav}>
          <Sidebar placement="drawer" onHide={() => setDrawerOpen(false)} onNavigate={() => setDrawerOpen(false)} {...sidebar} />
        </MobileDrawer>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TopBar
            titles={titles}
            openMenuLabel={labels.openMenu}
            themeLabels={labels.theme}
            onOpenDrawer={openDrawer}
            drawerButtonRef={drawerButtonRef}
            status={<ConnectionNotice locale={locale} />}
          />
          {/* relative: absolutely placed children (visually hidden text) stay inside this scroll area. */}
          <main className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <ShellLocaleContext value={locale}>{children}</ShellLocaleContext>
          </main>
        </div>

        <LiveToast locale={locale} />
      </div>
    </LiveUpdates>
  );
}
