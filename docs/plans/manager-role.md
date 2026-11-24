# Plan · Manager role (orders for managers)

## Goal

Managers need to work with orders. Today orders are owner-only and the only non-owner role, `admin`, sees dishes and the 30-day menu. Add a third role:

| Role | Dishes, menu | Orders | Programs and prices | Team | Dashboard order figures |
|---|---|---|---|---|---|
| `owner` | yes | yes | yes | yes | yes |
| `manager` (new) | yes | **yes: list, detail, status, staff note, new-orders badge** | no | no | no |
| `admin` | yes | no | no | no | no |

The owner picks the role when approving a request and can switch a team member between `admin` and `manager` later.

## User flow

- **Owner, Team screen:** Approve asks which role (Administrator / Manager) in the confirmation dialog, with one line saying what each sees. Each non-owner row in "Team" gets a role control (same two options, confirmation naming the email). The info notice at the top describes both roles.
- **Manager:** signs in, sees Overview, **Orders** (with the new-orders count), Menu, Dishes. Opening `/programs` or `/team` sends them to `/` as it does for admins. The overview shows the catalogue part only, as for admins.

## Architecture

- `src/lib/admin/auth.ts`: `StaffMember.role` becomes `"owner" | "manager" | "admin"`; add `requireOrdersAccess()` (owner or manager, otherwise `redirect("/")`), next to `requireOwner()`. Add one helper `canHandleOrders(role)` and use it everywhere instead of comparing strings.
- Orders screens and actions switch from `requireOwner()` to `requireOrdersAccess()`: `(panel)/orders/page.tsx`, `(panel)/orders/[id]/page.tsx`, the order status and staff-note actions, `NewOrdersBadge`, and the new-orders count action in `src/lib/admin/actions.ts`. Programs, prices, settings, team and the dashboard order figures (`stats.ts`, `(panel)/page.tsx`) stay `requireOwner()` / owner-only. Check every `requireOwner` / `role === "owner"` site one by one; do not search-and-replace.
- If an orders screen reads `public.profiles` (owner-only by policy), it must still render for a manager: an order row already carries the customer's name, phone and address. Do not widen the profiles policy.
- `src/app/admin/shell/nav.ts`: replace `ownerOnly: boolean` with `roles` (the roles that see the row); the layout filters by the member's role and shows the orders badge to owner and manager.
- `src/lib/admin/team.ts`: `STAFF_ROLES` gains `manager`; grantable roles are `admin` and `manager`.
- Team actions: `approveAccess` takes the chosen role — calls `approve_staff_request` (grants `admin`), then `set_staff_role` when the choice is `manager`; if the second call fails the member stays `admin` and the owner sees the error. New action `changeStaffRole`.
- Dictionaries (ru / uz / uzc): `roles.manager`, the role chooser, the role descriptions, the changed notice. "Manager" in Russian: «Менеджер».

## Data model — migration `0009_manager_role.sql`

1. `staff_role_check` allows `('owner', 'manager', 'admin')`. A check constraint cannot be altered in place, so this is `drop constraint` + `add constraint` in one transaction. It only widens what is allowed; no row changes. (**Contains `DROP`: by the repo's rule the shipper stops for the owner's yes.**)
2. `private.can_handle_orders()` — same shape as `private.is_owner()` (sql, stable, security definer, `search_path = ''`), true for `owner` and `manager`. Grants as `is_owner`.
3. `alter policy "owner read orders"` and `"owner update orders"` on `public.orders` to use `(select private.can_handle_orders())`. The column grant (`status`, `staff_note`) and the status-transition trigger are unchanged, so a manager can change exactly what the owner can on an order and nothing else.
4. `public.set_staff_role(p_user_id uuid, p_role text)` — owner only (42501 otherwise), `p_role` must be `admin` or `manager`, the target must exist and must not be an owner (P0002 otherwise). Security definer, `search_path = ''`, revoke from public/anon, grant execute to authenticated. This path can never create or demote an owner.

No change to `profiles`, `programs`, `settings`, `staff_requests` or their policies. `approve_staff_request` is unchanged.

## Design rules

Admin kit, three locales, phone-first; role shown with the existing `Badge`; the role control must be usable at 44 px on a phone; busy and error states as on the rest of the Team screen.

## Slices

1. **Manager role.** Migration 0009, auth helper, orders gates, nav, Team role chooser and role change, dictionaries. Reviewer: always (RLS, personal data in orders).

## Risks and open questions

- A manager sees every customer's name, phone and address in orders — that is the point, and why the role is granted only by the owner.
- A manager can change order status and the staff note, not only read. If read-only is wanted, drop the update policy change and hide the controls.
- Dashboard order figures (revenue, funnel) stay owner-only; say so if managers should see them.
- Existing members keep their role: DeeL Must stays `admin` until the owner switches them on the Team screen.
- A separate research session is looking at admin / manager / cook roles; this plan adds only `manager` and keeps the role list in one place so more can follow.
