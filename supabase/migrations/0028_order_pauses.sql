-- Pause and skip delivery days: an order's delivery days can be paused for a date range, and the order's end moves
-- later by the delivery days skipped. Every day sheet, figure and report that derives delivery days or an end date
-- reads the pauses from here on. Plan: docs/plans/pause-and-skip-days.md, slices 1 and 2 (staff only; the customer
-- functions pause_my_order and cancel_my_pause come with slice 3, in a later migration).
--
-- ADDITIVE ONLY. No table, column, row, constraint, policy or grant is dropped or changed; no DROP, TRUNCATE, DELETE or
-- UPDATE of existing rows. Existing functions are replaced with CREATE OR REPLACE and their identical signature, return
-- type, security, search_path and grants (restated after each one). The old private.order_day_index (0009) and
-- private.order_end_date (0020) stay as they were: the new paused versions call them, and nothing breaks mid-deploy.
-- Does not depend on 0027 (orders.request_id, submit_order): nothing here reads them.
--
--   1. New table public.order_pauses: one row per paused range of an order (from_date .. to_date, calendar days, both
--      included), who added it (created_by, source staff or customer), and cancelled_at / cancelled_by once it was
--      removed before it started. Ranges may overlap: a day is paused when any active (not cancelled) range covers it,
--      so overlapping pauses merge. RLS on. Clients read only, and only owners and managers
--      (private.can_handle_orders(), as the orders policies, 0012): the rows carry staff account ids (created_by,
--      cancelled_by). Customers read their pauses only through public.my_order_pauses() (4c), without those ids. No
--      client may insert, update or delete: rows are written only by the functions in 4 (and slice 3's customer
--      functions).
--   2. New private helpers (called from the definer functions as their owner; no client role needs them):
--        pause_max_days()          the cap of paused delivery days per order: settings key pause_max_days (a JSON
--                                  number, floored, kept when 1..366: 10 and 10.0 both mean 10), else 30. No settings
--                                  row is added: the default applies until the owner sets one. parsePauseMax in
--                                  src/lib/admin/pauses.ts is the same rule.
--        order_pause_span(order)   the calendar days the order's active pauses cover, overlaps counted twice. Only
--                                  widens the cheap prefilters `D - start < days * 2 + 7` (0009) to
--                                  `D - start < (days + span) * 2 + 7`: n delivery days plus k paused days span at most
--                                  1.4 (n + k) + 7 calendar days, and k <= span.
--        order_paused_on(order, D) D is inside an active pause of the order.
--        order_day_index_paused(order, start, weekdays_only, D)  which delivery day D is, counting only days that are
--                                  not paused: null before the start, on a weekend of a weekdays-only order and on a
--                                  paused day; otherwise private.order_day_index minus the paused delivery days from the
--                                  start through D. With no active pause it is exactly private.order_day_index.
--        order_end_date_paused(order, start, weekdays_only, days)  the day whose paused index is `days`. With no active
--                                  pause it is exactly private.order_end_date.
--        order_skipped_days(order, start, weekdays_only, days)  the delivery days the pauses moved later: the plain
--                                  day index of the paused end minus `days` (0 without pauses). What the cap counts.
--        order_delivers_on(order, D)  the order delivers on D: its status is confirmed, paid or active and its paused
--                                  index on D is 1 .. days. The one-order form of the day sheets' rule.
--   3. New after-insert-or-update trigger order_pauses_log_event (private.log_order_pause, security definer): each pause
--      added or cancelled is one row in public.order_events (0018) of the existing kind 'edited', with
--      detail {"pause": {"action": "added" | "cancelled", "from", "to", "source", "end"}} (end: the order's last
--      delivery day after the change). The actor and their staff name are recorded as for every order change. Being an
--      'edited' event, it reaches the owner group in Telegram (0026, fields ["pause"]) and the owner's audit feed
--      (0019/0022) like any other order edit. No change to order_events or its kind check.
--   4. New security definer functions, owners and managers only (raise not_allowed, 42501, for anyone else),
--      executable by authenticated:
--        staff_pause_order(order_id, from, to)  adds a pause to a confirmed, paid or active order. from is after today
--                       (Tashkent; tomorrow at the earliest, so every pause can still be removed before it starts),
--                       to >= from, at most 93 calendar days; the range must hold at least one day
--                       the order delivers on now (no_delivery_days otherwise: before the start, after the end, only
--                       weekends of a weekdays-only order, or already paused). After the insert the order's skipped
--                       delivery days may not exceed pause_max_days (pause_limit, 23514; the insert is rolled back).
--                       The order row is locked while it checks, so two pauses at once cannot both pass the cap.
--                       Returns {id, end_date, skipped, max}.
--        staff_cancel_pause(pause_id)  cancels an active pause that has not started (from_date after today, Tashkent)
--                       of a confirmed, paid or active order. Returns {order_id, end_date}.
--        my_order_pauses()  (any signed-in customer) the active pauses of the caller's own orders (orders.user_id =
--                       auth.uid()): order number, from_date, to_date. No staff ids, no cancelled pauses. The account page
--                       reads it beside my_orders() (0007) and works out end dates and the status line with the paused
--                       day rule (src/lib/order/days.ts).
--      Errors: not_allowed (42501), bad_range (22023), pause_too_soon (22023: from is today or earlier), not_found
--      (P0002), not_pausable (55000), no_delivery_days (22023), pause_limit (23514), already_cancelled (55000),
--      pause_started (55000).
--   5. Switched to the paused versions (bodies copied from the migration named; only the day rule and the prefilter
--      bound change, marked "0028" in each):
--        public.kitchen_orders(date)        0009  day_index and the bound
--        public.delivery_orders(date)       0012  day_index and the bound
--        private.customer_rows(...)         0020  each order's end (customers list, customer page, ending tile)
--        public.customers_ending()          0020  the phone prefilter bound
--        public.customer_orders(uuid)       0020  end_date
--        public.report_renewals(date, date) 0021  each plan's end and the start bound
--        private.ration_counts(...)         0023  the day rule and the day range (shopping list, ingredient usage,
--                                                 the digest's rations)
--        public.daily_digest(date)          0026  deliveries per window and the ending prefilter bound
--      public.my_orders() (0007) returns no end date (the account computes it in TypeScript, src/lib/order/days.ts)
--      and is not changed: its return type cannot change without a DROP. The account adds my_order_pauses() (4c).
--   6. public.staff_edit_order (0018) is replaced with CREATE OR REPLACE and the identical signature, return type and
--      grants: its body is the 0018 body plus one check. When the start date or weekdays-only changes and the order
--      has an active pause, it raises has_pauses (55000) and changes nothing: pauses are dates of the old schedule, so
--      staff remove them first.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0018 and 0020: the role check is the first statement of each public function.

-- ---------- 1. order_pauses ----------
create table public.order_pauses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_date date not null,
  to_date date not null,
  created_by uuid references auth.users (id) on delete set null,
  source text not null check (source in ('staff', 'customer')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  constraint order_pauses_range check (to_date >= from_date and to_date - from_date < 366)
);

-- The day rule reads the active pauses of one order; the full index serves the foreign key (cascade on delete).
create index order_pauses_order on public.order_pauses (order_id);
create index order_pauses_active on public.order_pauses (order_id, from_date) where cancelled_at is null;
-- The foreign keys' columns, so removing an account never scans the pauses.
create index order_pauses_created_by on public.order_pauses (created_by) where created_by is not null;
create index order_pauses_cancelled_by on public.order_pauses (cancelled_by) where cancelled_by is not null;

alter table public.order_pauses enable row level security;

-- Read only for the client roles: written through the definer functions below and nothing else.
revoke all on table public.order_pauses from anon, authenticated;
grant select on table public.order_pauses to authenticated;

-- Owners and managers only: the rows hold staff account ids. Customers read through public.my_order_pauses() (4c).
create policy "order handlers read order pauses" on public.order_pauses
  for select to authenticated
  using ((select private.can_handle_orders()));

-- ---------- 2. day rule with pauses ----------
create or replace function private.pause_max_days()
returns int
language sql
stable
set search_path = ''
as $$
  -- A JSON number, floored (10.0 and 10.9 mean 10), kept when 1 .. 366. The cast is safe: jsonb numbers are numeric.
  select coalesce((
    select case when floor((s.value #>> '{}')::numeric) between 1 and 366
      then floor((s.value #>> '{}')::numeric)::int end
    from public.settings s
    where s.key = 'pause_max_days' and jsonb_typeof(s.value) = 'number'
  ), 30);
$$;

revoke all on function private.pause_max_days() from public, anon, authenticated;

create or replace function private.order_pause_span(p_order_id uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(p.to_date - p.from_date + 1), 0)::int
  from public.order_pauses p
  where p.order_id = p_order_id and p.cancelled_at is null;
$$;

revoke all on function private.order_pause_span(uuid) from public, anon, authenticated;

create or replace function private.order_paused_on(p_order_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.order_pauses p
    where p.order_id = p_order_id
      and p.cancelled_at is null
      and p_date between p.from_date and p.to_date
  );
$$;

revoke all on function private.order_paused_on(uuid, date) from public, anon, authenticated;

-- Which delivery day of the order p_date is, skipping paused days. The paused days subtracted are the distinct
-- delivery days (weekdays for a weekdays-only order) from the start through p_date inside any active pause, so
-- overlapping pauses count once.
create or replace function private.order_day_index_paused(
  p_order_id uuid,
  p_start date,
  p_weekdays_only boolean,
  p_date date
)
returns int
language sql
stable
set search_path = ''
as $$
  select case
    when not exists (
      select 1 from public.order_pauses p where p.order_id = p_order_id and p.cancelled_at is null
    ) then private.order_day_index(p_start, p_weekdays_only, p_date)
    when private.order_day_index(p_start, p_weekdays_only, p_date) is null then null
    when private.order_paused_on(p_order_id, p_date) then null
    else private.order_day_index(p_start, p_weekdays_only, p_date) - (
      select count(distinct g.d)::int
      from public.order_pauses p
      -- Explicit timestamps: generate_series over dates would otherwise resolve to the timestamptz version.
      cross join lateral generate_series(
        greatest(p.from_date, p_start)::timestamp,
        least(p.to_date, p_date)::timestamp,
        interval '1 day'
      ) as g(d)
      where p.order_id = p_order_id
        and p.cancelled_at is null
        and p.to_date >= p_start
        and p.from_date <= p_date
        and (not coalesce(p_weekdays_only, false) or extract(isodow from g.d) not in (6, 7))
    )
  end;
$$;

revoke all on function private.order_day_index_paused(uuid, date, boolean, date) from public, anon, authenticated;

-- The last delivery day with pauses: the days-th day from the start that is a delivery day and not paused. The bound
-- (days + span) * 2 + 7 calendar days is the prefilter bound above.
create or replace function private.order_end_date_paused(
  p_order_id uuid,
  p_start date,
  p_weekdays_only boolean,
  p_days int
)
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when p_start is null or p_days is null or p_days < 1 then null
    when not exists (
      select 1 from public.order_pauses p where p.order_id = p_order_id and p.cancelled_at is null
    ) then private.order_end_date(p_start, p_weekdays_only, p_days)
    else (
      select g.d::date
      from generate_series(
        p_start::timestamp,
        p_start::timestamp + ((p_days + private.order_pause_span(p_order_id)) * 2 + 7) * interval '1 day',
        interval '1 day'
      ) as g(d)
      where (not coalesce(p_weekdays_only, false) or extract(isodow from g.d) not in (6, 7))
        and not private.order_paused_on(p_order_id, g.d::date)
      order by g.d
      offset p_days - 1
      limit 1
    )
  end;
$$;

revoke all on function private.order_end_date_paused(uuid, date, boolean, int) from public, anon, authenticated;

-- The delivery days the pauses moved later. Pauses before the start or after the end skip nothing and count 0.
create or replace function private.order_skipped_days(
  p_order_id uuid,
  p_start date,
  p_weekdays_only boolean,
  p_days int
)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(
    private.order_day_index(
      p_start,
      p_weekdays_only,
      private.order_end_date_paused(p_order_id, p_start, p_weekdays_only, p_days)
    ) - p_days,
    0
  );
$$;

revoke all on function private.order_skipped_days(uuid, date, boolean, int) from public, anon, authenticated;

create or replace function private.order_delivers_on(p_order_id uuid, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select o.status in ('confirmed', 'paid', 'active')
      and private.order_day_index_paused(o.id, o.start_date, o.weekdays_only, p_date) between 1 and o.days
    from public.orders o
    where o.id = p_order_id
  ), false);
$$;

revoke all on function private.order_delivers_on(uuid, date) from public, anon, authenticated;

-- ---------- 3. history ----------
create or replace function private.log_order_pause()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_action text;
  v_end date;
begin
  if tg_op = 'INSERT' then
    v_action := 'added';
  elsif new.cancelled_at is not null and old.cancelled_at is null then
    v_action := 'cancelled';
  else
    return null;
  end if;

  if v_uid is not null then
    select btrim(s.name) into v_name from public.staff s where s.user_id = v_uid;
  end if;

  select private.order_end_date_paused(o.id, o.start_date, o.weekdays_only, o.days)
    into v_end
  from public.orders o
  where o.id = new.order_id;

  insert into public.order_events (order_id, actor, actor_name, kind, detail)
  values (
    new.order_id, v_uid, coalesce(v_name, ''), 'edited',
    jsonb_build_object('pause', jsonb_build_object(
      'action', v_action,
      'from', new.from_date,
      'to', new.to_date,
      'source', new.source,
      'end', v_end
    ))
  );
  return null;
end;
$$;

revoke all on function private.log_order_pause() from public;

create trigger order_pauses_log_event
  after insert or update on public.order_pauses
  for each row execute function private.log_order_pause();

-- ---------- 4a. staff_pause_order ----------
create or replace function public.staff_pause_order(p_order_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_max int := private.pause_max_days();
  v_order record;
  v_id uuid;
  v_skipped int;
begin
  if not private.can_handle_orders() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_order_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'bad_range' using errcode = '22023';
  end if;
  -- Tomorrow at the earliest: today's rations are planned, and a pause can be removed only before it starts.
  if p_from <= v_today then
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
  values (v_order.id, p_from, p_to, auth.uid(), 'staff')
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

revoke all on function public.staff_pause_order(uuid, date, date) from public, anon;
grant execute on function public.staff_pause_order(uuid, date, date) to authenticated;

-- ---------- 4b. staff_cancel_pause ----------
create or replace function public.staff_cancel_pause(p_pause_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_row record;
begin
  if not private.can_handle_orders() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select p.id, p.order_id, p.from_date, p.cancelled_at, o.status, o.start_date, o.weekdays_only, o.days
    into v_row
  from public.order_pauses p
  join public.orders o on o.id = p.order_id
  where p.id = p_pause_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'already_cancelled' using errcode = '55000';
  end if;
  if v_row.status not in ('confirmed', 'paid', 'active') then
    raise exception 'not_pausable' using errcode = '55000';
  end if;
  if v_row.from_date <= v_today then
    raise exception 'pause_started' using errcode = '55000';
  end if;

  update public.order_pauses
  set cancelled_at = now(), cancelled_by = auth.uid()
  where id = v_row.id;

  return jsonb_build_object(
    'order_id', v_row.order_id,
    'end_date', private.order_end_date_paused(v_row.order_id, v_row.start_date, v_row.weekdays_only, v_row.days)
  );
end;
$$;

revoke all on function public.staff_cancel_pause(uuid) from public, anon;
grant execute on function public.staff_cancel_pause(uuid) to authenticated;

-- ---------- 4c. my_order_pauses ----------
-- The caller's own active pauses, for the account page: no staff ids, no cancelled rows. Same pattern as my_orders
-- (0007): security definer, only rows of orders whose user_id is the caller.
create or replace function public.my_order_pauses()
returns table (number bigint, from_date date, to_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select o.number, p.from_date, p.to_date
  from public.order_pauses p
  join public.orders o on o.id = p.order_id
  where o.user_id = (select auth.uid())
    and p.cancelled_at is null
  order by o.number, p.from_date, p.to_date
  limit 1000;
$$;

revoke execute on function public.my_order_pauses() from public, anon, authenticated;
grant execute on function public.my_order_pauses() to authenticated;

-- ---------- 5. callers switched to the paused day rule ----------

-- ---------- 5a. kitchen_orders (0009) ----------
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
    select private.order_day_index_paused(o.id, o.start_date, o.weekdays_only, p_date) as day_index -- 0028
  ) x
  where (select private.is_staff())
    and p_date is not null
    and o.status in ('confirmed', 'paid', 'active')
    and o.start_date <= p_date
    and p_date - o.start_date < (o.days + private.order_pause_span(o.id)) * 2 + 7 -- 0028
    and x.day_index between 1 and o.days
  order by o.number;
$$;

revoke all on function public.kitchen_orders(date) from public, anon;
grant execute on function public.kitchen_orders(date) to authenticated;

-- ---------- 5b. delivery_orders (0012) ----------
create or replace function public.delivery_orders(p_date date)
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
  staff_note text
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
    o.staff_note
  from public.orders o
  cross join lateral (
    select private.order_day_index_paused(o.id, o.start_date, o.weekdays_only, p_date) as day_index -- 0028
  ) x
  where (select private.can_handle_orders())
    and p_date is not null
    and o.status in ('confirmed', 'paid', 'active')
    and o.start_date <= p_date
    and p_date - o.start_date < (o.days + private.order_pause_span(o.id)) * 2 + 7 -- 0028
    and x.day_index between 1 and o.days
  order by o.delivery_window, o.address, o.number;
$$;

-- Same grants as 0010 (create or replace keeps them; restated so this file reads on its own).
revoke all on function public.delivery_orders(date) from public, anon;
grant execute on function public.delivery_orders(date) to authenticated;

-- ---------- 5c. customer_rows (0020) ----------
create or replace function private.customer_rows(
  p_today date,
  p_phones text[],
  p_like text,
  p_digits text,
  p_number bigint
)
returns table (
  customer_key uuid,
  phone text,
  customer_name text,
  last_address text,
  last_window text,
  orders_count int,
  paid_count int,
  total_paid bigint,
  first_order_at timestamptz,
  last_order_at timestamptz,
  plan_ends date,
  last_plan_end date,
  state text,
  is_active boolean,
  is_ending boolean,
  is_lapsed boolean,
  is_new boolean,
  has_account boolean,
  source text
)
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      o.phone as b_phone,
      o.number as b_number,
      o.status as b_status,
      o.customer_name as b_name,
      o.total as b_total,
      o.created_at as b_created_at,
      o.start_date as b_start,
      o.user_id as b_user_id,
      case when o.status in ('paid', 'active', 'completed')
        then private.order_end_date_paused(o.id, o.start_date, o.weekdays_only, o.days) -- 0028
      end as b_end
    from public.orders o
    where p_phones is null or o.phone = any (p_phones)
  ),
  agg as (
    select
      b.b_phone as a_phone,
      count(*)::int as a_orders,
      (count(*) filter (where b.b_status <> 'cancelled'))::int as a_live,
      (count(*) filter (where b.b_status in ('paid', 'active', 'completed')))::int as a_paid,
      (coalesce(sum(b.b_total) filter (where b.b_status in ('paid', 'active', 'completed')), 0))::bigint as a_total,
      min(b.b_created_at) as a_first,
      max(b.b_created_at) as a_last,
      max(b.b_end) filter (where b.b_status in ('paid', 'active') and b.b_end >= p_today) as a_plan_ends,
      max(b.b_end) as a_last_end,
      coalesce(bool_or(b.b_status in ('paid', 'active') and b.b_start <= p_today and b.b_end >= p_today), false)
        as a_running,
      coalesce(bool_or(b.b_status in ('paid', 'active') and b.b_start > p_today), false) as a_upcoming,
      -- A request older than 30 days that nobody handled is not a sign the customer is still with us.
      coalesce(bool_or(
        b.b_status in ('new', 'confirmed') and (b.b_created_at at time zone 'Asia/Tashkent')::date > p_today - 30
      ), false) as a_pending,
      coalesce(bool_or(b.b_user_id is not null), false) as a_linked,
      coalesce(bool_or(b.b_name ilike p_like), false) as a_name_match,
      coalesce(bool_or(b.b_number = p_number), false) as a_number_match
    from base b
    group by b.b_phone
  ),
  firsts as (
    select distinct on (o.phone) o.phone as f_phone, o.id as f_id, o.source as f_source
    from public.orders o
    where p_phones is null or o.phone = any (p_phones)
    order by o.phone, o.created_at, o.id
  ),
  -- The latest order that is not cancelled (false sorts first), else the latest of any status.
  latest as (
    select distinct on (o.phone)
      o.phone as l_phone, o.customer_name as l_name, o.address as l_address, o.delivery_window as l_window
    from public.orders o
    where p_phones is null or o.phone = any (p_phones)
    order by o.phone, (o.status = 'cancelled'), o.created_at desc, o.id desc
  ),
  cust as (
    select
      a.*,
      f.f_id,
      f.f_source,
      l.l_name,
      l.l_address,
      l.l_window,
      -- 3 days in all: today and the next 2 (ENDING_SOON_DAYS).
      (a.a_plan_ends is not null and a.a_plan_ends <= p_today + 2) as a_ending,
      (a.a_last_end is not null and a.a_last_end <= p_today - 14 and not a.a_pending) as a_lapsed,
      (a.a_live > 0 and (a.a_first at time zone 'Asia/Tashkent')::date > p_today - 30) as a_new
    from agg a
    join firsts f on f.f_phone = a.a_phone
    join latest l on l.l_phone = a.a_phone
  )
  select
    c.f_id,
    c.a_phone,
    c.l_name,
    c.l_address,
    c.l_window,
    c.a_orders,
    c.a_paid,
    c.a_total,
    c.a_first,
    c.a_last,
    c.a_plan_ends,
    c.a_last_end,
    case
      when c.a_ending then 'ending'
      when c.a_running then 'active'
      when c.a_upcoming then 'upcoming'
      when c.a_pending then 'pending'
      when c.a_lapsed then 'lapsed'
      when c.a_last_end is not null then 'ended'
      else 'none'
    end,
    c.a_running,
    c.a_ending,
    c.a_lapsed,
    c.a_new,
    (c.a_linked or exists (
      select 1 from public.profiles p where p.phone = c.a_phone and p.phone is not null
    )),
    lower(coalesce(nullif(btrim(c.f_source ->> 'utm_source'), ''), nullif(btrim(c.f_source ->> 'ref'), '')))
  from cust c
  where case
    when p_like is not null then
      c.a_name_match and (p_digits is null or c.a_phone like '%' || p_digits || '%')
    when p_digits is not null or p_number is not null then
      (p_digits is not null and c.a_phone like '%' || p_digits || '%') or (p_number is not null and c.a_number_match)
    else true
  end;
$$;

revoke all on function private.customer_rows(date, text[], text, text, bigint) from public, anon, authenticated;

-- ---------- 5d. customers_ending (0020) ----------
create or replace function public.customers_ending()
returns table (ending_count int, ending_next date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_phones text[];
begin
  if not private.can_handle_orders() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_phones := array(
    select distinct o.phone
    from public.orders o
    where o.status in ('paid', 'active')
      and o.start_date <= v_today + 2
      and v_today - o.start_date < (o.days + private.order_pause_span(o.id)) * 2 + 7 -- 0028
  );

  return query
    select
      (count(*) filter (where r.is_ending))::int,
      min(r.plan_ends) filter (where r.is_ending)
    from private.customer_rows(v_today, v_phones, null, null, null) r;
end;
$$;

revoke all on function public.customers_ending() from public, anon;
grant execute on function public.customers_ending() to authenticated;

-- ---------- 5e. customer_orders (0020) ----------
create or replace function public.customer_orders(p_key uuid)
returns table (
  id uuid,
  number bigint,
  status text,
  program_name text,
  kcal int,
  days int,
  weekdays_only boolean,
  start_date date,
  end_date date,
  total int,
  payment_method text,
  created_by uuid,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  if not private.can_handle_orders() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select o.phone into v_phone from public.orders o where o.id = p_key;
  if v_phone is null then
    return;
  end if;

  return query
    select
      o.id,
      o.number,
      o.status,
      o.program_name,
      o.kcal,
      o.days,
      o.weekdays_only,
      o.start_date,
      case when o.status <> 'cancelled' then private.order_end_date_paused(o.id, o.start_date, o.weekdays_only, o.days) end, -- 0028
      o.total,
      o.payment_method,
      o.created_by,
      o.created_at
    from public.orders o
    where o.phone = v_phone
    order by o.created_at desc, o.id desc
    limit 200;
end;
$$;

revoke all on function public.customer_orders(uuid) from public, anon;
grant execute on function public.customer_orders(uuid) to authenticated;

-- ---------- 5f. report_renewals (0021) ----------
create or replace function public.report_renewals(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  with ends as (
    select o.id as e_id, o.phone as e_phone, o.created_at as e_created_at,
      private.order_end_date_paused(o.id, o.start_date, o.weekdays_only, o.days) as e_end -- 0028
    from public.orders o
    where o.status in ('paid', 'active', 'completed')
      and o.start_date <= p_to
      and o.start_date >= p_from - ((o.days + private.order_pause_span(o.id)) * 2 + 7) -- 0028
  ),
  -- Each customer's latest plan that ended in the period.
  latest as (
    select distinct on (e.e_phone) e.e_id, e.e_phone, e.e_created_at, e.e_end
    from ends e
    where e.e_end between p_from and p_to
    order by e.e_phone, e.e_end desc, e.e_created_at desc, e.e_id
  ),
  -- The Tashkent day of the first paid order the customer placed after that plan's order.
  nexts as (
    select l.e_end as n_end, (
      select min((o2.created_at at time zone 'Asia/Tashkent')::date)
      from public.orders o2
      where o2.phone = l.e_phone
        and o2.id <> l.e_id
        and o2.status in ('paid', 'active', 'completed')
        and o2.created_at > l.e_created_at
    ) as n_next
    from latest l
  ),
  judged as (
    select n.n_end, n.n_next, (n.n_next is not null and n.n_next <= n.n_end + 14) as j_renewed
    from nexts n
  )
  select jsonb_build_object(
    'ended', count(*)::int,
    'renewed', (count(*) filter (where j.j_renewed))::int,
    'waiting', (count(*) filter (where not j.j_renewed and j.n_next is null and j.n_end + 14 >= v_today))::int,
    'early', (count(*) filter (where j.j_renewed and j.n_next <= j.n_end))::int,
    'avg_gap_days', round((avg(greatest(j.n_next - j.n_end, 0)) filter (where j.j_renewed))::numeric, 1)
  )
  into v_result
  from judged j;

  return v_result;
end;
$$;

revoke all on function public.report_renewals(date, date) from public, anon;
grant execute on function public.report_renewals(date, date) to authenticated;

-- ---------- 5g. ration_counts (0023) ----------
create or replace function private.ration_counts(p_from date, p_to date, p_statuses text[], p_cancelled boolean default false)
returns table (variant_id uuid, day date, rations int)
language sql
stable
security definer
set search_path = ''
as $$
  select o.variant_id, g.d::date, count(*)::int
  from public.orders o
  left join lateral (
    select e.at, e.from_status
    from public.order_events e
    where e.order_id = o.id and e.kind = 'status' and e.to_status = 'cancelled'
    order by e.at desc, e.id desc
    limit 1
  ) ce on o.status = 'cancelled'
  cross join lateral (
    select case
      when o.status <> 'cancelled' then null
      when ce.at is not null then
        case when ce.from_status in ('paid', 'active') then (ce.at at time zone 'Asia/Tashkent')::date end
      when o.paid_at is not null then (o.updated_at at time zone 'Asia/Tashkent')::date
    end as cancel_day
  ) cx
  -- 0028: the calendar days the order's pauses cover widen the day range (the prefilter bound of section 2).
  cross join lateral (select private.order_pause_span(o.id) as span) ps
  cross join lateral generate_series(
    greatest(o.start_date, p_from)::timestamp,
    least(p_to, o.start_date + ((o.days + ps.span) * 2 + 6), coalesce(cx.cancel_day - 1, p_to))::timestamp, -- 0028
    interval '1 day'
  ) as g(d)
  where (o.status = any (p_statuses) or (p_cancelled and o.status = 'cancelled' and cx.cancel_day is not null))
    and o.start_date <= p_to
    and o.start_date + ((o.days + ps.span) * 2 + 6) >= p_from -- 0028
    and private.order_day_index_paused(o.id, o.start_date, o.weekdays_only, g.d::date) between 1 and o.days -- 0028
  group by o.variant_id, g.d::date;
$$;

revoke all on function private.ration_counts(date, date, text[], boolean) from public, anon, authenticated;

-- ---------- 5h. daily_digest (0026) ----------
create or replace function public.daily_digest(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_y date := p_day - 1;
  v_from timestamptz := (p_day - 1)::timestamp at time zone 'Asia/Tashkent';
  v_to timestamptz := p_day::timestamp at time zone 'Asia/Tashkent';
  v_yesterday jsonb;
  v_levels jsonb;
  v_windows jsonb;
  v_deliveries int;
  v_phones text[];
  v_ending int;
  v_ending_next date;
begin
  if p_day is null then
    raise exception 'bad_day' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'placed', (select count(*)::int from public.orders o where o.created_at >= v_from and o.created_at < v_to),
    'paid', (select count(*)::int from private.report_paid_orders(v_y, v_y)),
    'paid_sum', (select coalesce(sum(r.r_total), 0)::bigint from private.report_paid_orders(v_y, v_y) r),
    'cancelled', (
      select count(distinct e.order_id)::int
      from public.order_events e
      where e.kind = 'status' and e.to_status = 'cancelled' and e.at >= v_from and e.at < v_to
    ),
    'expenses', (
      select count(*)::int from public.finance_entries f
      where f.entry_type = 'expense' and f.created_at >= v_from and f.created_at < v_to
        and not exists (select 1 from public.purchases p where p.finance_entry_id = f.id)
    ),
    'expenses_sum', (
      select coalesce(sum(f.amount), 0)::bigint from public.finance_entries f
      where f.entry_type = 'expense' and f.created_at >= v_from and f.created_at < v_to
        and not exists (select 1 from public.purchases p where p.finance_entry_id = f.id)
    ),
    'purchases', (select count(*)::int from public.purchases p where p.created_at >= v_from and p.created_at < v_to),
    'purchases_sum', (
      select coalesce(sum(p.total), 0)::bigint from public.purchases p where p.created_at >= v_from and p.created_at < v_to
    ),
    'investor_sum', (
      select coalesce(sum(f.amount), 0)::bigint from public.finance_entries f
      where f.entry_type = 'income' and f.category = 'investor_support'
        and f.created_at >= v_from and f.created_at < v_to
    )
  )
    into v_yesterday;

  select coalesce(
    jsonb_agg(jsonb_build_object('program', p.name, 'kcal', v.kcal, 'rations', r.rations) order by p.name, v.kcal),
    '[]'::jsonb
  )
    into v_levels
  from private.ration_counts(p_day, p_day, array['confirmed', 'paid', 'active'], false) r
  join public.program_variants v on v.id = r.variant_id
  join public.programs p on p.id = v.program_id;

  select coalesce(jsonb_agg(jsonb_build_object('window', w.delivery_window, 'count', w.n) order by w.delivery_window), '[]'::jsonb),
         coalesce(sum(w.n), 0)::int
    into v_windows, v_deliveries
  from (
    select o.delivery_window, count(*)::int as n
    from public.orders o
    where o.status in ('confirmed', 'paid', 'active')
      and o.start_date <= p_day
      and p_day - o.start_date < (o.days + private.order_pause_span(o.id)) * 2 + 7 -- 0028
      and private.order_day_index_paused(o.id, o.start_date, o.weekdays_only, p_day) between 1 and o.days -- 0028
    group by o.delivery_window
  ) w;

  -- The prefilter and rule of public.customers_ending (0020), with p_day as today.
  v_phones := array(
    select distinct o.phone
    from public.orders o
    where o.status in ('paid', 'active')
      and o.start_date <= p_day + 2
      and p_day - o.start_date < (o.days + private.order_pause_span(o.id)) * 2 + 7 -- 0028
  );
  select (count(*) filter (where r.is_ending))::int, min(r.plan_ends) filter (where r.is_ending)
    into v_ending, v_ending_next
  from private.customer_rows(p_day, v_phones, null, null, null) r;

  return jsonb_build_object(
    'day', p_day,
    'yesterday', v_yesterday,
    'today', jsonb_build_object('levels', v_levels, 'deliveries', v_deliveries, 'windows', v_windows),
    'ending', coalesce(v_ending, 0),
    'ending_next', v_ending_next,
    'new_orders', (select count(*)::int from public.orders o where o.status = 'new'),
    'outbox_problems', (
      select count(*)::int from public.telegram_outbox t
      where t.status in ('failed', 'uncertain') and t.created_at >= now() - interval '7 days'
    )
  );
end;
$$;

revoke all on function public.daily_digest(date) from public, anon, authenticated;
grant execute on function public.daily_digest(date) to service_role;

-- ---------- 6. staff_edit_order (0018) ----------
-- Body copied from 0018_order_operations.sql; the only change is the has_pauses check, marked 0028.
-- Edits an open order. p_loaded_at is the updated_at the form was loaded with. Errors: not_allowed (42501),
-- not_found (P0002), not_editable (55000: completed or cancelled), stale (55000: changed since it was loaded),
-- schedule_locked (55000: start date or schedule changed on a paid order whose start date is today or past, or on an
-- active one), has_pauses (55000, 0028: start date or schedule changed while the order has an active pause), and invalid_date, invalid_phone,
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
    -- 0028: pauses are dates of the current schedule; staff remove them before moving it.
    if exists (select 1 from public.order_pauses p where p.order_id = p_id and p.cancelled_at is null) then
      raise exception 'has_pauses' using errcode = '55000';
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
