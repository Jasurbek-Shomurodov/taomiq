-- Order operations in the back office: staff add an order by hand, edit an open order's contact and delivery
-- fields (and its schedule before the first delivery), choose how it was paid when marking it paid, give a reason
-- when cancelling, change the payment method afterwards, and every change is kept in an order history.
-- Plan: docs/plans/zarkebab-feature-port.md, slice 2.
--
-- Additive. No table, column, row, policy or grant is dropped, and no existing row is changed:
--   1. public.orders gets three nullable / defaulted columns: payment_method (cash, card or transfer; null until the
--      order is paid, and on orders paid before this migration), cancel_reason ('' unless cancelled; at most 500
--      characters) and created_by (the staff account that added the order by hand; null = placed on the site), with
--      an index on created_by.
--   2. The update grant on orders widens from (status, staff_note) to also cover payment_method and cancel_reason.
--      The orders policies (owner and manager, 0012) are unchanged, so exactly the same people can use them.
--   3. New before-update trigger orders_check_status_fields (private.check_order_status_fields), beside the status
--      trigger of 0004. Triggers of one event fire in name order, so it runs right after orders_check_status (which
--      still rejects a wrong step first) and before orders_set_updated_at and orders_stamp_paid_at:
--        * moving to paid needs a payment_method (payment_method_required);
--        * a payment_method can only be set or changed on a paid, active or completed order, and never cleared
--          (payment_method_not_paid / payment_method_required). Orders are not locked by a closed finance month
--          (0015: no closed-month rule applies to orders), and the method is not part of any frozen month figure, so
--          a change is allowed at any time and recorded in the history;
--        * moving to cancelled needs a reason of at least 3 non-whitespace characters (cancel_reason_required), and the reason can
--          only be written in that same update (cancel_reason_locked).
--      All raise check_violation (23514). canMove() and the rules in src/lib/admin/orders.ts are kept in step.
--   4. New table public.order_events: the history of each order (created, status change, edit of contact or
--      delivery fields, payment method change, note change). RLS on; owners and managers read it
--      (private.can_handle_orders(), the same rule as the orders policies, 0012); no client may insert, update or
--      delete: rows are written only by the trigger in 5. An edit event holds the old and new values of the fields
--      that changed (personal data, readable by the same people who read the order); a note event holds no text.
--   5. New after-insert-or-update trigger orders_log_event (private.log_order_event, security definer so it can
--      write the history table that clients cannot). The actor is auth.uid() with their staff name as a snapshot,
--      so the history survives a removed team member; null for orders placed on the site (service_role).
--   6. New private.order_plan_price(variant, days): the plan lookup and the price rule of submit_order, moved into one
--      function so the site and the back office price an order the same way. Not callable by clients.
--   7. public.submit_order (0007) is replaced with CREATE OR REPLACE and the identical signature, return type,
--      grants and behaviour: its body is the 0007 body with the plan lookup and the price formula replaced by one
--      call to private.order_plan_price (same checks in the same order, same error codes, same arithmetic).
--   8. New public.staff_create_order(...): an order added by an owner or manager (raises not_allowed, 42501, for
--      anyone else). Same plan and price rule as the site; the window must be one of delivery_windows; the start
--      date may be today (Tashkent) up to 60 days ahead (the site's cutoff hour does not apply: staff know what the
--      kitchen can do); no rate limits; status confirmed, created_by = the caller, source {"ref": "staff"}.
--   9. New public.staff_edit_order(...): owner or manager. Name, phone, address, window, comment and exclusions of an
--      open order (new, confirmed, paid, active); start date and weekdays-only while nothing was delivered: new and
--      confirmed orders always (also when their start date has passed), paid orders only while their start date is
--      after today, active ones never; the new date is never in the past. Program, days and price are not editable.
--      A changed phone takes the order off the customer account it was on (user_id = null; the rightful owner gets it
--      back at their next sign-in, when orders are linked by their verified phone), recorded as account_unlinked in
--      the edit's history row. Stale-write guard: the caller passes the updated_at it loaded and gets `stale` if it
--      moved.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended
-- here, as in 0008, 0013 and 0015: the role check is the first statement of each public function.

-- ---------- 1. new columns ----------
alter table public.orders
  add column payment_method text check (payment_method in ('cash', 'card', 'transfer')),
  add column cancel_reason text not null default '' check (char_length(cancel_reason) <= 500),
  add column created_by uuid references auth.users (id) on delete set null;

create index orders_created_by on public.orders (created_by) where created_by is not null;

