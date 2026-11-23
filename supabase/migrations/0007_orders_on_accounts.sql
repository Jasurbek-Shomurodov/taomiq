-- Orders on customer accounts: an order placed while signed in is saved against the account, and the
-- customer sees their own orders on /account. Plan: docs/plans/customer-login-and-protection.md, slice 2.
--
-- NOT PURELY ADDITIVE. Needs the owner's approval before production:
--   * public.submit_order(uuid, int, boolean, date, text, text, text, text, text, text, text, jsonb, text)
--     (the 13-parameter version from 0004/0005) is DROPPED and re-created with a 14th parameter
--     p_user_id uuid default null. A new parameter makes a new overload, so the old one has to go, or
--     PostgREST could pick either. Body otherwise unchanged from 0005; execute is re-stated below
--     (service_role only, as before). Deploy order: apply this migration BEFORE the code that passes
--     p_user_id. The old code keeps working after it too: it calls with 13 named arguments and the 14th
--     has a default.
--
-- Everything else is additive, and NO existing grant or policy on public.orders is changed:
--   * new nullable column orders.user_id (FK to auth.users, on delete set null) + index;
--   * new function public.my_orders(), executable by authenticated only.
--
-- How customers read their orders, and why not a policy on the table:
--   orders has a table-level SELECT grant to authenticated (0004), which the owner's back office uses
--   (list, counts, detail including staff_note and source). Customers are the same Postgres role
--   (authenticated), so column grants cannot give the owner staff_note while hiding it from customers,
--   and a "customer reads own orders" row policy on the table would let a customer select staff_note,
--   source and ip_hash of their own rows straight from /rest/v1/orders. A security invoker view has the
--   same hole (it needs that same table policy underneath). So the table keeps exactly its current
--   grants and policies (owner only), and customers read through public.my_orders(): a security
--   definer function that returns only the caller's own rows (user_id = auth.uid()) and only a fixed
--   list of harmless columns. It never returns staff_note, ip_hash, source, address, phone or comment.
--   The Supabase advisor flags security definer functions callable by authenticated (a warning); that
--   is intended here, for the reasons above. anon cannot call it, and auth.uid() is null without a
--   session, so it returns nothing then.

-- ---------- orders.user_id ----------
alter table public.orders
  add column user_id uuid references auth.users (id) on delete set null;

create index orders_user_created on public.orders (user_id, created_at desc) where user_id is not null;

