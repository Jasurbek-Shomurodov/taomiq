-- Checks of the order exclusion tags (0031_order_exclusion_tags.sql) on the throwaway local Postgres of
-- scripts/test-migrations.sh, which runs every supabase/local-test/*.test.sql after the migrations. One transaction,
-- rolled back at the end: nothing stays. A failed check raises and stops the script (ON_ERROR_STOP).
-- Users and orders are made up. The checks print nothing; only the last line says they passed.
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
  ('00000000-0000-0000-0000-0000000000c2', 'kitchen@example.test'),
  ('00000000-0000-0000-0000-0000000000d3', 'customer@example.test');
insert into public.staff (user_id, name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner', 'owner'),
  ('00000000-0000-0000-0000-0000000000c2', 'Kitchen', 'admin');
insert into public.programs (id, slug, name) values ('00000000-0000-0000-0000-00000000c001', 't-balance', 'BALANCE');
insert into public.program_variants (id, program_id, kcal, price_per_day)
values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c001', 1800, 255000);

-- O1: a running order that delivers today. O2: a new order (not cooked, not in the kitchen's rows).
insert into public.orders (status, variant_id, program_name, kcal, days, start_date, price_per_day, total, customer_name,
  phone, address, delivery_window, exclusions)
values ('active', '00000000-0000-0000-0000-00000000c002', 'BALANCE', 1800, 14, :'today'::date - 1, 255000, 3570000,
  'Test A', '+998900000001', 'Test street 1', '07:00–09:00', 'Без: молоко, орехи. лук')
returning number as o1, id as o1_id \gset
insert into public.orders (status, variant_id, program_name, kcal, days, start_date, price_per_day, total, customer_name,
  phone, address, delivery_window)
values ('new', '00000000-0000-0000-0000-00000000c002', 'BALANCE', 1800, 7, :'today'::date + 3, 255000, 1785000,
  'Test B', '+998900000002', 'Test street 2', '07:00–09:00')
returning number as o2, id as o2_id \gset

-- ---------- 1. the column: empty by default, and the check ----------
select t.check(
  (select exclusion_tags = '{}' from public.orders where id = :'o1_id'),
  'a new order has no tags'
);
select t.check(private.exclusion_tags_valid('{}'), 'empty list is valid');
select t.check(private.exclusion_tags_valid('{milk,nuts}'), 'known keys are valid');
select t.check(
  private.exclusion_tags_valid('{gluten,milk,egg,nuts,peanut,fish,seafood,sesame,soy,mushrooms}'),
  'all ten keys are valid'
);
select t.check(not private.exclusion_tags_valid(null), 'null is not valid');
select t.check(not private.exclusion_tags_valid('{milk,milk}'), 'a duplicate is not valid');
select t.check(not private.exclusion_tags_valid('{honey}'), 'a key off the list is not valid');
select t.check(not private.exclusion_tags_valid('{Milk}'), 'keys are lower case');
select t.check(not private.exclusion_tags_valid(array['milk', null]), 'a null element is not valid');
select t.check(not private.exclusion_tags_valid('{{milk},{nuts}}'), 'a two-dimensional list is not valid');

select t.expect_error(
  format('update public.orders set exclusion_tags = %L where id = %L', '{milk,milk}', :'o1_id'),
  'orders_exclusion_tags_valid'
);
select t.expect_error(
  format('update public.orders set exclusion_tags = %L where id = %L', '{eggs}', :'o1_id'),
  'orders_exclusion_tags_valid'
);
select t.expect_error(
  format('update public.orders set exclusion_tags = null where id = %L', :'o1_id'),
  'null value'
);

-- ---------- 2. anon and authenticated may not call set_order_exclusion_tags ----------
set role anon;
select t.expect_error(format('select public.set_order_exclusion_tags(%s, %L)', :o1, '{milk}'), 'permission denied');
select t.expect_error('select exclusion_tags from public.orders', 'permission denied');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', false);
select t.expect_error(format('select public.set_order_exclusion_tags(%s, %L)', :o1, '{milk}'), 'permission denied');
-- Not even the owner: the tags come from the order form only.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select t.expect_error(format('select public.set_order_exclusion_tags(%s, %L)', :o1, '{milk}'), 'permission denied');
-- And the column is not in any client update grant.
select t.expect_error(
  format('update public.orders set exclusion_tags = %L where id = %L', '{milk}', :'o1_id'),
  'permission denied'
);
reset role;
select t.check(
  (select exclusion_tags = '{}' from public.orders where id = :'o1_id'),
  'refused calls changed nothing'
);
select t.check(
  not has_function_privilege('anon', 'public.set_order_exclusion_tags(bigint, text[])', 'execute')
    and not has_function_privilege('authenticated', 'public.set_order_exclusion_tags(bigint, text[])', 'execute')
    and has_function_privilege('service_role', 'public.set_order_exclusion_tags(bigint, text[])', 'execute'),
  'execute is granted to service_role only'
);

-- ---------- 3. service_role sets the tags, in the list's order ----------
select count(*) as events_before from public.order_events where order_id = :'o1_id' \gset
set role service_role;
select public.set_order_exclusion_tags(:o1, '{nuts,milk}');
select t.expect_error(format('select public.set_order_exclusion_tags(%s, %L)', :o1, '{milk,milk}'), 'invalid_tags');
select t.expect_error(format('select public.set_order_exclusion_tags(%s, %L)', :o1, '{honey}'), 'invalid_tags');
select t.expect_error(format('select public.set_order_exclusion_tags(%s, %L)', :o1, '{eggs}'), 'invalid_tags');
select t.expect_error(format('select public.set_order_exclusion_tags(%s, %L)', 999999999, '{milk}'), 'not_found');
reset role;
select t.check(
  (select exclusion_tags = '{milk,nuts}' from public.orders where id = :'o1_id'),
  'tags are stored in the list''s order'
);
select t.check(
  (select count(*) from public.order_events where order_id = :'o1_id') = :events_before,
  'setting the tags writes no order event (no Telegram message)'
);
-- A null or empty list clears them.
set role service_role;
select public.set_order_exclusion_tags(:o2, '{mushrooms,egg}');
select public.set_order_exclusion_tags(:o2, null);
reset role;
select t.check(
  (select exclusion_tags = '{}' from public.orders where id = :'o2_id'),
  'null clears the tags'
);

-- ---------- 4. staff still update orders directly (the check runs with their rights) ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
update public.orders set status = 'confirmed' where id = :'o2_id';
update public.orders set staff_note = 'Call first' where id = :'o1_id';
reset role;
select t.check(
  (select status = 'confirmed' from public.orders where id = :'o2_id'),
  'the owner moves a status with the check in place'
);
select t.check(
  (select exclusion_tags = '{milk,nuts}' and staff_note = 'Call first' from public.orders where id = :'o1_id'),
  'a note leaves the tags as they are'
);

-- ---------- 5. kitchen_orders_v2: staff see the tags, nobody else sees a row ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
select t.check(
  (select exclusion_tags = '{milk,nuts}' and exclusions = 'Без: молоко, орехи. лук' and day_index = 2
   from public.kitchen_orders_v2(:'today'::date) where number = :o1),
  'kitchen staff (admin) read the tags of today''s order'
);
select t.check(
  (select count(*) from public.kitchen_orders_v2(:'today'::date)) = 1,
  'only orders that deliver that day'
);
-- The same rows as kitchen_orders.
select t.check(
  (select array_agg(number order by number) from public.kitchen_orders_v2(:'today'::date))
    = (select array_agg(number order by number) from public.kitchen_orders(:'today'::date)),
  'v2 returns the rows of kitchen_orders'
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', false);
select t.check(
  (select count(*) from public.kitchen_orders_v2(:'today'::date)) = 0,
  'a customer gets no rows'
);
reset role;
set role anon;
select t.expect_error(format('select * from public.kitchen_orders_v2(%L)', :'today'), 'permission denied');
reset role;

rollback;
\o
\echo exclusion tags checks passed