-- ---------- 2. update grant ----------
-- Adds to the grant of 0004 (status, staff_note). Contact and delivery fields stay read-only for clients: they are
-- edited only through staff_edit_order below, which checks them.
grant update (payment_method, cancel_reason) on table public.orders to authenticated;

-- ---------- 3. payment method and cancel reason rules ----------
create or replace function private.check_order_status_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.payment_method is null then
    raise exception 'payment_method_required' using errcode = '23514';
  end if;

  if new.payment_method is distinct from old.payment_method then
    if new.payment_method is null then
      raise exception 'payment_method_required' using errcode = '23514';
    end if;
    if new.status not in ('paid', 'active', 'completed') then
      raise exception 'payment_method_not_paid' using errcode = '23514';
    end if;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and char_length(regexp_replace(new.cancel_reason, '\s', '', 'g')) < 3 then
    raise exception 'cancel_reason_required' using errcode = '23514';
  end if;

  if new.cancel_reason is distinct from old.cancel_reason
     and not (new.status = 'cancelled' and old.status is distinct from 'cancelled') then
    raise exception 'cancel_reason_locked' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.check_order_status_fields() from public;

create trigger orders_check_status_fields
  before update on public.orders
  for each row execute function private.check_order_status_fields();

-- ---------- 4. order_events ----------
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  actor_name text not null default '',
  kind text not null check (kind in ('created', 'status', 'edited', 'payment_method', 'note')),
  from_status text,
  to_status text,
  detail jsonb not null default '{}'
);

create index order_events_order_at on public.order_events (order_id, at desc, id desc);
create index order_events_actor on public.order_events (actor) where actor is not null;

alter table public.order_events enable row level security;

revoke all on table public.order_events from anon, authenticated;
grant select on table public.order_events to authenticated;

create policy "order handlers read order events" on public.order_events
  for select to authenticated using ((select private.can_handle_orders()));

-- ---------- 5. history trigger ----------
-- One row per kind of change in an update (a status move to paid carries its payment method, a move to cancelled its
-- reason; a separate payment_method row only when the method changes without the move to paid).
create or replace function private.log_order_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_changes jsonb := '{}'::jsonb;
  v_detail jsonb := '{}'::jsonb;
begin
  if v_uid is not null then
    select btrim(s.name) into v_name from public.staff s where s.user_id = v_uid;
  end if;
  v_name := coalesce(v_name, '');

  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, actor, actor_name, kind, to_status, detail)
    values (
      new.id, v_uid, v_name, 'created', new.status,
      jsonb_build_object('by', case when new.created_by is null then 'site' else 'staff' end)
    );
    return null;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'paid' then
      v_detail := jsonb_build_object('payment_method', new.payment_method);
    elsif new.status = 'cancelled' then
      v_detail := jsonb_build_object('reason', new.cancel_reason);
    end if;
    insert into public.order_events (order_id, actor, actor_name, kind, from_status, to_status, detail)
    values (new.id, v_uid, v_name, 'status', old.status, new.status, v_detail);
  end if;

  if new.payment_method is distinct from old.payment_method
     and not (new.status = 'paid' and old.status is distinct from 'paid') then
    insert into public.order_events (order_id, actor, actor_name, kind, detail)
    values (
      new.id, v_uid, v_name, 'payment_method',
      jsonb_build_object('from', old.payment_method, 'to', new.payment_method)
    );
  end if;

  if new.customer_name is distinct from old.customer_name then
    v_changes := v_changes || jsonb_build_object('customer_name', jsonb_build_object('from', old.customer_name, 'to', new.customer_name));
  end if;
  if new.phone is distinct from old.phone then
    v_changes := v_changes || jsonb_build_object('phone', jsonb_build_object('from', old.phone, 'to', new.phone));
    -- staff_edit_order takes the order off the account when the phone changes.
    if old.user_id is not null and new.user_id is null then
      v_changes := v_changes || jsonb_build_object('account_unlinked', true);
    end if;
  end if;
  if new.address is distinct from old.address then
    v_changes := v_changes || jsonb_build_object('address', jsonb_build_object('from', old.address, 'to', new.address));
  end if;
  if new.delivery_window is distinct from old.delivery_window then
    v_changes := v_changes || jsonb_build_object('delivery_window', jsonb_build_object('from', old.delivery_window, 'to', new.delivery_window));
  end if;
  if new.comment is distinct from old.comment then
    v_changes := v_changes || jsonb_build_object('comment', jsonb_build_object('from', old.comment, 'to', new.comment));
  end if;
  if new.exclusions is distinct from old.exclusions then
    v_changes := v_changes || jsonb_build_object('exclusions', jsonb_build_object('from', old.exclusions, 'to', new.exclusions));
  end if;
  if new.start_date is distinct from old.start_date then
    v_changes := v_changes || jsonb_build_object('start_date', jsonb_build_object('from', old.start_date, 'to', new.start_date));
  end if;
  if new.weekdays_only is distinct from old.weekdays_only then
    v_changes := v_changes || jsonb_build_object('weekdays_only', jsonb_build_object('from', old.weekdays_only, 'to', new.weekdays_only));
  end if;
  if v_changes <> '{}'::jsonb then
    insert into public.order_events (order_id, actor, actor_name, kind, detail)
    values (new.id, v_uid, v_name, 'edited', v_changes);
  end if;

  if new.staff_note is distinct from old.staff_note then
    insert into public.order_events (order_id, actor, actor_name, kind)
    values (new.id, v_uid, v_name, 'note');
  end if;

  return null;