-- ---------- my_orders ----------
create or replace function public.my_orders()
returns table (
  number bigint,
  status text,
  program_name text,
  kcal int,
  days int,
  weekdays_only boolean,
  start_date date,
  total int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.number, o.status, o.program_name, o.kcal, o.days, o.weekdays_only, o.start_date, o.total, o.created_at
  from public.orders o
  where o.user_id = (select auth.uid())
  order by o.created_at desc
  limit 100;
$$;

revoke execute on function public.my_orders() from public, anon, authenticated;
grant execute on function public.my_orders() to authenticated;

-- ---------- submit_order ----------
-- DESTRUCTIVE (function signature): the 13-parameter version is dropped and replaced by the one below.
drop function public.submit_order(uuid, int, boolean, date, text, text, text, text, text, text, text, jsonb, text);

-- Same as 0005_uzbek_cyrillic.sql, plus p_user_id: the signed-in customer, read by the server action from
-- the session (never from the form). An id that is not (or no longer) an auth user is dropped rather than
-- failing the order: an order must never be lost because of the account.
create function public.submit_order(
  p_variant_id uuid,
  p_days int,
  p_weekdays_only boolean,
  p_start_date date,
  p_name text,
  p_phone text,
  p_address text,
  p_window text,
  p_comment text,
  p_exclusions text,
  p_locale text,
  p_source jsonb,
  p_ip_hash text,
  p_user_id uuid default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Tashkent';
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_program_name text;
  v_kcal int;
  v_base_price int;
  v_markup numeric;
  v_cutoff int;
  v_windows jsonb;
  v_earliest date;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_window text := btrim(coalesce(p_window, ''));
  v_comment text := btrim(coalesce(p_comment, ''));
  v_exclusions text := btrim(coalesce(p_exclusions, ''));
  v_weekdays_only boolean := coalesce(p_weekdays_only, false);
  v_ip_hash text := left(btrim(coalesce(p_ip_hash, '')), 128);
  v_source jsonb := '{}'::jsonb;
  v_key text;
  v_price int;
  v_user_id uuid;
  v_number bigint;
begin
  -- Plan
  select p.name, v.kcal, v.price_per_day
    into v_program_name, v_kcal, v_base_price
  from public.program_variants v
  join public.programs p on p.id = v.program_id
  where v.id = p_variant_id and v.active and p.active;
  if not found then
    raise exception 'invalid_variant';
  end if;

  select d.markup_pct into v_markup from public.durations d where d.days = p_days;
  if not found then
    raise exception 'invalid_days';
  end if;

  -- Start date, Tashkent time: tomorrow before the cutoff hour, otherwise the day after; at most 60 days ahead.
  select (s.value #>> '{}')::int into v_cutoff from public.settings s where s.key = 'order_cutoff_hour';
  v_cutoff := coalesce(v_cutoff, 14);
  v_earliest := v_today + case when extract(hour from v_now) < v_cutoff then 1 else 2 end;
  if p_start_date is null
     or p_start_date < v_earliest
     or p_start_date > v_today + 60
     or (v_weekdays_only and extract(isodow from p_start_date) in (6, 7)) then
    raise exception 'invalid_date';
  end if;

  -- Contact and delivery
  if v_phone !~ '^\+998[0-9]{9}$' then
    raise exception 'invalid_phone';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'invalid_name';
  end if;
  if char_length(v_address) not between 5 and 300 then
    raise exception 'invalid_address';
  end if;

  select s.value into v_windows from public.settings s where s.key = 'delivery_windows';
  if v_windows is null or jsonb_typeof(v_windows) <> 'array' or not (v_windows ? v_window) then
    raise exception 'invalid_window';
  end if;

  if char_length(v_comment) > 500 or char_length(v_exclusions) > 500 then
    raise exception 'too_long';
  end if;

  if p_locale is null or p_locale not in ('uz', 'uzc', 'ru') then
    raise exception 'invalid_locale';
  end if;

  -- Attribution: whitelisted keys, string values, at most 100 characters each.
  if p_source is not null and jsonb_typeof(p_source) = 'object' then
    foreach v_key in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'] loop
      if jsonb_typeof(p_source -> v_key) = 'string' then
        v_source := v_source || jsonb_build_object(v_key, left(p_source ->> v_key, 100));
      end if;
    end loop;
  end if;

  -- Account: kept only when it is a real auth user (the foreign key would otherwise fail the order).
  if p_user_id is not null then
    select u.id into v_user_id from auth.users u where u.id = p_user_id;
  end if;

  -- Abuse limits: 3 new orders per phone in 24 hours, 10 orders per connection in an hour.
  -- The locks make concurrent submissions from one phone or one connection count correctly.
  perform pg_advisory_xact_lock(hashtext('submit_order:phone:' || v_phone));
  if (
    select count(*) from public.orders o
    where o.phone = v_phone and o.status = 'new' and o.created_at > now() - interval '24 hours'
  ) >= 3 then
    raise exception 'rate_limited';
  end if;
  if v_ip_hash <> '' then
    perform pg_advisory_xact_lock(hashtext('submit_order:ip:' || v_ip_hash));
    if (
      select count(*) from public.orders o
      where o.ip_hash = v_ip_hash and o.created_at > now() - interval '1 hour'
    ) >= 10 then
      raise exception 'rate_limited';
    end if;
  end if;

  -- Same rule as pricePerDay() in src/lib/data/types.ts:
  -- base * (100 + markup) / 100, rounded half up to the nearest 1,000 UZS (exact numeric arithmetic).
  v_price := (round(v_base_price * (100 + v_markup) / 100000.0) * 1000)::int;

  insert into public.orders (
    variant_id, program_name, kcal, days, weekdays_only, start_date, price_per_day, total,
    customer_name, phone, address, delivery_window, comment, exclusions, locale, source, ip_hash, user_id
  ) values (
    p_variant_id, v_program_name, v_kcal, p_days, v_weekdays_only, p_start_date, v_price, v_price * p_days,
    v_name, v_phone, v_address, v_window, v_comment, v_exclusions, p_locale, v_source, v_ip_hash, v_user_id
  )
  returning number into v_number;

  return v_number;
end;
$$;

revoke execute on function public.submit_order(uuid, int, boolean, date, text, text, text, text, text, text, text, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_order(uuid, int, boolean, date, text, text, text, text, text, text, text, jsonb, text, uuid)
  to service_role;
