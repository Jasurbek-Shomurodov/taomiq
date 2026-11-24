"use client";

import { LogOut, PanelLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode, Ref } from "react";
import { Lockup } from "@/components/Logo";
import type { Locale } from "@/i18n/config";
import { signOut } from "@/lib/admin/actions";
import { LanguageSegmented } from "../LanguageSwitch";
import { NAV, NAV_GROUPS, activeNavKey, type NavGroup, type NavItemView } from "./nav";
import type { ThemeLabels } from "./ThemeToggle";

export type ShellLabels = {
  mainNav: string;
  openMenu: string;
  closeMenu: string;
  collapse: string;
  home: string;
  signOut: string;
  switcher: string;
  groups: Record<Exclude<NavGroup, "overview">, string>;
  /** The top bar's theme toggle (ThemeToggle.tsx). */
  theme: ThemeLabels;
};

export type ShellAccount = { name: string; email: string; role: string };

/**
 * The sidebar: TAOMIQ lockup with the role, grouped rows and, at the foot, the language switch and the account
 * with sign-out. Rendered twice by the shell: in the desktop rail (its button folds the rail) and in the phone
 * drawer (its button closes the drawer, and so does following a link).
 */
export function Sidebar({
  placement,
  onHide,
  onNavigate,
  hideButtonRef,
  items,
  badges,
  account,
  locale,
  labels,
}: {
  placement: "rail" | "drawer";
  onHide: () => void;
  onNavigate?: () => void;
  /** The fold/close button, for the shell to move focus to. */
  hideButtonRef?: Ref<HTMLButtonElement>;
  items: NavItemView[];
  /** A count pill after a row's label (the new orders), rendered by the server. */
  badges: Partial<Record<NavItemView["key"], ReactNode>>;
  account: ShellAccount;
  locale: Locale;
  labels: ShellLabels;
}) {
  const current = activeNavKey(usePathname());
  const hideLabel = placement === "drawer" ? labels.closeMenu : labels.collapse;
  const displayName = account.name || account.email;
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();
  const allowed = new Map(items.map((item) => [item.key, item.label]));

  return (
    <aside className="adm-sidebar">
      {/* Lockup and role on one side, the sidebar's own fold/close button on the other. */}
      <div className="flex shrink-0 items-center justify-between gap-2 pb-3 pl-4 pr-2.5 pt-3.5">
        <Link
          href="/"
          onNavigate={onNavigate}
          aria-label={`${labels.home} (${account.role})`}
          className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-adm-control"
        >
          <Lockup layout="inline" onDark={false} markSize={28} className="adm-logo text-[15px]" />
          <span className="adm-badge adm-tone-accent truncate">{account.role}</span>
        </Link>
        <button ref={hideButtonRef} type="button" onClick={onHide} aria-label={hideLabel} title={hideLabel} className="adm-btn adm-btn-ghost adm-btn-sm adm-btn-icon">
          <PanelLeft aria-hidden="true" />
        </button>
      </div>

      {/* Rows scroll inside the sidebar when the window is short. */}
      <nav aria-label={labels.mainNav} className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4 pt-0.5">
        {NAV_GROUPS.map((group) => {
          const rows = NAV.filter((entry) => entry.group === group && allowed.has(entry.key));
          if (rows.length === 0) return null;
          const heading = group === "overview" ? null : labels.groups[group];
          return (
            <div key={group} role="group" aria-label={heading ?? undefined} className="mb-4 last:mb-0">
              {heading && <p className="px-2.5 pb-1.5 pt-1 text-[13px] font-medium text-adm-muted">{heading}</p>}
              <ul className="flex flex-col gap-1">
                {rows.map((entry) => {
                  const Icon = entry.icon;
                  const active = entry.key === current;
                  return (
                    <li key={entry.key}>
                      <Link
                        href={entry.href}
                        onNavigate={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className="adm-nav-row"
                      >
                        <Icon aria-hidden="true" strokeWidth={2} />
                        <span className="truncate">{allowed.get(entry.key)}</span>
                        {badges[entry.key] && <span className="ml-auto flex">{badges[entry.key]}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Foot: language, then the signed-in account and sign-out. */}
      <div className="flex shrink-0 flex-col gap-2 p-3">
        <LanguageSegmented locale={locale} label={labels.switcher} />
        {/* Sign-out stays clear of the account line: a session-ending tap is never beside a routine one. */}
        <div className="flex min-w-0 items-center gap-3 pt-1">
          <div className="flex min-w-0 flex-1 items-center gap-2.5 p-1.5">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-full bg-adm-accent-tint text-sm font-semibold text-adm-accent-ink"
            >
              {initial}
            </span>
            <span className="min-w-0 flex-1 leading-[1.35]">
              <strong className="block truncate text-sm font-semibold">{displayName}</strong>
              <span className="block truncate text-[13px] text-adm-muted">
                {account.name && account.email ? account.email : account.role}
              </span>
            </span>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              aria-label={labels.signOut}
              title={labels.signOut}
              className="adm-btn adm-btn-ghost adm-btn-sm adm-btn-icon hover:text-adm-negative"
            >
              <LogOut aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
