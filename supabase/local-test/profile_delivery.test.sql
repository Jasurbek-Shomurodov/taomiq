-- Checks of the saved delivery details and the repeat read (0030_profile_delivery.sql) on the throwaway local Postgres of
-- scripts/test-migrations.sh, which runs every supabase/local-test/*.test.sql after the migrations. One transaction,
-- rolled back at the end: nothing stays. A failed check raises and stops the script (ON_ERROR_STOP).
-- Users and orders are made up. The checks print nothing; only the last line says they passed.
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

-- ---------- data ----------
-- A and B have profiles (the sign-up trigger of 0006 makes them); C's row is removed to stand for a failed trigger.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'c@example.test');
delete from public.profiles where id = '00000000-0000-0000-0000-0000000000c3';
update public.profiles set address = 'B street 22, flat 4' where id = '00000000-0000-0000-0000-0000000000b2';

insert into public.programs (id, slug, name) values ('00000000-0000-0000-0000-00000000c001', 't-balance', 'BALANCE');
insert into public.program_variants (id, program_id, kcal, price_per_day)
values ('00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c001', 1800, 255000);

insert into public.orders (status, variant_id, program_name, kcal, days, weekdays_only, start_date, price_per_day, total,
  customer_name, phone, address, delivery_window, comment, exclusions, user_id)
values ('completed', '00000000-0000-0000-0000-00000000c002', 'BALANCE', 1800, 14, true, '2026-11-02', 255000, 3570000,
  'Test A', '+998900000001', 'A street 1, flat 2', '07:00–09:00', 'Ring twice', 'mushrooms',
  '00000000-0000-0000-0000-0000000000a1')
returning number as a1 \gset
insert into public.orders (status, variant_id, program_name, kcal, days, start_date, price_per_day, total,
  customer_name, phone, address, delivery_window, user_id)
values ('new', '00000000-0000-0000-0000-00000000c002', 'BALANCE', 1800, 7, '2026-11-10', 255000, 1785000,
  'Test B', '+998900000002', 'B street 22, flat 4', '06:00–08:00', '00000000-0000-0000-0000-0000000000b2')
returning number as b1 \gset

-- ---------- 1. anon is refused outright ----------
set role anon;
select t.expect_error($$select public.save_my_delivery('Anon street 1', null, null)$$, 'permission denied');
select t.expect_error(format('select * from public.my_order_for_repeat(%s)', :a1), 'permission denied');
select t.expect_error('select address from public.profiles', 'permission denied');
reset role;

-- ---------- 2. signed in, but no user id: not_allowed, and no order ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
select t.expect_error($$select public.save_my_delivery('Nobody street 1', null, null)$$, 'not_allowed');
select t.check((select count(*) from public.my_order_for_repeat(:a1)) = 0, 'no user: no order');

-- ---------- 3. A saves, reads back through RLS, and cannot write the columns directly ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.save_my_delivery('  A street 1, flat 2  ', '07:00–09:00', ' Ring twice ');
select t.check(
  (select address = 'A street 1, flat 2' and delivery_window = '07:00–09:00' and courier_note = 'Ring twice'
   from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'A reads their saved details, trimmed'
);
select t.check(
  (select count(*) from public.profiles) = 1,
  'A sees only their own profile row'
);
select t.check(
  (select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000b2') = 0,
  'A cannot read B''s saved address'
);
select t.expect_error(
  $$update public.profiles set address = 'Direct street 1' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'permission denied'
);
-- Each save replaces all three fields: a null window and note clear them, the address alone is kept.
select public.save_my_delivery('A street 1, flat 2', null, null);
select t.check(
  (select address = 'A street 1, flat 2' and delivery_window is null and courier_note is null
   from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'null window and note are cleared'
);

-- ---------- 4. validation ----------
select t.expect_error($$select public.save_my_delivery('abcd', null, null)$$, 'invalid_address');
select t.expect_error(format('select public.save_my_delivery(%L, null, null)', repeat('x', 301)), 'invalid_address');
select t.expect_error($$select public.save_my_delivery('A street 1, flat 2', '23:00–23:30', null)$$, 'invalid_window');
select t.expect_error(format('select public.save_my_delivery(%L, %L, %L)', 'A street 1', '07:00–09:00', repeat('n', 501)), 'too_long');
-- A failed save changes nothing.
select t.check(
  (select address = 'A street 1, flat 2' from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'a refused save keeps the old details'
);
-- Exactly at the limits.
select public.save_my_delivery(repeat('a', 300), '06:00–08:00', repeat('n', 500));
select public.save_my_delivery('abcde', null, null);

-- ---------- 5. clear: all nulls (or blank text) empties the three fields, nothing else ----------
select public.save_my_delivery(null, null, null);
select t.check(
  (select address is null and delivery_window is null and courier_note is null
   from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'all nulls clear the details'
);
select public.save_my_delivery('A street 1, flat 2', '08:00–10:00', 'Gate code 12');
select public.save_my_delivery('  ', '', ' ');
select t.check(
  (select address is null and delivery_window is null and courier_note is null
   from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  'blank text clears the details too'
);
reset role;
select t.check(
  (select address = 'B street 22, flat 4' from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  'A''s saves never touched B''s row'
);

-- ---------- 6. a missing profile row is created for its owner ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', false);
set role authenticated;
select public.save_my_delivery('C street 3', '06:00–08:00', null);
select t.check(
  (select name = '' and address = 'C street 3' and delivery_window = '06:00–08:00'
   from public.profiles where id = '00000000-0000-0000-0000-0000000000c3'),
  'C''s missing row is made with the details'
);
reset role;

-- ---------- 7. my_order_for_repeat: own order only ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select t.check(
  (select variant_id = '00000000-0000-0000-0000-00000000c002' and program_slug = 't-balance' and kcal = 1800
     and days = 14 and weekdays_only and address = 'A street 1, flat 2' and delivery_window = '07:00–09:00'
     and comment = 'Ring twice' and exclusions = 'mushrooms'
   from public.my_order_for_repeat(:a1)),
  'A reads their own order for repeat'
);
select t.check((select count(*) from public.my_order_for_repeat(:b1)) = 0, 'A cannot read B''s order');
select t.check((select count(*) from public.my_order_for_repeat(999999999)) = 0, 'no such order: no row');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select t.check((select count(*) from public.my_order_for_repeat(:a1)) = 0, 'B cannot read A''s order');
select t.check((select count(*) from public.my_order_for_repeat(:b1)) = 1, 'B reads their own order');
reset role;

-- ---------- 8. an order whose level is no longer offered still comes back, with its program ----------
update public.program_variants set active = false where id = '00000000-0000-0000-0000-00000000c002';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select t.check(
  (select program_slug = 't-balance' and kcal = 1800 from public.my_order_for_repeat(:a1)),
  'inactive level: the program and kcal still come back'
);
reset role;

rollback;
\o
\echo profile delivery checks passed
