-- Delivery sheet: who gets a ration on a date, where and in which window. Owner only.
-- Plan: docs/plans/kitchen-day-sheet.md, slice 2.
--
-- Additive only: one new function. No table, column, index, grant or policy on public.orders changes.
--
-- Same date rule and row filter as public.kitchen_orders (0009): status confirmed, paid or active, start_date <= D,
-- the cheap prefilter `D - start_date < days * 2 + 7`, then private.order_day_index between 1 and days.
--
-- Why a definer function when the owner can read public.orders directly: so both day sheets share one date rule,
-- which lives only in SQL. It checks the role itself (private.is_owner()); anyone else, staff included, gets no
-- rows. The Supabase advisor flags a security definer function callable by authenticated (a warning); that is
-- intended here, for the reason above. anon cannot call it.

-- ---------- delivery_orders ----------
-- Orders that deliver on p_date, with what the route sheet needs: contact, address, window, the customer's comment
-- and exclusions, and the owner's staff note. No source, ip_hash, price or consent data.
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
  where (select private.is_owner())
    and p_date is not null
    and o.status in ('confirmed', 'paid', 'active')
    and o.start_date <= p_date
    and p_date - o.start_date < o.days * 2 + 7
    and x.day_index between 1 and o.days
  order by o.delivery_window, o.address, o.number;
$$;

revoke all on function public.delivery_orders(date) from public, anon;
grant execute on function public.delivery_orders(date) to authenticated;
