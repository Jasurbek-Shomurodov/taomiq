-- Customers in the back office: one row per phone number across every order (placed on the site or added by staff,
-- with or without a customer account), with the figures staff need to call back, renew or win back a customer, a
-- staff note per customer, and the customer's order history.
-- Plan: docs/plans/zarkebab-feature-port.md, slice 4.
--
-- Additive only. No existing table, column, row, policy, trigger, function or grant is changed or dropped; no new
-- customer data is collected (everything is read from public.orders and public.profiles):
--   1. New table public.customer_notes (phone → a staff note). RLS on; owners and managers read notes
--      (private.can_handle_orders(), the same rule as the orders policies, 0012). No client role may insert, update or
--      delete: anon and authenticated get select only, and there are no write policies. Notes are written only by
--      public.set_customer_note (5e). updated_at and updated_by are stamped by a trigger.
--   2. New partial index profiles_phone_idx on public.profiles (phone) where phone is not null (the column is the
--      nullable phone of 0006), for the "has an account" lookup per customer.
--   3. New private.order_end_date(start, weekdays_only, days): an order's last delivery day, the inverse of
--      private.order_day_index (0009). Every day: start + days - 1, plain date arithmetic (order_day_index is
--      (D - start) + 1 there). Weekdays only: the days-th weekday from the start, kept only when order_day_index agrees
--      that the day is the order's day number `days`, otherwise (only once the day rule changes, e.g. a future skips
--      table read by order_day_index) the day order_day_index names. A change to the every-day rule in
--      order_day_index must change the arithmetic here too.
--   4. New private.customer_search_terms(text): the customers search (same rules as the orders list's ?q=,
--      src/lib/admin/order-search.ts): letters → any name the phone ordered under, 4+ digits → the phone, both → both;
--      digits only also match an order number exactly. LIKE characters are escaped.
--   5. New private.customer_rows(today, phones, like, digits, number): the one aggregation every customer figure
--      comes from (list, chip counts, the customer page and the overview's "ending" tile), so they cannot disagree:
--        key            the id of the customer's earliest order (any status): an opaque, stable key for the customer
--                       page's address, so no phone number appears in a URL
--        figures        orders, paid orders (paid, active, completed), total paid (the same statuses, as finance
--                       counts revenue, 0013), first and last order
--        name, address, window  from the latest order that is not cancelled; from the latest order of any status only
--                       when every order of the phone is cancelled
--        plan_ends      the last delivery day of the current plan: the latest end of a paid or active order that ends
--                       today or later (a renewal already paid moves it out)
--        last_plan_end  the latest end of any paid, active or completed order
--        pending        a new or confirmed order created within the last 30 Tashkent days; older ones are ignored
--        active         a paid or active plan runs today (start <= today <= end)
--        ending         plan_ends is today or one of the next 2 days (3 days in all; ENDING_SOON_DAYS in
--                       src/lib/admin/customers.ts)
--        lapsed         last_plan_end is 14 or more days ago and nothing is pending
--        new            the first order was placed within the last 30 Tashkent days (today included) and at least one
--                       order is not cancelled (a phone whose every order is cancelled is never "new")
--        state          one word for the row's badge: ending, active, upcoming (paid, starts later), pending, lapsed,
--                       ended (ended under 14 days ago), none (never had a paid plan; also every order cancelled)
--        account        an order is on a customer account, or a profile has this phone
--        source         utm_source, else ref, of the first order (lower case), null for direct
--   6. New security definer functions, owners and managers only (raise not_allowed, 42501, for anyone else), executable
--      by authenticated:
--        customers_page(filter, search, page, page_size)  the chip counts and one page of the list from one
--                       aggregation, the page clamped to the last one. Money totals (total_paid) are returned to the
--                       owner only: null for a manager.
--        customers_ending()  the overview tile: the "ending" count and the earliest ending day, by the same
--                       customer_rows rule, read only for the phones that can be ending (see the function).
--        customer_detail(key), customer_orders(key)  the customer page. The order history returns each order's own
--                       price, which managers already read on the orders list and the order page.
--        set_customer_note(key, expected_phone, note)  the one way a note is written; refuses a key that resolves to
--                       no order (not_found) and a key whose order now has another phone (customer_changed).
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0008, 0013, 0015, 0018 and 0019: the role check is the first statement of each public function.

-- ---------- 1. customer_notes ----------
create table public.customer_notes (
  phone text primary key check (phone ~ '^\+998[0-9]{9}$'),
  note text not null default '' check (char_length(note) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- The foreign key's column, so removing an account never scans the notes.
create index customer_notes_updated_by on public.customer_notes (updated_by) where updated_by is not null;

alter table public.customer_notes enable row level security;

-- Read only for the client roles: written through public.set_customer_note (security definer) and nothing else.
revoke all on table public.customer_notes from anon, authenticated;
grant select on table public.customer_notes to authenticated;

create policy "order handlers read customer notes" on public.customer_notes
  for select to authenticated using ((select private.can_handle_orders()));

-- Who wrote the note last, and when: always the server's clock and the signed-in account.
create or replace function private.stamp_customer_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function private.stamp_customer_note() from public;

create trigger customer_notes_stamp
  before insert or update on public.customer_notes
  for each row execute function private.stamp_customer_note();

-- ---------- 2. profiles phone index ----------
create index if not exists profiles_phone_idx on public.profiles (phone) where phone is not null;

-- ---------- 3. order_end_date ----------
-- The last delivery day of an order: the day whose private.order_day_index is `days`. Null for a missing start or a
-- length under 1. The bound `days * 2 + 7` calendar days is the one the kitchen functions use (0009): n weekdays span
-- at most 1.4 n + 7 calendar days.
create or replace function private.order_end_date(p_start date, p_weekdays_only boolean, p_days int)
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when p_start is null or p_days is null or p_days < 1 then null
    -- Every day: order_day_index is (D - start) + 1, so day number `days` is start + days - 1.
    when not coalesce(p_weekdays_only, false) then p_start + (p_days - 1)
    else (
      with candidate as (
        -- Explicit timestamps: generate_series over dates would otherwise resolve to the timestamptz version.
        select g.d::date as d
        from generate_series(
          p_start::timestamp,
          p_start::timestamp + (p_days * 2 + 7) * interval '1 day',
          interval '1 day'
        ) as g(d)
        where extract(isodow from g.d) not in (6, 7)
        order by g.d
        offset p_days - 1
        limit 1
      )
      select case
        when private.order_day_index(p_start, true, c.d) = p_days then c.d
        else (
          select min(g.d::date)
          from generate_series(
            p_start::timestamp,
            p_start::timestamp + (p_days * 2 + 7) * interval '1 day',
            interval '1 day'
          ) as g(d)
          where private.order_day_index(p_start, true, g.d::date) = p_days
        )
      end
      from candidate c
    )
  end;
$$;

-- Called only from the definer functions below (as their owner); no client role needs it.
revoke all on function private.order_end_date(date, boolean, int) from public, anon, authenticated;

-- ---------- 4. customer_search_terms ----------
-- t_like    '%w1%w2%' of the letter words (LIKE characters escaped), matched against any name the phone ordered under
-- t_digits  the term's digits when there are 4 or more, matched as a substring of the phone (+998XXXXXXXXX)
-- t_number  a term of digits only (at most 18), matched against the number of any of the phone's orders
-- All null: no search (an empty term, or one too short to mean anything, as on the orders list).
create or replace function private.customer_search_terms(
  p_search text,
  out t_like text,
  out t_digits text,
  out t_number bigint
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_search text := left(btrim(coalesce(p_search, '')), 60);
  v_digits text;
  v_words text;
begin
  if v_search = '' then
    return;
  end if;

  v_digits := regexp_replace(v_search, '[^0-9]', '', 'g');
  v_words := btrim(regexp_replace(regexp_replace(v_search, '[0-9+]', ' ', 'g'), '\s+', ' ', 'g'));

  if v_words <> '' then
    t_like := '%' || replace(replace(replace(replace(v_words, '\', '\\'), '%', '\%'), '_', '\_'), ' ', '%') || '%';
  end if;
  if char_length(v_digits) >= 4 then
    t_digits := v_digits;
  end if;
  if t_like is null and v_search ~ '^[0-9]{1,18}$' then
    t_number := v_search::bigint;
  end if;
end;
$$;

revoke all on function private.customer_search_terms(text) from public, anon, authenticated;

-- ---------- 5. customer_rows ----------
-- One row per phone (all phones, or only those in p_phones), filtered by the search terms of customer_search_terms.
-- Days are Tashkent days; p_today is the caller's Tashkent today. Not callable by clients: only the definer functions
-- below, which check the role first.
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
        then private.order_end_date(o.start_date, o.weekdays_only, o.days)
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

-- ---------- 6a. customers_page ----------
-- The list in one call: { counts: { all, active, ending, lapsed, new }, page, pages, rows: [...] }. The counts are of
-- the customers matching the search (so the chips agree with the list); `page` is p_page clamped to 1..pages, so a
-- page past the end returns the last one without a second call. p_filter: all, active, ending, lapsed, new
-- (bad_filter, 22023, otherwise). p_page_size 1..200 (50 by default). Order: ending and active by plan end (soonest
-- first), lapsed by the last plan end (most recent first), new by the first order (newest first), all by the last
-- order (newest first); the phone breaks ties so pages neither repeat nor skip a row. total_paid is null for a
-- manager.
create or replace function public.customers_page(
  p_filter text default 'all',
  p_search text default null,
  p_page int default 1,
  p_page_size int default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_filter text := coalesce(p_filter, 'all');
  v_size int := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_owner boolean;
  v_like text;
  v_digits text;
  v_number bigint;
  v_result jsonb;
begin
  if not private.can_handle_orders() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_filter not in ('all', 'active', 'ending', 'lapsed', 'new') then
    raise exception 'bad_filter' using errcode = '22023';
  end if;

  v_owner := private.is_owner();
  select s.t_like, s.t_digits, s.t_number into v_like, v_digits, v_number
  from private.customer_search_terms(p_search) s;

  with r as materialized (
    select * from private.customer_rows(v_today, null, v_like, v_digits, v_number)
  ),
  counts as (
    select
      count(*)::int as n_all,
      (count(*) filter (where r.is_active))::int as n_active,
      (count(*) filter (where r.is_ending))::int as n_ending,
      (count(*) filter (where r.is_lapsed))::int as n_lapsed,
      (count(*) filter (where r.is_new))::int as n_new
    from r
  ),
  paging as (
    select
      x.pages,
      least(v_page, x.pages) as page
    from (
      select greatest(1, ceil(
        (case v_filter
          when 'active' then c.n_active
          when 'ending' then c.n_ending
          when 'lapsed' then c.n_lapsed
          when 'new' then c.n_new
          else c.n_all
        end)::numeric / v_size
      )::int) as pages
      from counts c
    ) x
  ),
  filtered as (
    select
      r.*,
      row_number() over (
        order by
          case when v_filter in ('ending', 'active') then r.plan_ends end asc nulls last,
          case when v_filter = 'lapsed' then r.last_plan_end end desc nulls last,
          case when v_filter = 'new' then r.first_order_at end desc nulls last,
          r.last_order_at desc,
          r.phone
      ) as rn
    from r
    where v_filter = 'all'
      or (v_filter = 'active' and r.is_active)
      or (v_filter = 'ending' and r.is_ending)
      or (v_filter = 'lapsed' and r.is_lapsed)
      or (v_filter = 'new' and r.is_new)
  )
  select jsonb_build_object(
    'counts', (
      select jsonb_build_object(
        'all', c.n_all, 'active', c.n_active, 'ending', c.n_ending, 'lapsed', c.n_lapsed, 'new', c.n_new
      )
      from counts c
    ),
    'page', p.page,
    'pages', p.pages,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'customer_key', f.customer_key,
        'phone', f.phone,
        'customer_name', f.customer_name,
        'orders_count', f.orders_count,
        'paid_count', f.paid_count,
        'total_paid', case when v_owner then f.total_paid end,
        'first_order_at', f.first_order_at,
        'last_order_at', f.last_order_at,
        'plan_ends', f.plan_ends,
        'last_plan_end', f.last_plan_end,
        'state', f.state,
        'is_new', f.is_new,
        'has_account', f.has_account,
        'source', f.source
      ) order by f.rn)
      from filtered f
      where f.rn > (p.page - 1) * v_size and f.rn <= p.page * v_size
    ), '[]'::jsonb)
  )
  into v_result
  from paging p;

  return v_result;
end;
$$;

revoke all on function public.customers_page(text, text, int, int) from public, anon;
grant execute on function public.customers_page(text, text, int, int) to authenticated;

-- ---------- 6b. customers_ending ----------
-- The overview tile: how many customers are "ending" and the earliest of their plan ends (null when none), by the
-- is_ending rule of customer_rows, so the tile and the Customers page's "ending" chip are the same number.
-- Cheap: customer_rows runs only for the phones that can be ending. A customer is ending only through a paid or active
-- order whose end E is today .. today + 2; such an order has start <= E <= today + 2 and E - start < days * 2 + 7 (the
-- kitchen bound, 0009), so today - start < days * 2 + 7. Every such phone is read with all its orders, so plan_ends
-- (a later renewal included) is exact. This is a prefilter, not a second definition: the rule is still is_ending.
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
      and v_today - o.start_date < o.days * 2 + 7
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

-- ---------- 6c. customer_detail ----------
-- The customer whose key is p_key: the phone the order with that id has now, with the staff note and who saved it
-- last (their staff name; null once they left the team). No row when no order has that id.
create or replace function public.customer_detail(p_key uuid)
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
  is_new boolean,
  has_account boolean,
  source text,
  note text,
  note_updated_at timestamptz,
  note_updated_by text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_owner boolean;
  v_phone text;
begin
  if not private.can_handle_orders() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  v_owner := private.is_owner();
  select o.phone into v_phone from public.orders o where o.id = p_key;
  if v_phone is null then
    return;
  end if;

  return query
    select
      r.customer_key,
      r.phone,
      r.customer_name,
      r.last_address,
      r.last_window,
      r.orders_count,
      r.paid_count,
      case when v_owner then r.total_paid end,
      r.first_order_at,
      r.last_order_at,
      r.plan_ends,
      r.last_plan_end,
      r.state,
      r.is_new,
      r.has_account,
      r.source,
      coalesce(n.note, ''),
      n.updated_at,
      nullif(btrim(s.name), '')
    from private.customer_rows(v_today, array[v_phone], null, null, null) r
    left join public.customer_notes n on n.phone = r.phone
    left join public.staff s on s.user_id = n.updated_by;
end;
$$;

revoke all on function public.customer_detail(uuid) from public, anon;
grant execute on function public.customer_detail(uuid) to authenticated;

-- ---------- 6d. customer_orders ----------
-- The orders of the customer whose key is p_key, newest first (at most 200): what the history list shows, with each
-- order's last delivery day (null for a cancelled one). No rows when no order has that id.
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
      case when o.status <> 'cancelled' then private.order_end_date(o.start_date, o.weekdays_only, o.days) end,
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

-- ---------- 6e. set_customer_note ----------
-- Saves the note of the customer whose key is p_key. p_expected_phone is the phone the page showed: when the key's
-- order now has another phone (staff edited it since the page loaded), the note would land on another person, so it
-- raises customer_changed (55000) and writes nothing. Errors: not_allowed (42501), not_found (P0002: no order has
-- that id), customer_changed (55000), too_long (22001: over 2000 characters). Blank space around the note is trimmed;
-- an empty note is saved as ''.
create or replace function public.set_customer_note(p_key uuid, p_expected_phone text, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not private.can_handle_orders() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select o.phone into v_phone from public.orders o where o.id = p_key;
  if v_phone is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_expected_phone is null or v_phone <> btrim(p_expected_phone) then
    raise exception 'customer_changed' using errcode = '55000';
  end if;
  if char_length(v_note) > 2000 then
    raise exception 'too_long' using errcode = '22001';
  end if;

  insert into public.customer_notes (phone, note)
  values (v_phone, v_note)
  on conflict (phone) do update set note = excluded.note;
end;
$$;

revoke all on function public.set_customer_note(uuid, text, text) from public, anon;
grant execute on function public.set_customer_note(uuid, text, text) to authenticated;
