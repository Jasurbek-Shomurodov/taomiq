"use client";

import { usePathname } from "next/navigation";
import type { Ref } from "react";
import { activeNavKey, type NavKey } from "./nav";
import { attachActionsSlot, attachBackSlot, attachTabsSlot, attachTitleSlot, useSlotFilled } from "./TopBarSlot";

/** Two staggered bars, the long one over the short: the drawer's menu mark. */
function DrawerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
      <path d="M4 8h16" />
      <path d="M4 16h10" />
    </svg>
  );
}

/**
 * The one top bar (60 px): the drawer button (phones and tablets, or desktop while the rail is folded), the page's
 * back arrow, its title, its tabs, and its actions on the right. The title is the nav label of the current section
 * unless the page sets its own (<TopBarTitle>); the page fills the other slots through TopBarSlot.tsx.
 */
export function TopBar({
  titles,
  openMenuLabel,
  onOpenDrawer,
  drawerButtonRef,
}: {
  /** Nav labels in the panel's language, the default titles. */
  titles: Partial<Record<NavKey, string>>;
  openMenuLabel: string;
  onOpenDrawer: () => void;
  drawerButtonRef?: Ref<HTMLButtonElement>;
}) {
  const section = activeNavKey(usePathname());
  const hasTitle = useSlotFilled("title");
  const hasTabs = useSlotFilled("tabs");

  return (
    <header className="adm-topbar" data-tabs={hasTabs || undefined}>
      <div className="adm-topbar-lead">
        <button
          ref={drawerButtonRef}
          type="button"
          onClick={onOpenDrawer}
          aria-label={openMenuLabel}
          title={openMenuLabel}
          className="adm-drawer-btn adm-btn adm-btn-outline adm-btn-icon"
        >
          <DrawerIcon />
        </button>
        <div ref={attachBackSlot} className="contents" />
        <h1 className="adm-topbar-title">
          <span ref={attachTitleSlot} className="contents" />
          {!hasTitle && section && <span className="adm-truncate">{titles[section]}</span>}
        </h1>
      </div>
      <div ref={attachTabsSlot} className="adm-topbar-tabs" />
      <div className="adm-topbar-trail">
        <div ref={attachActionsSlot} className="flex items-center gap-2" />
        {/* The theme toggle goes here, after the page actions (slice 5 of the plan). */}
      </div>
    </header>
  );
}
