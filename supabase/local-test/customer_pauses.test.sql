-- Checks of the customer pause functions (0029_customer_pauses.sql) on the throwaway local Postgres of
-- scripts/test-migrations.sh, which runs every supabase/local-test/*.test.sql after the migrations. One transaction,
-- rolled back at the end: nothing stays. A failed check raises and stops the script (ON_ERROR_STOP).
-- Dates are relative to now(), so the checks hold on any day and at any hour; the cutoff rule itself is checked at
-- fixed times. Users and orders are made up.
-- The checks print nothing; only the last line says they passed.
\o /dev/null
begin;

create schema t;
grant usage on schema t to anon, authenticated;

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

grant execute on all functions in schema t to anon, authenticated;

-- ---------- 1. the cutoff rule at fixed times (order_cutoff_hour 14 from 0004) ----------
select t.check(private.customer_pause_first_day('2026-11-28 08:59:59+00') = '2026-11-29', '13:59 Tashkent: tomorrow');
select t.check(private.customer_pause_first_day('2026-11-28 09:00:00+00') = '2026-11-30', '14:00 Tashkent: the day after');
select t.check(private.customer_pause_first_day('2026-11-28 18:59:00+00') = '2026-11-30', '23:59 Tashkent: the day after');
select t.check(private.customer_pause_first_day('2026-11-28 19:00:00+00') = '2026-11-30', '00:00 next day: tomorrow of it');
update public.settings set value = '10' where key = 'order_cutoff_hour';
select t.check(private.customer_pause_first_day('2026-11-28 04:59:00+00') = '2026-11-29', 'cutoff 10: 09:59 tomorrow');
select t.check(private.customer_pause_first_day('2026-11-28 05:00:00+00') = '2026-11-30', 'cutoff 10: 10:00 day after');
delete from public.settings where key = 'order_cutoff_hour';
select t.check(private.customer_pause_first_day('2026-11-28 08:59:00+00') = '2026-11-29', 'no setting: 14 as default');
select t.check(private.customer_pause_first_day('2026-11-28 09:00:00+00') = '2026-11-30', 'no setting: 14 as default');
insert into public.settings (key, value) values ('order_cutoff_hour', '14');

-- ---------- data ----------
select (now() at time zone 'Asia/Tashkent')::date as today, private.customer_pause_first_day(now()) as first \gset

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@example.test');
insert into public.programs (id, slug, name) values ('00000000-0000-0000-0000-00000000c001', 't-balance', 'BALANCE');
insert into public.program_variants (id, program_id, kcal, price_per_day)
values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c001', 1800, 255000);

-- A1: customer A's running order, every day, 20 days from two days ago (ends today + 17).
insert into public.orders (status, variant_id, program_name, kcal, days, start_date, price_per_day, total, customer_name,
  phone, address, delivery_window, user_id)
values ('active', '00000000-0000-0000-0000-00000000c002', 'BALANCE', 1800, 20, :'today'::date - 2, 255000, 5100000,
  'Test A', '+998900000001', 'Test street 1', '07:00–09:00', '00000000-0000-0000-0000-0000000000a1')
returning number as a1, id as a1_id \gset
-- A2: customer A's order not confirmed yet.
insert into public.orders (status, variant_id, program_name, kcal, days, start_date, price_per_day, total, customer_name,
  phone, address, delivery_window, user_id)
values ('new', '00000000-0000-0000-0000-00000000c002', 'BALANCE', 1800, 7, :'today'::date + 5, 255000, 1785000,
  'Test A', '+998900000001', 'Test street 1', '07:00–09:00', '00000000-0000-0000-0000-0000000000a1')
returning number as a2 \gset
-- B1: customer B's running order.
insert into public.orders (status, variant_id, program_name, kcal, days, start_date, price_per_day, total, customer_name,
  phone, address, delivery_window, user_id)
values ('paid', '00000000-0000-0000-0000-00000000c002', 'BALANCE', 1800, 14, :'today'::date + 1, 255000, 3570000,
  'Test B', '+998900000002', 'Test street 2', '07:00–09:00', '00000000-0000-0000-0000-0000000000b2')
returning number as b1, id as b1_id \gset
-- A pause staff set on A1, ten days ahead, and one on B1.
insert into public.order_pauses (order_id, from_date, to_date, source)
values (:'a1_id', :'today'::date + 10, :'today'::date + 10, 'staff')
returning id as staff_pause \gset
insert into public.order_pauses (order_id, from_date, to_date, source)
values (:'b1_id', :'today'::date + 6, :'today'::date + 6, 'customer')
returning id as b_pause \gset

-- ---------- 2. anon is refused outright ----------
set role anon;
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'first', :'first'), 'permission denied');
select t.expect_error(format('select public.cancel_my_pause(%L)', :'staff_pause'), 'permission denied');
select t.expect_error('select * from public.my_order_pauses_v2()', 'permission denied');
reset role;

-- ---------- 3. signed in, but no user id: not_allowed ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'first', :'first'), 'not_allowed');
select t.expect_error(format('select public.cancel_my_pause(%L)', :'staff_pause'), 'not_allowed');
select t.check((select count(*) from public.my_order_pauses_v2()) = 0, 'no user: no pauses');

-- ---------- 4. ownership: B cannot touch A's order or pauses ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'first', :'first'), 'not_found');
select t.expect_error(format('select public.cancel_my_pause(%L)', :'staff_pause'), 'not_found');
select t.check(
  (select count(*) from public.my_order_pauses_v2()) = 1
    and (select bool_and(number = :b1) from public.my_order_pauses_v2()),
  'B sees only the pause of their own order'
);
-- No direct writes to the table for a customer.
select t.expect_error(
  format('insert into public.order_pauses (order_id, from_date, to_date, source) values (%L, %L, %L, %L)',
    :'b1_id', :'first', :'first', 'customer'),
  'permission denied'
);

-- ---------- 5. A pauses their order ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
-- Before the first allowed day (today, or tomorrow after the cutoff): too soon.
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'first'::date - 1, :'first'::date - 1), 'pause_too_soon');
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'today', :'today'), 'pause_too_soon');
-- Longer than 93 calendar days, or backwards.
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'first', :'first'::date + 93), 'bad_range');
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'first'::date + 1, :'first'), 'bad_range');
-- Not confirmed yet.
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a2, :'first', :'first'), 'not_pausable');
-- After the order's end: no delivery days in the range. On the staff pause: already paused.
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'today'::date + 40, :'today'::date + 42), 'no_delivery_days');
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'today'::date + 10, :'today'::date + 10), 'no_delivery_days');

-- One day on the first allowed day: the end moves one day later (20 days, the staff pause, and this one).
select public.pause_my_order(:a1, :'first', :'first') as added \gset
select t.check((:'added'::jsonb ->> 'end_date')::date = :'today'::date + 19, 'end after two paused days');
select t.check((:'added'::jsonb ->> 'skipped')::int = 2, 'two skipped days');
select t.check((:'added'::jsonb ->> 'number')::bigint = :a1, 'number in the answer');
select (:'added'::jsonb ->> 'id') as a_pause \gset
reset role;
select t.check(
  (select source = 'customer' and created_by = '00000000-0000-0000-0000-0000000000a1' and cancelled_at is null
   from public.order_pauses where id = :'a_pause'),
  'source customer, created by A'
);
-- The history row and the owner-group message name the customer's pause.
select t.check(
  (select e.detail #>> '{pause,source}' = 'customer' and e.detail #>> '{pause,action}' = 'added'
   from public.order_events e where e.order_id = :'a1_id' and e.kind = 'edited' order by e.id desc limit 1),
  'history row of the pause'
);
select t.check(
  (select o.payload #>> '{pause,source}' = 'customer'
     and o.payload #>> '{pause,from}' = :'first'
     and o.payload #>> '{pause,action}' = 'added'
     and o.payload #>> '{pause,end}' = (:'today'::date + 19)::text
     and o.payload -> 'fields' = '["pause"]'::jsonb
   from public.telegram_outbox o where o.kind = 'order' order by o.id desc limit 1),
  'Telegram payload names the pause and its source'
);
-- Other order events carry no pause.
select t.check(
  (select count(*) = 0 from public.telegram_outbox o where o.kind = 'order' and o.payload ? 'pause'
     and o.payload -> 'pause' <> 'null'::jsonb and o.payload ->> 'event' <> 'edited'),
  'no pause key on other events'
);

-- ---------- 6. the cap of paused delivery days (pause_max_days) ----------
insert into public.settings (key, value) values ('pause_max_days', '3');
set role authenticated;
-- Two paused now; three more would make five.
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'first'::date + 2, :'first'::date + 4), 'pause_limit');
-- One more makes three: allowed.
select public.pause_my_order(:a1, :'first'::date + 2, :'first'::date + 2) as capped \gset
select t.check((:'capped'::jsonb ->> 'skipped')::int = 3, 'three skipped at the cap');
reset role;
delete from public.settings where key = 'pause_max_days';

-- ---------- 7. my_order_pauses_v2 ----------
set role authenticated;
select t.check((select count(*) from public.my_order_pauses_v2()) = 3, 'A sees their three active pauses');
select t.check(
  (select count(*) from public.my_order_pauses_v2() where id = :'a_pause' and source = 'customer' and number = :a1) = 1,
  'with id, number and source'
);
select t.check((select count(*) from public.my_order_pauses_v2() where id = :'b_pause') = 0, 'not B''s pause');

-- ---------- 8. cancel ----------
-- A pause staff set: staff_pause.
select t.expect_error(format('select public.cancel_my_pause(%L)', :'staff_pause'), 'staff_pause');
-- A's own pause: removed, the end comes back one day.
select public.cancel_my_pause(:'a_pause') as cancelled \gset
select t.check((:'cancelled'::jsonb ->> 'number')::bigint = :a1, 'cancel answer number');
select t.check((:'cancelled'::jsonb ->> 'end_date')::date = :'today'::date + 19, 'end after cancel (staff + one customer day)');
select t.expect_error(format('select public.cancel_my_pause(%L)', :'a_pause'), 'already_cancelled');
select t.check((select count(*) from public.my_order_pauses_v2() where id = :'a_pause') = 0, 'cancelled pause not listed');
select t.expect_error(format('select public.cancel_my_pause(%L)', gen_random_uuid()), 'not_found');
reset role;
select t.check(
  (select cancelled_by = '00000000-0000-0000-0000-0000000000a1' from public.order_pauses where id = :'a_pause'),
  'cancelled by A'
);
-- A customer pause that starts before the first allowed day (made directly, as if added yesterday): locked.
insert into public.order_pauses (order_id, from_date, to_date, source, created_by)
values (:'a1_id', :'first'::date - 1, :'first'::date - 1, 'customer', '00000000-0000-0000-0000-0000000000a1')
returning id as locked_pause \gset
set role authenticated;
select t.expect_error(format('select public.cancel_my_pause(%L)', :'locked_pause'), 'pause_locked');
reset role;
-- A cancelled order: its pauses stay as they are.
update public.orders set status = 'cancelled', cancel_reason = 'test cancel' where id = :'b1_id';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
set role authenticated;
select t.expect_error(format('select public.cancel_my_pause(%L)', :'b_pause'), 'not_pausable');
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :b1, :'first'::date + 3, :'first'::date + 3), 'not_pausable');
reset role;

-- ---------- 9. at most 10 customer pauses per order in 24 hours ----------
insert into public.order_pauses (order_id, from_date, to_date, source, created_by, cancelled_at)
select :'a1_id', :'first'::date + 5, :'first'::date + 5, 'customer', '00000000-0000-0000-0000-0000000000a1', now()
from generate_series(1, 7);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select t.expect_error(format('select public.pause_my_order(%s, %L, %L)', :a1, :'first'::date + 6, :'first'::date + 6), 'too_many_changes');
reset role;

rollback;
\o
\echo customer pause checks passed
