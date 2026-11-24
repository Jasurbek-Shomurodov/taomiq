-- !! CONTAINS A DROP: `alter table public.staff drop constraint staff_role_check` (statement 1 below). !!
-- By the repo's migration rule the shipper stops for the owner's yes before production.
-- The constraint is dropped and re-added in the same ALTER TABLE statement (atomic), with a wider list: it only
-- widens which roles are allowed. No row, column, table or grant is dropped or changed.
--
-- Manager role: managers handle orders (list, detail, status, staff note) and the delivery sheet on top of what an
-- admin does (dishes, the 30-day menu and the production sheet). Programs, prices, settings, the team and the
-- dashboard revenue figures stay owner only. Plan: docs/plans/manager-role.md, slice 1.
--
--   owner   — everything
--   manager — dishes, menu, production, orders and deliveries
--   admin   — dishes, the 30-day menu and production
--
-- Changes:
--   1. staff_role_check allows 'manager' (see the warning above).
--   2. New function private.can_handle_orders(): true for owner and manager. Same shape as private.is_owner().
--   3. The two orders policies ("owner read orders", "owner update orders", 0004) use it instead of
--      private.is_owner(). Their names are kept (renaming a policy is not needed for the change). The column grant
--      (update on status and staff_note only) and the status-transition trigger are unchanged, so a manager can
--      change exactly what the owner can on an order and nothing else.
--   4. public.delivery_orders(date) (0010) is replaced with the same signature, return type, body and grants; only
--      its role check changes from private.is_owner() to private.can_handle_orders(). It returns the same personal
--      data a manager already reads in orders.
--   5. New function public.set_staff_role(p_user_id, p_role): owner only, sets a non-owner member's role to admin
--      or manager. It can never create or demote an owner.
--
-- Not changed: profiles, programs, settings, staff_requests and their policies; public.kitchen_orders (0009, every
-- staff member, no personal data); approve_staff_request still grants admin (the Team screen calls set_staff_role
-- right after it when the owner picks manager). Neither 0009 nor 0010 depends on the orders policies or on
-- staff_role_check: both functions are security definer and check the role themselves.

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

-- ---------- 4. delivery_orders: owner and manager ----------
-- Body copied from 0010_delivery_orders.sql; only `private.is_owner()` became `private.can_handle_orders()`.
create or replace function public.delivery_orders(p_date date)
returns table (
  id uuid,
  number bigint,
  status text,
  program_name text,
  kcal int,
  variant_id uuid,
  day_index int,
  days int,
  customer_name text,
  phone text,
  address text,
  delivery_window text,
  comment text,
  exclusions text,
  staff_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    o.number,
    o.status,
    o.program_name,
    o.kcal,
    o.variant_id,
    x.day_index,
    o.days,
    o.customer_name,
    o.phone,
    o.address,
    o.delivery_window,
    o.comment,
    o.exclusions,
    o.staff_note
  from public.orders o
  cross join lateral (
    select private.order_day_index(o.start_date, o.weekdays_only, p_date) as day_index
  ) x
  where (select private.can_handle_orders())
    and p_date is not null
    and o.status in ('confirmed', 'paid', 'active')
    and o.start_date <= p_date
    and p_date - o.start_date < o.days * 2 + 7
    and x.day_index between 1 and o.days
  order by o.delivery_window, o.address, o.number;
$$;

-- Same grants as 0010 (create or replace keeps them; restated so this file reads on its own).
revoke all on function public.delivery_orders(date) from public, anon;
grant execute on function public.delivery_orders(date) to authenticated;

-- ---------- 5. set_staff_role ----------
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
