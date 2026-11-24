-- !! CONTAINS A DROP: `alter table public.staff drop constraint staff_role_check` (statement 1 below). !!
-- By the repo's migration rule the shipper stops for the owner's yes before production.
-- The constraint is dropped and re-added in the same ALTER TABLE statement (atomic), with a wider list: it only
-- widens which roles are allowed. No row, column, table or grant is dropped or changed.
--
-- Manager role: managers handle orders (list, detail, status, staff note) on top of what an admin does (dishes and
-- the 30-day menu). Programs, prices, settings, the team and the dashboard order figures stay owner only.
-- Plan: docs/plans/manager-role.md, slice 1.
--
--   owner   — everything
--   manager — dishes, menu and orders
--   admin   — dishes and the 30-day menu only
--
-- Changes:
--   1. staff_role_check allows 'manager' (see the warning above).
--   2. New function private.can_handle_orders(): true for owner and manager. Same shape as private.is_owner().
--   3. The two orders policies ("owner read orders", "owner update orders", 0004) use it instead of
--      private.is_owner(). Their names are kept (renaming a policy is not needed for the change). The column grant
--      (update on status and staff_note only) and the status-transition trigger are unchanged, so a manager can
--      change exactly what the owner can on an order and nothing else.
--   4. New function public.set_staff_role(p_user_id, p_role): owner only, sets a non-owner member's role to admin
--      or manager. It can never create or demote an owner.
--
-- Not changed: profiles, programs, settings, staff_requests and their policies; approve_staff_request still grants
-- admin (the Team screen calls set_staff_role right after it when the owner picks manager).

-- ---------- 1. role list ----------
alter table public.staff
  drop constraint staff_role_check,
  add constraint staff_role_check check (role in ('owner', 'manager', 'admin'));

-- ---------- 2. can_handle_orders ----------
create or replace function private.can_handle_orders()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role in ('owner', 'manager')
  );
$$;

revoke all on function private.can_handle_orders() from public;
grant execute on function private.can_handle_orders() to anon, authenticated;

-- ---------- 3. orders: owner and manager ----------
alter policy "owner read orders" on public.orders
  using ((select private.can_handle_orders()));
alter policy "owner update orders" on public.orders
  using ((select private.can_handle_orders())) with check ((select private.can_handle_orders()));

-- ---------- 4. set_staff_role ----------
-- Switches a team member between admin and manager. Owners cannot be changed this way (including the caller), and
-- no call can make anyone an owner.
create or replace function public.set_staff_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if p_role is null or p_role not in ('admin', 'manager') then
    raise exception 'bad_role' using errcode = '22023';
  end if;

  update public.staff s
  set role = p_role
  where s.user_id = p_user_id
    and s.role <> 'owner';
  if not found then
    raise exception 'not_changeable' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_staff_role(uuid, text) from public, anon;
grant execute on function public.set_staff_role(uuid, text) to authenticated;