end;
$$;

revoke all on function private.log_order_event() from public;

create trigger orders_log_event
  after insert or update on public.orders
  for each row execute function private.log_order_event();

-- ---------- 6. shared plan and price rule ----------
-- The plan of an order and its price per day. Raises invalid_variant (no such level, or it or its program is
-- inactive) or invalid_days (no such duration). Same rule as pricePerDay() in src/lib/data/types.ts:
-- base * (100 + markup) / 100, rounded half up to the nearest 1,000 UZS (exact numeric arithmetic).
create or replace function private.order_plan_price(
  p_variant_id uuid,
  p_days int,
  out program_name text,
  out kcal int,
  out price_per_day int
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base_price int;
  v_markup numeric;
begin
  select p.name, v.kcal, v.price_per_day
    into program_name, kcal, v_base_price
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

  price_per_day := (round(v_base_price * (100 + v_markup) / 100000.0) * 1000)::int;
end;
$$;

revoke all on function private.order_plan_price(uuid, int) from public;

-- ---------- 7. submit_order ----------
-- Body of 0007_orders_on_accounts.sql; only the plan lookup and the price formula became the call to
-- private.order_plan_price. Signature, return type and grants are unchanged (restated so this file reads on its own).
create or replace function public.submit_order(
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
  -- Plan and price: private.order_plan_price (above), shared with staff_create_order.
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

-- ---------- 8. staff_create_order ----------
-- An order added in the back office by an owner or manager, for a customer who ordered by phone or Telegram. Returns
-- {"id": uuid, "number": bigint}. Errors: not_allowed (42501) and the codes of submit_order: invalid_variant,
-- invalid_days, invalid_date, invalid_phone, invalid_name, invalid_address, invalid_window, too_long, invalid_locale.
create or replace function public.staff_create_order(
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
  p_staff_note text,
  p_locale text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_program_name text;
  v_kcal int;
  v_price int;
  v_windows jsonb;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_window text := btrim(coalesce(p_window, ''));
  v_comment text := btrim(coalesce(p_comment, ''));
  v_exclusions text := btrim(coalesce(p_exclusions, ''));
  v_note text := btrim(coalesce(p_staff_note, ''));
  v_weekdays_only boolean := coalesce(p_weekdays_only, false);
  v_id uuid;
  v_number bigint;
begin
  if not private.can_handle_orders() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select r.program_name, r.kcal, r.price_per_day
    into v_program_name, v_kcal, v_price
  from private.order_plan_price(p_variant_id, p_days) r;

  -- Today (Tashkent) up to 60 days ahead; a weekdays-only order starts on a weekday.
  if p_start_date is null
     or p_start_date < v_today
     or p_start_date > v_today + 60
     or (v_weekdays_only and extract(isodow from p_start_date) in (6, 7)) then
    raise exception 'invalid_date';
  end if;

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

  if char_length(v_comment) > 500 or char_length(v_exclusions) > 500 or char_length(v_note) > 2000 then
    raise exception 'too_long';
  end if;

  if p_locale is null or p_locale not in ('uz', 'uzc', 'ru') then
    raise exception 'invalid_locale';
  end if;

  insert into public.orders (
    status, variant_id, program_name, kcal, days, weekdays_only, start_date, price_per_day, total,
    customer_name, phone, address, delivery_window, comment, exclusions, locale, source, staff_note, created_by
  ) values (
    'confirmed', p_variant_id, v_program_name, v_kcal, p_days, v_weekdays_only, p_start_date, v_price, v_price * p_days,
    v_name, v_phone, v_address, v_window, v_comment, v_exclusions, p_locale, '{"ref": "staff"}'::jsonb, v_note,
    auth.uid()
  )
  returning id, number into v_id, v_number;

  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

revoke all on function public.staff_create_order(uuid, int, boolean, date, text, text, text, text, text, text, text, text)
  from public, anon;
grant execute on function public.staff_create_order(uuid, int, boolean, date, text, text, text, text, text, text, text, text)
  to authenticated;

-- ---------- 9. staff_edit_order ----------
-- Edits an open order. p_loaded_at is the updated_at the form was loaded with. Errors: not_allowed (42501),
-- not_found (P0002), not_editable (55000: completed or cancelled), stale (55000: changed since it was loaded),
-- schedule_locked (55000: start date or schedule changed on a paid order whose start date is today or past, or on an
-- active one), and invalid_date, invalid_phone,
-- invalid_name, invalid_address, invalid_window, too_long as in staff_create_order. Nothing changed: no update.
create or replace function public.staff_edit_order(
  p_id uuid,
  p_loaded_at timestamptz,
  p_name text,
  p_phone text,
  p_address text,
  p_window text,
  p_comment text,
  p_exclusions text,
  p_start_date date,
  p_weekdays_only boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_row public.orders;
  v_windows jsonb;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_window text := btrim(coalesce(p_window, ''));
  v_comment text := btrim(coalesce(p_comment, ''));
  v_exclusions text := btrim(coalesce(p_exclusions, ''));
  v_weekdays_only boolean := coalesce(p_weekdays_only, false);
begin
  if not private.can_handle_orders() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_row from public.orders o where o.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.status not in ('new', 'confirmed', 'paid', 'active') then
    raise exception 'not_editable' using errcode = '55000';
  end if;
  if p_loaded_at is null or v_row.updated_at is distinct from p_loaded_at then
    raise exception 'stale' using errcode = '55000';
  end if;

  -- Schedule: only while nothing was delivered. New and confirmed orders are never delivered (also when their start
  -- date has passed); a paid one only before its first delivery day; never into the past. Same as canEditSchedule().
  if p_start_date is distinct from v_row.start_date or v_weekdays_only is distinct from v_row.weekdays_only then
    if not (v_row.status in ('new', 'confirmed') or (v_row.status = 'paid' and v_row.start_date > v_today)) then
      raise exception 'schedule_locked' using errcode = '55000';
    end if;
    if p_start_date is null
       or p_start_date < v_today
       or p_start_date > v_today + 60
       or (v_weekdays_only and extract(isodow from p_start_date) in (6, 7)) then
      raise exception 'invalid_date';
    end if;
  end if;

  if v_phone !~ '^\+998[0-9]{9}$' then
    raise exception 'invalid_phone';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'invalid_name';
  end if;
  if char_length(v_address) not between 5 and 300 then
    raise exception 'invalid_address';
  end if;

  -- The window the order already has stays allowed after it was removed from the settings.
  if v_window is distinct from v_row.delivery_window then
    select s.value into v_windows from public.settings s where s.key = 'delivery_windows';
    if v_windows is null or jsonb_typeof(v_windows) <> 'array' or not (v_windows ? v_window) then
      raise exception 'invalid_window';
    end if;
  end if;

  if char_length(v_comment) > 500 or char_length(v_exclusions) > 500 then
    raise exception 'too_long';
  end if;

  if v_name = v_row.customer_name
     and v_phone = v_row.phone
     and v_address = v_row.address
     and v_window = v_row.delivery_window
     and v_comment = v_row.comment
     and v_exclusions = v_row.exclusions
     and p_start_date is not distinct from v_row.start_date
     and v_weekdays_only = v_row.weekdays_only then
    return;
  end if;

  update public.orders o
  set customer_name = v_name,
      phone = v_phone,
      address = v_address,
      delivery_window = v_window,
      comment = v_comment,
      exclusions = v_exclusions,
      start_date = p_start_date,
      weekdays_only = v_weekdays_only,
      user_id = case when v_phone <> v_row.phone then null else o.user_id end
  where o.id = p_id;
end;
$$;

revoke all on function public.staff_edit_order(uuid, timestamptz, text, text, text, text, text, text, date, boolean)
  from public, anon;
grant execute on function public.staff_edit_order(uuid, timestamptz, text, text, text, text, text, text, date, boolean)
  to authenticated;
