import {
  CalendarDays,
  ChartNoAxesCombined,
  ChefHat,
  Contact,
  History,
  LayoutDashboard,
  Settings,
  ShoppingBag,
  Tags,
  Truck,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { ORDERS_ROLES, STAFF_ROLES, type StaffRole } from "@/lib/admin/roles";

/** Sidebar groups, in display order. The overview group has no heading. */
export const NAV_GROUPS = ["overview", "sales", "kitchen", "business"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

const OWNER = ["owner"] as const;

/**
 * Sidebar rows. `key` is also the label key in the admin dictionary's `nav`; `roles` are the roles that see the row.
 * Hiding a row is only the menu: each page checks the role itself (requireOwner / requireOrdersAccess) and RLS too.
 */
export const NAV = [
  { key: "overview", href: "/", icon: LayoutDashboard, group: "overview", roles: STAFF_ROLES },
  { key: "orders", href: "/orders", icon: ShoppingBag, group: "sales", roles: ORDERS_ROLES },
  { key: "deliveries", href: "/deliveries", icon: Truck, group: "sales", roles: ORDERS_ROLES },
  { key: "customers", href: "/customers", icon: Contact, group: "sales", roles: ORDERS_ROLES },
  { key: "production", href: "/kitchen", icon: ChefHat, group: "kitchen", roles: STAFF_ROLES },
  { key: "menu", href: "/menu", icon: CalendarDays, group: "kitchen", roles: STAFF_ROLES },
  { key: "dishes", href: "/dishes", icon: UtensilsCrossed, group: "kitchen", roles: STAFF_ROLES },
  { key: "programs", href: "/programs", icon: Tags, group: "business", roles: OWNER },
  { key: "finance", href: "/finance", icon: Wallet, group: "business", roles: OWNER },
  { key: "reports", href: "/reports", icon: ChartNoAxesCombined, group: "business", roles: OWNER },
  { key: "team", href: "/team", icon: Users, group: "business", roles: OWNER },
  { key: "audit", href: "/audit", icon: History, group: "business", roles: OWNER },
  { key: "settings", href: "/settings", icon: Settings, group: "business", roles: OWNER },
] as const satisfies readonly {
  key: string;
  href: string;
  icon: LucideIcon;
  group: NavGroup;
  roles: readonly StaffRole[];
}[];

export type NavKey = (typeof NAV)[number]["key"];

/** The rows this role sees, in sidebar order. */
export function navFor(role: StaffRole) {
  return NAV.filter((item) => (item.roles as readonly StaffRole[]).includes(role));
}

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
