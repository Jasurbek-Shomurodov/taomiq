import { CalendarDays, LayoutDashboard, ShoppingBag, Tags, UtensilsCrossed, type LucideIcon } from "lucide-react";

/** Sidebar groups, in display order. The overview group has no heading. */
export const NAV_GROUPS = ["overview", "sales", "kitchen", "business"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

/** Sidebar rows. `key` is also the label key in the admin dictionary's `nav`. */
export const NAV = [
  { key: "overview", href: "/", icon: LayoutDashboard, group: "overview", ownerOnly: false },
  { key: "orders", href: "/orders", icon: ShoppingBag, group: "sales", ownerOnly: true },
  { key: "menu", href: "/menu", icon: CalendarDays, group: "kitchen", ownerOnly: false },
  { key: "dishes", href: "/dishes", icon: UtensilsCrossed, group: "kitchen", ownerOnly: false },
  { key: "programs", href: "/programs", icon: Tags, group: "business", ownerOnly: true },
] as const satisfies readonly { key: string; href: string; icon: LucideIcon; group: NavGroup; ownerOnly: boolean }[];

export type NavKey = (typeof NAV)[number]["key"];

/** A sidebar row as the server layout hands it to the shell: allowed for this role, labelled in their language. */
export type NavItemView = { key: NavKey; label: string };

/**
 * The panel path without the /admin prefix. On the admin host the proxy rewrites /x to /admin/x, so the server
 * render may see either form; the browser always shows /x.
 */
export function panelPath(pathname: string | null): string {
  const path = (pathname ?? "/").replace(/^\/admin(?=\/|$)/, "");
  return path === "" ? "/" : path;
}

/** The nav row a path belongs to: `/` only exactly, every other row by prefix (/dishes/123 → dishes). */
export function activeNavKey(pathname: string | null): NavKey | null {
  const path = panelPath(pathname);
  if (path === "/") return "overview";
  const item = NAV.find((entry) => entry.href !== "/" && (path === entry.href || path.startsWith(`${entry.href}/`)));
  return item?.key ?? null;
}
