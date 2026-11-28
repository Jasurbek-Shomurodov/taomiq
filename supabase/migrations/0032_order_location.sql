-- "Share my location" on the order form: an optional map point for the courier, kept on the order beside the text
-- address. Plan: docs/plans/customer-site-improvements.md, round 1, item 7.
--
-- ADDITIVE ONLY. Two new nullable columns (every existing order keeps null: no location) and their check, and two new
-- functions. No table, column, row, constraint, policy, grant or existing function is dropped or changed; no DROP,
-- TRUNCATE, DELETE or UPDATE of existing rows. public.submit_order, staff_create_order, staff_edit_order and
-- delivery_orders are not touched (a new parameter or a new return column would need a DROP): the order action sets
-- the point with set_order_location right after submit_order (as set_order_exclusion_tags, 0031), and the delivery
-- sheet reads delivery_orders_v2. Depends on 0028 (private.order_day_index_paused, private.order_pause_span).
--
-- The point is stored only when the customer taps "Share my location"; it is used only for delivery. The text address
-- stays required and stays the authority: a staff edit of the address leaves the point as it is (staff see both).
-- It is never copied to profiles (saved delivery details), Telegram messages, analytics or the kitchen's rows.
--
--   1. orders.delivery_lat, orders.delivery_lng numeric(9,6), nullable, check orders_delivery_location_valid: both null,
--      or both set and inside Tashkent's wider bounding box (lat 40.9 .. 41.6, lng 68.9 .. 69.8; Tashkent city and
--      the nearby parts of Tashkent region). numeric(9,6) keeps 6 decimals (about 0.1 m). Read like every other
--      column of orders (owners and managers, 0004/0012; the order page selects them). Not added to any update grant:
--      clients never write them.
--   2. public.set_order_location(number, lat, lng)  (service_role only: revoked from public, anon and authenticated)
--      sets the point of the order with that number; both null clears it (a removal on request is
--      `select public.set_order_location(<number>, null, null)` in the SQL editor). Called by the server's order action
--      after a new order is saved and on a retry that found it saved; a failure there is logged and never fails the
--      order. Errors: invalid_location (22023: only one of the two given, or outside the box), not_found (P0002). The
--      update changes no column that the history trigger (0018, private.log_order_event) records, so it writes no
--      order event and sends no Telegram message. In public, not private, because the server reaches functions
--      through the API, which serves public only (as set_order_exclusion_tags).
--   3. public.delivery_orders_v2(date)  public.delivery_orders (0028, 5b) plus delivery_lat and delivery_lng: same
--      rows, same rule, owners and managers only. delivery_orders keeps its return type (changing it needs a DROP);
--      the sheet reads v2 and falls back to delivery_orders while this migration is not applied.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended for
-- delivery_orders_v2, as for delivery_orders (0010): the role check is in its where clause.

-- ---------- 1. orders.delivery_lat, delivery_lng ----------
-- Written out in full: a check passes on null, so "between" alone would let one coordinate without the other through.
alter table public.orders
  add column delivery_lat numeric(9, 6),
  add column delivery_lng numeric(9, 6),
  add constraint orders_delivery_location_valid check (
    (delivery_lat is null and delivery_lng is null)
    or (
      delivery_lat is not null and delivery_lng is not null
      and delivery_lat between 40.9 and 41.6
      and delivery_lng between 68.9 and 69.8
    )
  );

-- ---------- 2. set_order_location ----------
create or replace function public.set_order_location(p_number bigint, p_lat numeric, p_lng numeric)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (
    (p_lat is null and p_lng is null)
    or (
      p_lat is not null and p_lng is not null
      and round(p_lat, 6) between 40.9 and 41.6
      and round(p_lng, 6) between 68.9 and 69.8
    )
  ) then
    raise exception 'invalid_location' using errcode = '22023';
  end if;

  if not exists (select 1 from public.orders o where o.number = p_number) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Only when the point changes: an unchanged retry must not move updated_at, or a staff edit form opened meanwhile
  -- would be refused as stale (staff_edit_order, 0018).
  update public.orders o
  set delivery_lat = round(p_lat, 6),
      delivery_lng = round(p_lng, 6)
  where o.number = p_number
    and (o.delivery_lat, o.delivery_lng) is distinct from (round(p_lat, 6), round(p_lng, 6));
end;
$$;

revoke all on function public.set_order_location(bigint, numeric, numeric) from public, anon, authenticated;
grant execute on function public.set_order_location(bigint, numeric, numeric) to service_role;

-- ---------- 3. delivery_orders_v2 ----------
-- The body of public.delivery_orders (0028, 5b) plus o.delivery_lat and o.delivery_lng.
create or replace function public.delivery_orders_v2(p_date date)
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
  staff_note text,
  delivery_lat numeric,
  delivery_lng numeric
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
    o.staff_note,
    o.delivery_lat,
    o.delivery_lng
  from public.orders o
  cross join lateral (
    select private.order_day_index_paused(o.id, o.start_date, o.weekdays_only, p_date) as day_index
  ) x
  where (select private.can_handle_orders())
    and p_date is not null
    and o.status in ('confirmed', 'paid', 'active')
    and o.start_date <= p_date
    and p_date - o.start_date < (o.days + private.order_pause_span(o.id)) * 2 + 7
    and x.day_index between 1 and o.days
  order by o.delivery_window, o.address, o.number;
$$;

revoke all on function public.delivery_orders_v2(date) from public, anon;
grant execute on function public.delivery_orders_v2(date) to authenticated;

-- ---------- 4. set_order_exclusion_tags: no update when nothing changes ----------
-- CREATE OR REPLACE of the 0031 function, same signature, return type, security and grants. The only change: an
-- unchanged retry no longer rewrites the row, so updated_at stays and a staff edit form opened meanwhile is not
-- refused as stale (staff_edit_order, 0018).
create or replace function public.set_order_exclusion_tags(p_number bigint, p_tags text[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_keys constant text[] :=
    array['gluten', 'milk', 'egg', 'nuts', 'peanut', 'fish', 'seafood', 'sesame', 'soy', 'mushrooms'];
  v_tags text[];
begin
  if not private.exclusion_tags_valid(coalesce(p_tags, '{}')) then
    raise exception 'invalid_tags' using errcode = '22023';
  end if;

  select coalesce(array_agg(k.key order by k.place), '{}')
    into v_tags
  from unnest(v_keys) with ordinality as k(key, place)
  where k.key = any (coalesce(p_tags, '{}'));

  if not exists (select 1 from public.orders o where o.number = p_number) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.orders o
  set exclusion_tags = v_tags
  where o.number = p_number
    and o.exclusion_tags is distinct from v_tags;
end;
$$;

revoke all on function public.set_order_exclusion_tags(bigint, text[]) from public, anon, authenticated;
grant execute on function public.set_order_exclusion_tags(bigint, text[]) to service_role;
