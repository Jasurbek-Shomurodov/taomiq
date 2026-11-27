-- One order per tap: the order form sends a request id with each submission, and a retry of the same submission
-- (a double tap, or a tap again after a slow network lost the answer) gets the number of the order already saved
-- instead of a second order. Plus the missing index on menu_items.dish_id from the advisor.
-- Plan: docs/plans/customer-site-round-2.md, item 3.
--
-- DESTRUCTIVE (function signature and return type only, no data): `drop function public.submit_order(<14 parameters>)`
-- in section 3. Postgres cannot add a parameter or change the return type with CREATE OR REPLACE, and keeping both
-- versions would make every call ambiguous, so the 14-parameter version (0018) is dropped and recreated in this one
-- transaction, as 0007 did for p_user_id, with:
--   * a 15th parameter, p_request_id uuid default null;
--   * a new return type: one row (order_number bigint, created boolean) instead of a bare bigint. created is false when
--     the call was a retry and returned an order saved earlier, so the server sends no second staff alert or
--     analytics event for it.
-- DEPLOY ORDER: push the code FIRST, then apply this migration. The new server code (src/lib/order/actions.ts) reads
-- both the old bare number and the new row, and when this function does not exist yet (PostgREST PGRST202) it calls
-- the old 14-parameter version without p_request_id. The code now in production reads a bare number only, so
-- applying this migration before the deploy would fail every order until the deploy is live.
--
-- Everything else is additive. No table, row, policy or other grant changes:
--   1. public.orders gets request_id uuid null (null on every existing order and on orders added by staff), with a
--      unique partial index where it is not null.
--   2. New index menu_items_dish_id on public.menu_items (dish_id) (the foreign key had none).
--   3. public.submit_order: the 0018 body, security definer, search_path and grants, plus p_request_id uuid default
--      null, returning (order_number, created). When p_request_id is set, the function takes an advisory lock on it
--      (so two concurrent calls with the same id run one after the other) and returns the number of the order with that request id if
--      one exists, before any other check: before the start-date check (a retry a second after the cutoff must still
--      find its order), the validation and the rate-limit counters (a retry is never counted as a new order). The id
--      is a random UUID made in the customer's browser, so it cannot be guessed to read another order's number.
--      Otherwise the order is inserted as before, with the request id stored on it, and created is true.
--      Grants restated exactly as 0018: execute revoked from public, anon and authenticated; granted to service_role.

-- ---------- 1. orders.request_id ----------
alter table public.orders add column if not exists request_id uuid;

create unique index if not exists orders_request_id on public.orders (request_id) where request_id is not null;

-- ---------- 2. menu_items.dish_id index ----------
create index if not exists menu_items_dish_id on public.menu_items (dish_id);

-- ---------- 3. submit_order ----------
-- DESTRUCTIVE (function signature): the 14-parameter version of 0018 is dropped and replaced by the one below.
drop function public.submit_order(uuid, int, boolean, date, text, text, text, text, text, text, text, jsonb, text, uuid);

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
  p_user_id uuid default null,
  p_request_id uuid default null
)
returns table (order_number bigint, created boolean)
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
  -- A retry of a submission already saved: the same order number, nothing new is checked, counted or inserted.
  -- The lock makes a second concurrent call with the same id wait for the first one's commit, then find its row.
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtext('submit_order:request:' || p_request_id::text));
    select o.number into v_number from public.orders o where o.request_id = p_request_id;
    if found then
      order_number := v_number;
      created := false;
      return next;
      return;
    end if;
  end if;

  -- Plan and price: private.order_plan_price (0018), shared with staff_create_order.
  select r.program_name, r.kcal, r.price_per_day
    into v_program_name, v_kcal, v_price
  from private.order_plan_price(p_variant_id, p_days) r;

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

  insert into public.orders (
    variant_id, program_name, kcal, days, weekdays_only, start_date, price_per_day, total,
    customer_name, phone, address, delivery_window, comment, exclusions, locale, source, ip_hash, user_id, request_id
  ) values (
    p_variant_id, v_program_name, v_kcal, p_days, v_weekdays_only, p_start_date, v_price, v_price * p_days,
    v_name, v_phone, v_address, v_window, v_comment, v_exclusions, p_locale, v_source, v_ip_hash, v_user_id, p_request_id
  )
  returning number into v_number;

  order_number := v_number;
  created := true;
  return next;
end;
$$;

revoke execute on function public.submit_order(uuid, int, boolean, date, text, text, text, text, text, text, text, jsonb, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_order(uuid, int, boolean, date, text, text, text, text, text, text, text, jsonb, text, uuid, uuid)
  to service_role;
