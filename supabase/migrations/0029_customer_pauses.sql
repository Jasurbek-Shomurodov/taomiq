-- Customer self-service pauses: a signed-in customer pauses delivery days of their own order in the account, and removes
-- a pause they added while it is still ahead of the cutoff. Plan: docs/plans/pause-and-skip-days.md, slice 3.
--
-- ADDITIVE ONLY. No table, column, row, constraint, policy or grant is dropped or changed; no DROP, TRUNCATE, DELETE or
-- UPDATE of existing rows. New functions only, plus one CREATE OR REPLACE of a trigger function with its identical
-- signature, return type, security, search_path and grants (private.telegram_from_order, 0026, section 5).
-- public.staff_pause_order, staff_cancel_pause and my_order_pauses (0028) are not touched. Does not depend on 0027.
--
--   1. private.customer_pause_first_day(at)  the first day a customer's pause may start, and the first day of a pause
--      they may still remove: the earliest start date a new order placed at `at` could have (submit_order's rule,
--      0004 to 0018): tomorrow (Tashkent) before the order_cutoff_hour setting (default 14), the day after from then.
--      The time is a parameter so the rule can be tested at fixed times.
--   2. private.add_order_pause(order, from, to, first_day, source, actor)  the checks and the insert of
--      staff_pause_order (0028) with the first allowed day as a parameter, for pause_my_order. The caller locks and
--      checks nothing itself; this does it all (range, first day, lock, status, a delivery day in the range, the cap).
--      Returns {id, end_date, skipped, max}. Errors as staff_pause_order: bad_range, pause_too_soon, not_found,
--      not_pausable, no_delivery_days, pause_limit.
--   3. public.pause_my_order(number, from, to)  (authenticated) adds a pause to the caller's own order
--      (orders.user_id = auth.uid(); anyone else's order, or no order, is not_found) that is confirmed, paid or active.
--      from is on or after customer_pause_first_day(now()); at most 93 calendar days; at least one delivery day in the
--      range; the order's paused delivery days stay within pause_max_days (staff and customer pauses together).
--      source 'customer', created_by the caller. At most 10 customer pauses per order in 24 hours (too_many_changes,
--      54000), so a loop of add and remove cannot flood the owner group. Returns {id, number, end_date, skipped, max}.
--   4. public.cancel_my_pause(id)  (authenticated) removes a pause of the caller's own order that the customer added
--      (source 'customer'; a pause staff set is staff_pause, 42501: the customer asks staff) and that starts on or after
--      customer_pause_first_day(now()) (pause_locked, 55000, otherwise: that day's rations are planned). Errors also
--      not_found, already_cancelled, not_pausable. Returns {number, end_date}.
--   5. public.my_order_pauses_v2()  (authenticated) as my_order_pauses (0028) plus the pause id (for cancel_my_pause)
--      and its source: id, number, from_date, to_date, source. Active pauses of the caller's own orders only; no staff
--      ids. my_order_pauses keeps its return type (changing it would need a DROP); the account switches to v2.
--   6. private.telegram_from_order (0026): the 0026 body plus one payload key, pause: {action, source, from, to, end}
--      from the history row's detail.pause (0028), only for an edit that is a pause. The owner-group message then says
--      which days were paused or freed, the new last delivery day and, for a customer's pause, that the customer did
--      it in the account (src/lib/telegram/render.ts). Dates of a pause are not customer contact data; the payload
--      still carries no name, phone, address, comment or exclusions.
--
-- Errors: not_allowed (42501: no signed-in user), bad_range (22023), pause_too_soon (22023), not_found (P0002),
-- not_pausable (55000), no_delivery_days (22023), pause_limit (23514, detail: the cap), too_many_changes (54000),
-- staff_pause (42501), already_cancelled (55000), pause_locked (55000).
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0007 and 0028: each public function first requires a signed-in user and then reads only that user's orders.

-- ---------- 1. customer_pause_first_day ----------
create or replace function private.customer_pause_first_day(p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Asia/Tashkent')::date
    + case
        when extract(hour from (p_at at time zone 'Asia/Tashkent')) < coalesce((
          -- The settings trigger (0017) keeps this a whole hour 0..23; anything else falls back to 14.
          select (s.value #>> '{}')::int
          from public.settings s
          where s.key = 'order_cutoff_hour' and (s.value #>> '{}') ~ '^([0-9]|1[0-9]|2[0-3])$'
        ), 14) then 1
        else 2
      end;
$$;

revoke all on function private.customer_pause_first_day(timestamptz) from public, anon, authenticated;

-- ---------- 2. add_order_pause ----------
create or replace function private.add_order_pause(
  p_order_id uuid,
  p_from date,
  p_to date,
  p_first date,
  p_source text,
  p_actor uuid
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_max int := private.pause_max_days();
  v_order record;
  v_id uuid;
  v_skipped int;
begin
  if p_order_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'bad_range' using errcode = '22023';
  end if;
  if p_first is null or p_from < p_first then
    raise exception 'pause_too_soon' using errcode = '22023';
  end if;

  -- Locked until the end of the call: a second pause of the same order waits, then sees this one in the cap.
  select o.id, o.status, o.start_date, o.weekdays_only, o.days
    into v_order
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_order.status not in ('confirmed', 'paid', 'active') then
    raise exception 'not_pausable' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as g(d)
    where private.order_day_index_paused(v_order.id, v_order.start_date, v_order.weekdays_only, g.d::date)
      between 1 and v_order.days
  ) then
    raise exception 'no_delivery_days' using errcode = '22023';
  end if;

  insert into public.order_pauses (order_id, from_date, to_date, created_by, source)
  values (v_order.id, p_from, p_to, p_actor, p_source)
  returning id into v_id;

  v_skipped := private.order_skipped_days(v_order.id, v_order.start_date, v_order.weekdays_only, v_order.days);
  if v_skipped > v_max then
    -- Rolls back the insert and its history row.
    raise exception 'pause_limit' using errcode = '23514', detail = v_max::text;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'end_date', private.order_end_date_paused(v_order.id, v_order.start_date, v_order.weekdays_only, v_order.days),
    'skipped', v_skipped,
    'max', v_max
  );
end;
$$;

revoke all on function private.add_order_pause(uuid, date, date, date, text, uuid) from public, anon, authenticated;

-- ---------- 3. pause_my_order ----------
create or replace function public.pause_my_order(p_number bigint, p_from date, p_to date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order_id uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_number is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'bad_range' using errcode = '22023';
  end if;

  -- Only the caller's own order; someone else's reads as missing. Locked here first, so the rate count below and the
  -- checks in add_order_pause see every earlier pause of this order.
  select o.id into v_order_id
  from public.orders o
  where o.number = p_number and o.user_id = v_uid
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if (
    select count(*)
    from public.order_pauses p
    where p.order_id = v_order_id and p.source = 'customer' and p.created_at > now() - interval '24 hours'
  ) >= 10 then
    raise exception 'too_many_changes' using errcode = '54000';
  end if;

  v_result := private.add_order_pause(
    v_order_id, p_from, p_to, private.customer_pause_first_day(now()), 'customer', v_uid
  );
  return v_result || jsonb_build_object('number', p_number);
end;
$$;

revoke all on function public.pause_my_order(bigint, date, date) from public, anon;
grant execute on function public.pause_my_order(bigint, date, date) to authenticated;

-- ---------- 4. cancel_my_pause ----------
create or replace function public.cancel_my_pause(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select p.id, p.order_id, p.from_date, p.source, p.cancelled_at,
         o.number, o.status, o.start_date, o.weekdays_only, o.days
    into v_row
  from public.order_pauses p
  join public.orders o on o.id = p.order_id
  where p.id = p_id and o.user_id = v_uid
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.source <> 'customer' then
    raise exception 'staff_pause' using errcode = '42501';
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'already_cancelled' using errcode = '55000';
  end if;
  if v_row.status not in ('confirmed', 'paid', 'active') then
    raise exception 'not_pausable' using errcode = '55000';
  end if;
  if v_row.from_date < private.customer_pause_first_day(now()) then
    raise exception 'pause_locked' using errcode = '55000';
  end if;

  update public.order_pauses
  set cancelled_at = now(), cancelled_by = v_uid
  where id = v_row.id;

  return jsonb_build_object(
    'number', v_row.number,
    'end_date', private.order_end_date_paused(v_row.order_id, v_row.start_date, v_row.weekdays_only, v_row.days)
  );
end;
$$;

revoke all on function public.cancel_my_pause(uuid) from public, anon;
grant execute on function public.cancel_my_pause(uuid) to authenticated;

-- ---------- 5. my_order_pauses_v2 ----------
create or replace function public.my_order_pauses_v2()
returns table (id uuid, number bigint, from_date date, to_date date, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, o.number, p.from_date, p.to_date, p.source
  from public.order_pauses p
  join public.orders o on o.id = p.order_id
  where o.user_id = (select auth.uid())
    and p.cancelled_at is null
  order by o.number, p.from_date, p.to_date
  limit 1000;
$$;

revoke execute on function public.my_order_pauses_v2() from public, anon, authenticated;
grant execute on function public.my_order_pauses_v2() to authenticated;

-- ---------- 6. telegram_from_order (0026) ----------
-- Body copied from 0026_telegram_outbox.sql; the only change is the 'pause' key, marked 0029.
create or replace function private.telegram_from_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
  v_order record;
begin
  begin
    if new.kind = 'status' and new.to_status in ('paid', 'cancelled') then
      v_event := new.to_status;
    elsif new.kind = 'edited' then
      v_event := 'edited';
    elsif new.kind = 'payment_method' then
      v_event := 'payment_method';
    else
      return null;
    end if;

    select o.number, o.program_name, o.kcal, o.days, o.total
      into v_order
    from public.orders o
    where o.id = new.order_id;

    perform private.telegram_enqueue(
      'order',
      'order:' || new.id,
      jsonb_build_object(
        'event', v_event,
        'number', v_order.number,
        'program', v_order.program_name,
        'kcal', v_order.kcal,
        'days', v_order.days,
        'total', v_order.total,
        'from_status', case when new.kind = 'status' then new.from_status end,
        'payment_method', case when v_event = 'paid' then new.detail ->> 'payment_method' end,
        'method_from', case when v_event = 'payment_method' then new.detail ->> 'from' end,
        'method_to', case when v_event = 'payment_method' then new.detail ->> 'to' end,
        'fields', case when v_event = 'edited' and jsonb_typeof(new.detail) = 'object' then (
          select jsonb_agg(k.key order by k.key)
          from jsonb_object_keys(new.detail) as k(key)
          where k.key <> 'account_unlinked'
        ) end,
        -- 0029: a pause added or removed (detail.pause, 0028): its days, who did it and the new last delivery day.
        'pause', case when v_event = 'edited' and jsonb_typeof(new.detail -> 'pause') = 'object' then
          jsonb_build_object(
            'action', new.detail #>> '{pause,action}',
            'source', new.detail #>> '{pause,source}',
            'from', new.detail #>> '{pause,from}',
            'to', new.detail #>> '{pause,to}',
            'end', new.detail #>> '{pause,end}'
          )
        end,
        'actor', private.telegram_actor(new.actor_name)
      )
    );
  exception
    when others then
      null;
  end;
  return null;
end;
$$;

revoke all on function private.telegram_from_order() from public, anon, authenticated;
