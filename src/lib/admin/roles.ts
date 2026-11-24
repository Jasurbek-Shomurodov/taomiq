/**
 * Back-office roles, highest first, and what each may do. Not server-only: the sidebar list (shell/nav.ts) and the
 * Team screen's role chooser (a client component) use it too. The database holds the same rules: the role list in
 * staff_role_check (migration 0009), the orders roles in private.can_handle_orders() (0009). A new role goes into
 * those, here, and into the dictionaries' `roles` and `team.roleInfo`.
 *
 *   owner   — everything
 *   manager — dishes, the 30-day menu and orders
 *   admin   — dishes and the 30-day menu
 */
export const STAFF_ROLES = ["owner", "manager", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** The roles the owner can give on the Team screen (set_staff_role, 0009). Never owner. The first is the default. */
export const GRANTABLE_ROLES = ["admin", "manager"] as const satisfies readonly StaffRole[];
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export function isGrantableRole(value: unknown): value is GrantableRole {
  return typeof value === "string" && (GRANTABLE_ROLES as readonly string[]).includes(value);
}

/** Who works with orders (customers' names, phones and addresses). Same list as private.can_handle_orders(). */
export const ORDERS_ROLES = ["owner", "manager"] as const satisfies readonly StaffRole[];

export function canHandleOrders(role: unknown): boolean {
  return typeof role === "string" && (ORDERS_ROLES as readonly string[]).includes(role);
}
