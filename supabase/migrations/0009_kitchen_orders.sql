-- Kitchen production sheet: which orders deliver on a date, without any personal data.
-- Plan: docs/plans/kitchen-day-sheet.md, slice 1.
--
-- Additive only: one index and two new functions. No table, column, grant or policy on public.orders changes.
--
-- The date rule lives here, once (private.order_day_index); TypeScript never re-implements it. An order delivers
-- on date D when its status is confirmed, paid or active, D >= start_date, D is Monday to Friday for a
-- weekdays-only order (same rule as isodow in (6, 7) in submit_order), and its day index on D is at most `days`.
--
-- Why a function and not a policy: orders is readable by the owner only (0004_orders.sql) so cooks never see
-- personal data, and a row policy for staff would expose every column of the row. public.kitchen_orders() is a
-- security definer function that returns rows only to staff and only a fixed list of harmless columns: no name,
-- phone, address, comment, staff note, source or ip_hash. Same pattern as public.my_orders() (0007). The Supabase
-- advisor flags a security definer function callable by authenticated (a warning); that is intended here, for
-- the reason above. anon cannot call it.

-- ---------- index ----------
-- The sheet reads by status and start date.
create index orders_status_start on public.orders (status, start_date);

-- ---------- order_day_index ----------
-- Which delivery day of an order a date is: 1 on the start date, counting calendar days, or weekdays only for a
-- weekdays-only order. Null before the start date, and on a Saturday or Sunday of a weekdays-only order (no
-- delivery that day). It does not look at `days`: the caller compares the index with it.
-- A future skips table (frozen or moved days) is read here, so the callers do not change.
create or replace function private.order_day_index(p_start date, p_weekdays_only boolean, p_date date)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_start is null or p_date is null or p_date < p_start then null
    when coalesce(p_weekdays_only, false) and extract(isodow from p_date) in (6, 7) then null
    when coalesce(p_weekdays_only, false) then (
      -- Explicit timestamps: generate_series over dates would otherwise resolve to the timestamptz version.
      select count(*)::int
      from generate_series(p_start::timestamp, p_date::timestamp, interval '1 day') as g(d)
      where extract(isodow from g.d) not in (6, 7)
    )
    else (p_date - p_start) + 1
  end;
$$;

-- Called only from the definer functions below (as their owner); no client role needs it.
revoke all on function private.order_day_index(date, boolean, date) from public, anon, authenticated;

-- ---------- kitchen_orders ----------
-- Orders that deliver on p_date, for the kitchen: number, calorie level, status, day index, length and the
-- customer's exclusions (free text, shown to cooks next to the order number). Staff only; anyone else gets no rows.
-- `p_date - start_date < days * 2 + 7` is a cheap bound before the exact rule: n weekdays span at most
-- 1.4 n + 7 calendar days, so it never drops an order that delivers, and it keeps old orders out of the
-- weekday count.
create or replace function public.kitchen_orders(p_date date)
returns table (
  number bigint,
  variant_id uuid,
  status text,
  day_index int,
  days int,
  exclusions text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.number, o.variant_id, o.status, x.day_index, o.days, o.exclusions
  from public.orders o
  cross join lateral (
    select private.order_day_index(o.start_date, o.weekdays_only, p_date) as day_index
  ) x
  where (select private.is_staff())
    and p_date is not null
    and o.status in ('confirmed', 'paid', 'active')
    and o.start_date <= p_date
    and p_date - o.start_date < o.days * 2 + 7
    and x.day_index between 1 and o.days
  order by o.number;
$$;

revoke all on function public.kitchen_orders(date) from public, anon;
grant execute on function public.kitchen_orders(date) to authenticated;
