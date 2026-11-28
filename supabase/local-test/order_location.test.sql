-- Checks of the order's map point (0032_order_location.sql) on the throwaway local Postgres of
-- scripts/test-migrations.sh, which runs every supabase/local-test/*.test.sql after the migrations. One transaction,
-- rolled back at the end: nothing stays. A failed check raises and stops the script (ON_ERROR_STOP).
-- Users, orders and points are made up. The checks print nothing; only the last line says they passed.
\o /dev/null
begin;

create schema t;
grant usage on schema t to anon, authenticated, service_role;

-- Runs p_sql and passes only when it fails with an error whose message contains p_msg.
create function t.expect_error(p_sql text, p_msg text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if position(p_msg in sqlerrm) = 0 then
        raise exception 'expected "%", got "%" from: %', p_msg, sqlerrm, p_sql;
      end if;
      return;
  end;
  raise exception 'expected "%" but it succeeded: %', p_msg, p_sql;
end;
$$;

create function t.check(p_ok boolean, p_what text)
returns void
language plpgsql
as $$
begin
  if p_ok is not true then
    raise exception 'check failed: %', p_what;
  end if;
end;
$$;

grant execute on all functions in schema t to anon, authenticated, service_role;

-- ---------- data ----------
select (now() at time zone 'Asia/Tashkent')::date as today \gset

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'manager@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'kitchen@example.test'),
  ('00000000-0000-0000-0000-0000000000d3', 'customer@example.test');
insert into public.staff (user_id, name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner', 'owner'),
  ('00000000-0000-0000-0000-0000000000b2', 'Manager', 'manager'),
  ('00000000-0000-0000-0000-0000000000c2', 'Kitchen', 'admin');
insert into public.programs (id, slug, name) values ('00000000-0000-0000-0000-00000000c001', 't-balance', 'BALANCE');
insert into public.program_variants (id, program_id, kcal, price_per_day)
values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c001', 1800, 255000);

-- O1: a running order that delivers today. O2: another one, without a point.
insert into public.orders (status, variant_id, program_name, kcal, days, start_date, price_per_day, total, customer_name,
  phone, address, delivery_window)
values ('active', '00000000-0000-0000-0000-00000000c002', 'BALANCE', 1800, 14, :'today'::date - 1, 255000, 3570000,
  'Test A', '+998900000001', 'Test street 1', '07:00–09:00')
returning number as o1, id as o1_id \gset
insert into public.orders (status, variant_id, program_name, kcal, days, start_date, price_per_day, total, customer_name,
  phone, address, delivery_window)
values ('paid', '00000000-0000-0000-0000-00000000c002', 'BALANCE', 1800, 7, :'today'::date, 255000, 1785000,
  'Test B', '+998900000002', 'Test street 2', '07:00–09:00')
returning number as o2, id as o2_id \gset

-- ---------- 1. the columns: null by default, and the check ----------
select t.check(
  (select delivery_lat is null and delivery_lng is null from public.orders where id = :'o1_id'),
  'a new order has no point'
);
-- Inside the box, corners included.
update public.orders set delivery_lat = 41.311081, delivery_lng = 69.240562 where id = :'o1_id';
update public.orders set delivery_lat = 40.9, delivery_lng = 68.9 where id = :'o2_id';
update public.orders set delivery_lat = 41.6, delivery_lng = 69.8 where id = :'o2_id';
update public.orders set delivery_lat = null, delivery_lng = null where id = :'o2_id';
-- One without the other, or outside the box.
select t.expect_error(
  format('update public.orders set delivery_lat = 41.3, delivery_lng = null where id = %L', :'o2_id'),
  'orders_delivery_location_valid'
);
select t.expect_error(
  format('update public.orders set delivery_lat = null, delivery_lng = 69.2 where id = %L', :'o2_id'),
  'orders_delivery_location_valid'
);
select t.expect_error(
  -- Samarkand.
  format('update public.orders set delivery_lat = 39.654167, delivery_lng = 66.959722 where id = %L', :'o2_id'),
  'orders_delivery_location_valid'
);
select t.expect_error(
  format('update public.orders set delivery_lat = 41.600001, delivery_lng = 69.2 where id = %L', :'o2_id'),
  'orders_delivery_location_valid'
);
select t.expect_error(
  format('update public.orders set delivery_lat = 41.3, delivery_lng = 68.899999 where id = %L', :'o2_id'),
  'orders_delivery_location_valid'
);
-- Lat and lng swapped.
select t.expect_error(
  format('update public.orders set delivery_lat = 69.24, delivery_lng = 41.31 where id = %L', :'o2_id'),
  'orders_delivery_location_valid'
);
-- Kept to 6 decimals.
update public.orders set delivery_lat = 41.31108149, delivery_lng = 69.24056251 where id = :'o1_id';
select t.check(
  (select delivery_lat = 41.311081 and delivery_lng = 69.240563 from public.orders where id = :'o1_id'),
  'six decimals are kept'
);
update public.orders set delivery_lat = null, delivery_lng = null where id = :'o1_id';

-- ---------- 2. anon and authenticated may not call set_order_location or write the columns ----------
set role anon;
select t.expect_error(format('select public.set_order_location(%s, 41.3, 69.2)', :o1), 'permission denied');
select t.expect_error('select delivery_lat from public.orders', 'permission denied');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', false);
select t.expect_error(format('select public.set_order_location(%s, 41.3, 69.2)', :o1), 'permission denied');
-- Not even the owner: the point comes from the order form only.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select t.expect_error(format('select public.set_order_location(%s, 41.3, 69.2)', :o1), 'permission denied');
select t.expect_error(
  format('update public.orders set delivery_lat = 41.3, delivery_lng = 69.2 where id = %L', :'o1_id'),
  'permission denied'
);
reset role;
select t.check(
  (select delivery_lat is null and delivery_lng is null from public.orders where id = :'o1_id'),
  'refused calls changed nothing'
);
select t.check(
  not has_function_privilege('anon', 'public.set_order_location(bigint, numeric, numeric)', 'execute')
    and not has_function_privilege('authenticated', 'public.set_order_location(bigint, numeric, numeric)', 'execute')
    and not has_function_privilege('public', 'public.set_order_location(bigint, numeric, numeric)', 'execute')
    and has_function_privilege('service_role', 'public.set_order_location(bigint, numeric, numeric)', 'execute'),
  'execute is granted to service_role only'
);

-- ---------- 3. service_role sets and clears the point ----------
select count(*) as events_before from public.order_events where order_id = :'o1_id' \gset
set role service_role;
select public.set_order_location(:o1, 41.31108149, 69.24056251);
select t.expect_error(format('select public.set_order_location(%s, 41.3, null)', :o1), 'invalid_location');
select t.expect_error(format('select public.set_order_location(%s, null, 69.2)', :o1), 'invalid_location');
select t.expect_error(format('select public.set_order_location(%s, 39.654167, 66.959722)', :o1), 'invalid_location');
select t.expect_error(format('select public.set_order_location(%s, 69.24, 41.31)', :o1), 'invalid_location');
select t.expect_error(format('select public.set_order_location(%s, 41.3, 69.2)', 999999999), 'not_found');
reset role;
select t.check(
  (select delivery_lat = 41.311081 and delivery_lng = 69.240563 from public.orders where id = :'o1_id'),
  'the point is stored, rounded to six decimals'
);
select t.check(
  (select count(*) from public.order_events where order_id = :'o1_id') = :events_before,
  'setting the point writes no order event (no Telegram message)'
);
-- Both null clears it (a removal on request).
set role service_role;
select public.set_order_location(:o2, 41.2, 69.3);
select public.set_order_location(:o2, null, null);
reset role;
select t.check(
  (select delivery_lat is null and delivery_lng is null from public.orders where id = :'o2_id'),
  'null, null clears the point'
);

-- ---------- 4. staff still update orders directly (the check runs with their rights) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
update public.orders set staff_note = 'Call first' where id = :'o1_id';
reset role;
select t.check(
  (select delivery_lat = 41.311081 and staff_note = 'Call first' from public.orders where id = :'o1_id'),
  'a note leaves the point as it is'
);

-- ---------- 5. delivery_orders_v2: owners and managers see the point, nobody else sees a row ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select t.check(
  (select delivery_lat = 41.311081 and delivery_lng = 69.240563 and address = 'Test street 1'
   from public.delivery_orders_v2(:'today'::date) where number = :o1),
  'a manager reads the point of today''s delivery'
);
select t.check(
  (select delivery_lat is null and delivery_lng is null from public.delivery_orders_v2(:'today'::date) where number = :o2),
  'an order without a point reads null'
);
-- The same rows as delivery_orders.
select t.check(
  (select array_agg(number order by number) from public.delivery_orders_v2(:'today'::date))
    = (select array_agg(number order by number) from public.delivery_orders(:'today'::date)),
  'v2 returns the rows of delivery_orders'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select t.check(
  (select count(*) from public.delivery_orders_v2(:'today'::date)) = 2,
  'the owner reads both deliveries'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
select t.check(
  (select count(*) from public.delivery_orders_v2(:'today'::date)) = 0,
  'kitchen staff (admin) get no rows'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', false);
select t.check(
  (select count(*) from public.delivery_orders_v2(:'today'::date)) = 0,
  'a customer gets no rows'
);
reset role;
set role anon;
select t.expect_error(format('select * from public.delivery_orders_v2(%L)', :'today'), 'permission denied');
reset role;

rollback;
\o
\echo order location checks passed
