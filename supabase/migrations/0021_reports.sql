-- Reports: the owner's sales figures for any period of Tashkent days (at most 366), one function per report, read by
-- the Reports screen, its Excel export and the overview's owner block.
-- Plan: docs/plans/zarkebab-feature-port.md, slice 5.
--
-- Additive only. No existing table, column, row, policy, trigger, function or grant is changed or dropped:
--   1. Two new partial indexes: orders_paid_basis_at on public.orders (the cash-basis day every report filters on) and
--      order_events_report_at on public.order_events (the staff report's period scan).
--   2. New private helpers, not callable by any client role (only the definer functions below, which check the owner
--      first):
--        order_by_staff(id, created_by)    whether an order was added in the back office, decided only from markers
--                                          the public cannot set: created_by (staff_create_order, 0018), or the
--                                          order's 'created' history row saying by = staff (written by the 0018
--                                          trigger from created_by, so it survives a removed account). Never from
--                                          orders.source, which carries the visitor's own utm_* and ref.
--        report_paid_orders(from, to)      the cash-basis orders of a period: status paid, active or completed, on the
--                                          Tashkent day of coalesce(paid_at, created_at), exactly as finance counts
--                                          revenue (0013, 0015). Cancelled orders are never revenue.
--        report_source_key(source, staff)  where an order came from: 'staff' only when order_by_staff says so; else
--                                          utm_source, else ref (lower case, at most 60 characters), else null
--                                          (direct). A visitor's own tag that reads "staff" (any case) becomes
--                                          'staff?', an ordinary source, so the public can never reach the staff line
--        report_overview_figures(from, to) the overview's figures for one period
--   3. New public functions, owner only (each raises not_owner, 42501, for anyone else, before anything else), all
--      taking p_from, p_to (Tashkent days, both included; bad_period, 22023, when either is null, the order is wrong
--      or the period is longer than 366 days), executable by authenticated. None returns a customer's name, phone or
--      address; phones are used inside to tell customers apart and never leave the function:
--        report_overview         { from, to, previous_from, previous_to, current, previous }: orders, revenue,
--                                avg_order, avg_days (average plan length), ration_days, customers, new_customers
--                                (first paid order ever inside the period), returning_customers (an earlier one),
--                                placed (orders created in the period, any status) and cancelled (of those, cancelled
--                                now), for the period and for the one of equal length right before it
--        report_programs         { orders, revenue, ration_days, rows: [{ program_id, program_name, kcal, orders,
--                                ration_days, revenue }] } per program and calorie level, largest revenue first
--        report_durations        { by_days: [{ days, orders, revenue }], by_schedule: [{ weekdays_only, orders,
--                                revenue }] } per plan length and per schedule (every day / weekdays only)
--        report_time             { orders, cells: [{ dow, hour, orders }] } the cash-basis orders of the period by the
--                                Tashkent weekday (ISO, 1 = Monday) and hour of created_at (when people order); only
--                                cells with orders
--        report_sources          { rows: [{ source, placed, converted, paid, revenue }], other } per source (null =
--                                direct, 'staff' = added in the back office): placed = orders created in the period,
--                                converted = of those, paid / active / completed now; paid and revenue = cash basis.
--                                Most paid first; past 199 sources the rest are summed into `other` ({ sources, placed,
--                                converted, paid, revenue }, null when there is no rest), so the totals always add up
--        report_payment_methods  { orders, revenue, rows: [{ method, orders, revenue }] } cash basis per payment method
--                                (null = not recorded: orders paid before 0018)
--        report_renewals         { ended, renewed, waiting, early, avg_gap_days }: customers (by phone) whose latest
--                                paid plan in the period ended in it; renewed = another paid order placed after that
--                                plan's order, at most 14 days after its last day; waiting = not renewed yet and the 14
--                                days are not over; early = renewed on or before the last day; avg_gap_days = days from
--                                the last day to the renewal order (0 when it came before), over the renewed
--        report_staff            { rows: [{ name, in_team, added, added_paid, moves, to_paid, to_cancelled }] } per
--                                team member, from the order history (0018): orders added by hand in the period (and
--                                how many of them are paid / active / completed now) and status moves made in it.
--                                Names only (the staff name now, else the name kept in the history for a removed
--                                member); moves without a signed-in member are not counted
--        report_orders           { page, pages, count, revenue, rows: [{ id, number, status, paid_day, paid_at,
--                                program_name, kcal, days, weekdays_only, start_date, total, payment_method, by_staff
--                                }] } the cash-basis orders of the period, newest payment first (then the highest
--                                number); p_page clamped to 1..pages, p_page_size 1..5000 (50 by default). For a
--                                consistent read across calls (the Excel export): p_as_of leaves out orders paid after
--                                that moment, and p_before_at with p_before_number (the last row of the previous call)
--                                returns the next p_page_size rows below it instead of a numbered page, so a payment
--                                or a cancellation during the export neither repeats nor skips a row
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0008, 0013, 0015, 0018, 0019 and 0020: the owner check is the first statement of each public function.

-- ---------- 1. indexes ----------
create index if not exists orders_paid_basis_at
  on public.orders ((coalesce(paid_at, created_at)))
  where status in ('paid', 'active', 'completed');

create index if not exists order_events_report_at
  on public.order_events (at)
  where kind in ('created', 'status');

-- ---------- 2a. order_by_staff ----------
create or replace function private.order_by_staff(p_id uuid, p_created_by uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_created_by is not null
    or exists (
      select 1
      from public.order_events e
      where e.order_id = p_id
        and e.kind = 'created'
        and e.detail ->> 'by' = 'staff'
    );
$$;

revoke all on function private.order_by_staff(uuid, uuid) from public, anon, authenticated;

-- ---------- 2b. report_paid_orders ----------
create or replace function private.report_paid_orders(p_from date, p_to date)
returns table (
  r_id uuid,
  r_number bigint,
  r_status text,
  r_paid_at timestamptz,
  r_paid_day date,
  r_created_at timestamptz,
  r_variant_id uuid,
  r_program_name text,
  r_kcal int,
  r_days int,
  r_weekdays_only boolean,
  r_start_date date,
  r_total int,
  r_payment_method text,
  r_source jsonb,
  r_phone text,
  r_by_staff boolean
)
language sql
stable
set search_path = ''
as $$
  select
    o.id,
    o.number,
    o.status,
    coalesce(o.paid_at, o.created_at),
    (coalesce(o.paid_at, o.created_at) at time zone 'Asia/Tashkent')::date,
    o.created_at,
    o.variant_id,
    o.program_name,
    o.kcal,
    o.days,
    o.weekdays_only,
    o.start_date,
    o.total,
    o.payment_method,
    o.source,
    o.phone,
    private.order_by_staff(o.id, o.created_by)
  from public.orders o
  where o.status in ('paid', 'active', 'completed')
    and coalesce(o.paid_at, o.created_at) >= (p_from::timestamp at time zone 'Asia/Tashkent')
    and coalesce(o.paid_at, o.created_at) < ((p_to + 1)::timestamp at time zone 'Asia/Tashkent');
$$;

revoke all on function private.report_paid_orders(date, date) from public, anon, authenticated;

-- ---------- 2c. report_source_key ----------
create or replace function private.report_source_key(p_source jsonb, p_by_staff boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_by_staff, false) then 'staff'
    else (
      select case when t.tag = 'staff' then 'staff?' else t.tag end
      from (
        select left(lower(coalesce(
          nullif(btrim(p_source ->> 'utm_source'), ''),
          nullif(btrim(p_source ->> 'ref'), '')
        )), 60) as tag
      ) t
    )
  end;
$$;

revoke all on function private.report_source_key(jsonb, boolean) from public, anon, authenticated;

-- ---------- 2d. report_overview_figures ----------
create or replace function private.report_overview_figures(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with paid as (
    select p.r_phone, p.r_total, p.r_days from private.report_paid_orders(p_from, p_to) p
  ),
  -- Each customer of the period: the Tashkent day of their first paid order ever (the same cash basis).
  firsts as (
    select o.phone as f_phone,
      min((coalesce(o.paid_at, o.created_at) at time zone 'Asia/Tashkent')::date) as f_day
    from public.orders o
    where o.status in ('paid', 'active', 'completed')
      and o.phone in (select distinct pd.r_phone from paid pd)
    group by o.phone
  ),
  placed as (
    select o.status as pl_status
    from public.orders o
    where o.created_at >= (p_from::timestamp at time zone 'Asia/Tashkent')
      and o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Tashkent')
  )
  select jsonb_build_object(
    'orders', (select count(*)::int from paid),
    'revenue', (select coalesce(sum(pd.r_total), 0)::bigint from paid pd),
    'avg_order', (select round(avg(pd.r_total))::bigint from paid pd),
    'avg_days', (select round(avg(pd.r_days)::numeric, 1) from paid pd),
    'ration_days', (select coalesce(sum(pd.r_days), 0)::bigint from paid pd),
    'customers', (select count(*)::int from firsts),
    'new_customers', (select count(*)::int from firsts f where f.f_day >= p_from),
    'returning_customers', (select count(*)::int from firsts f where f.f_day < p_from),
    'placed', (select count(*)::int from placed),
    'cancelled', (select count(*)::int from placed pl where pl.pl_status = 'cancelled')
  );
$$;

revoke all on function private.report_overview_figures(date, date) from public, anon, authenticated;

-- ---------- 3a. report_overview ----------
create or replace function public.report_overview(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_len int;
  v_prev_from date;
  v_prev_to date;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  v_len := p_to - p_from + 1;
  v_prev_to := p_from - 1;
  v_prev_from := p_from - v_len;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'previous_from', v_prev_from,
    'previous_to', v_prev_to,
    'current', private.report_overview_figures(p_from, p_to),
    'previous', private.report_overview_figures(v_prev_from, v_prev_to)
  );
end;
$$;

revoke all on function public.report_overview(date, date) from public, anon;
grant execute on function public.report_overview(date, date) to authenticated;

-- ---------- 3b. report_programs ----------
create or replace function public.report_programs(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  with paid as (
    select * from private.report_paid_orders(p_from, p_to)
  ),
  grp as (
    select
      v.program_id as g_program,
      pd.r_kcal as g_kcal,
      coalesce(max(pr.name), max(pd.r_program_name)) as g_name,
      count(*)::int as g_orders,
      sum(pd.r_days)::bigint as g_days,
      sum(pd.r_total)::bigint as g_revenue
    from paid pd
    left join public.program_variants v on v.id = pd.r_variant_id
    left join public.programs pr on pr.id = v.program_id
    group by v.program_id, pd.r_kcal
  )
  select jsonb_build_object(
    'orders', coalesce((select sum(g.g_orders) from grp g), 0)::int,
    'revenue', coalesce((select sum(g.g_revenue) from grp g), 0)::bigint,
    'ration_days', coalesce((select sum(g.g_days) from grp g), 0)::bigint,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'program_id', g.g_program,
        'program_name', g.g_name,
        'kcal', g.g_kcal,
        'orders', g.g_orders,
        'ration_days', g.g_days,
        'revenue', g.g_revenue
      ) order by g.g_revenue desc, g.g_orders desc, g.g_name, g.g_kcal)
      from grp g
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.report_programs(date, date) from public, anon;
grant execute on function public.report_programs(date, date) to authenticated;

-- ---------- 3c. report_durations ----------
create or replace function public.report_durations(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  with paid as (
    select pd.r_days, pd.r_weekdays_only, pd.r_total from private.report_paid_orders(p_from, p_to) pd
  )
  select jsonb_build_object(
    'by_days', coalesce((
      select jsonb_agg(jsonb_build_object('days', d.d_days, 'orders', d.d_orders, 'revenue', d.d_revenue)
        order by d.d_days)
      from (
        select pd.r_days as d_days, count(*)::int as d_orders, sum(pd.r_total)::bigint as d_revenue
        from paid pd
        group by pd.r_days
      ) d
    ), '[]'::jsonb),
    'by_schedule', coalesce((
      select jsonb_agg(jsonb_build_object('weekdays_only', s.s_weekdays, 'orders', s.s_orders, 'revenue', s.s_revenue)
        order by s.s_weekdays)
      from (
        select pd.r_weekdays_only as s_weekdays, count(*)::int as s_orders, sum(pd.r_total)::bigint as s_revenue
        from paid pd
        group by pd.r_weekdays_only
      ) s
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.report_durations(date, date) from public, anon;
grant execute on function public.report_durations(date, date) to authenticated;

-- ---------- 3d. report_time ----------
create or replace function public.report_time(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  with cells as (
    select
      extract(isodow from (pd.r_created_at at time zone 'Asia/Tashkent'))::int as c_dow,
      extract(hour from (pd.r_created_at at time zone 'Asia/Tashkent'))::int as c_hour,
      count(*)::int as c_orders
    from private.report_paid_orders(p_from, p_to) pd
    group by 1, 2
  )
  select jsonb_build_object(
    'orders', coalesce((select sum(c.c_orders) from cells c), 0)::int,
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object('dow', c.c_dow, 'hour', c.c_hour, 'orders', c.c_orders)
        order by c.c_dow, c.c_hour)
      from cells c
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.report_time(date, date) from public, anon;
grant execute on function public.report_time(date, date) to authenticated;

-- ---------- 3e. report_sources ----------
create or replace function public.report_sources(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  with tagged as (
    -- Placed in the period (any status), and whether it reached payment.
    select
      private.report_source_key(o.source, private.order_by_staff(o.id, o.created_by)) as t_key,
      1 as t_placed,
      (case when o.status in ('paid', 'active', 'completed') then 1 else 0 end) as t_converted,
      0 as t_paid,
      0::bigint as t_revenue
    from public.orders o
    where o.created_at >= (p_from::timestamp at time zone 'Asia/Tashkent')
      and o.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Tashkent')
    union all
    -- Paid in the period (cash basis).
    select private.report_source_key(pd.r_source, pd.r_by_staff), 0, 0, 1, pd.r_total::bigint
    from private.report_paid_orders(p_from, p_to) pd
  ),
  grp as (
    select
      t.t_key as g_key,
      sum(t.t_placed)::int as g_placed,
      sum(t.t_converted)::int as g_converted,
      sum(t.t_paid)::int as g_paid,
      sum(t.t_revenue)::bigint as g_revenue
    from tagged t
    group by t.t_key
  ),
  ranked as (
    select g.*, row_number() over (order by g.g_paid desc, g.g_placed desc, g.g_key nulls first) as g_rn
    from grp g
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', r.g_key,
        'placed', r.g_placed,
        'converted', r.g_converted,
        'paid', r.g_paid,
        'revenue', r.g_revenue
      ) order by r.g_rn)
      from ranked r
      where r.g_rn < 200
    ), '[]'::jsonb),
    -- Everything past the 199th source, summed, so the rows always add up to the period's totals.
    'other', (
      select case when count(*) = 0 then null else jsonb_build_object(
        'sources', count(*)::int,
        'placed', sum(r.g_placed)::int,
        'converted', sum(r.g_converted)::int,
        'paid', sum(r.g_paid)::int,
        'revenue', sum(r.g_revenue)::bigint
      ) end
      from ranked r
      where r.g_rn >= 200
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.report_sources(date, date) from public, anon;
grant execute on function public.report_sources(date, date) to authenticated;

-- ---------- 3f. report_payment_methods ----------
create or replace function public.report_payment_methods(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  with grp as (
    select pd.r_payment_method as g_method, count(*)::int as g_orders, sum(pd.r_total)::bigint as g_revenue
    from private.report_paid_orders(p_from, p_to) pd
    group by pd.r_payment_method
  )
  select jsonb_build_object(
    'orders', coalesce((select sum(g.g_orders) from grp g), 0)::int,
    'revenue', coalesce((select sum(g.g_revenue) from grp g), 0)::bigint,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('method', g.g_method, 'orders', g.g_orders, 'revenue', g.g_revenue)
        order by g.g_revenue desc, g.g_orders desc, g.g_method nulls last)
      from grp g
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.report_payment_methods(date, date) from public, anon;
grant execute on function public.report_payment_methods(date, date) to authenticated;

-- ---------- 3g. report_renewals ----------
-- A plan's last delivery day is private.order_end_date (0020). Only orders that can end inside the period are read:
-- an order ending on E >= p_from starts after E - (days * 2 + 7) (the kitchen bound of 0009), so after
-- p_from - (days * 2 + 7); one ending on E <= p_to starts on or before p_to.
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
      private.order_end_date(o.start_date, o.weekdays_only, o.days) as e_end
    from public.orders o
    where o.status in ('paid', 'active', 'completed')
      and o.start_date <= p_to
      and o.start_date >= p_from - (o.days * 2 + 7)
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

-- ---------- 3h. report_staff ----------
create or replace function public.report_staff(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from_at timestamptz;
  v_to_at timestamptz;
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  v_from_at := p_from::timestamp at time zone 'Asia/Tashkent';
  v_to_at := (p_to + 1)::timestamp at time zone 'Asia/Tashkent';

  with ev as (
    select
      -- A member by account; a removed account (actor set null) by the name the history kept.
      coalesce(e.actor::text, 'former:' || nullif(btrim(e.actor_name), '')) as x_key,
      e.actor as x_actor,
      nullif(btrim(e.actor_name), '') as x_name,
      e.at as x_at,
      e.kind as x_kind,
      e.to_status as x_to,
      (e.kind = 'created' and e.detail ->> 'by' = 'staff') as x_added,
      (o.status in ('paid', 'active', 'completed')) as x_paid_now
    from public.order_events e
    join public.orders o on o.id = e.order_id
    where e.at >= v_from_at
      and e.at < v_to_at
      and e.kind in ('created', 'status')
  ),
  grp as (
    select
      x.x_key as g_key,
      (array_agg(x.x_actor order by x.x_at desc) filter (where x.x_actor is not null))[1] as g_actor,
      (array_agg(x.x_name order by x.x_at desc) filter (where x.x_name is not null))[1] as g_name,
      (count(*) filter (where x.x_added))::int as g_added,
      (count(*) filter (where x.x_added and x.x_paid_now))::int as g_added_paid,
      (count(*) filter (where x.x_kind = 'status'))::int as g_moves,
      (count(*) filter (where x.x_kind = 'status' and x.x_to = 'paid'))::int as g_to_paid,
      (count(*) filter (where x.x_kind = 'status' and x.x_to = 'cancelled'))::int as g_to_cancelled
    from ev x
    where x.x_key is not null
    group by x.x_key
  ),
  named as (
    select
      coalesce(nullif(btrim(s.name), ''), g.g_name, '') as n_name,
      (s.user_id is not null) as n_in_team,
      g.*
    from grp g
    left join public.staff s on s.user_id = g.g_actor
    where g.g_added > 0 or g.g_moves > 0
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', n.n_name,
        'in_team', n.n_in_team,
        'added', n.g_added,
        'added_paid', n.g_added_paid,
        'moves', n.g_moves,
        'to_paid', n.g_to_paid,
        'to_cancelled', n.g_to_cancelled
      ) order by n.g_added + n.g_moves desc, n.n_name)
      from named n
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.report_staff(date, date) from public, anon;
grant execute on function public.report_staff(date, date) to authenticated;

-- ---------- 3i. report_orders ----------
create or replace function public.report_orders(
  p_from date,
  p_to date,
  p_page int default 1,
  p_page_size int default 50,
  p_as_of timestamptz default null,
  p_before_at timestamptz default null,
  p_before_number bigint default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size int := least(greatest(coalesce(p_page_size, 50), 1), 5000);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  if (p_before_at is null) <> (p_before_number is null) then
    raise exception 'bad_cursor' using errcode = '22023';
  end if;

  with paid as materialized (
    select * from private.report_paid_orders(p_from, p_to) pd
    where p_as_of is null or pd.r_paid_at <= p_as_of
  ),
  counted as (
    select count(*)::int as c_count, coalesce(sum(pd.r_total), 0)::bigint as c_revenue from paid pd
  ),
  paging as (
    select
      c.c_count,
      c.c_revenue,
      greatest(1, ceil(c.c_count::numeric / v_size)::int) as pg_pages
    from counted c
  ),
  numbered as (
    select pd.*, row_number() over (order by pd.r_paid_at desc, pd.r_number desc) as rn
    from paid pd
    where p_before_at is null or (pd.r_paid_at, pd.r_number) < (p_before_at, p_before_number)
  )
  select jsonb_build_object(
    'page', least(v_page, pg.pg_pages),
    'pages', pg.pg_pages,
    'count', pg.c_count,
    'revenue', pg.c_revenue,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.r_id,
        'number', n.r_number,
        'status', n.r_status,
        'paid_day', n.r_paid_day,
        'paid_at', n.r_paid_at,
        'program_name', n.r_program_name,
        'kcal', n.r_kcal,
        'days', n.r_days,
        'weekdays_only', n.r_weekdays_only,
        'start_date', n.r_start_date,
        'total', n.r_total,
        'payment_method', n.r_payment_method,
        'by_staff', n.r_by_staff
      ) order by n.rn)
      from numbered n
      where case
        -- After a cursor: the next rows below it.
        when p_before_at is not null then n.rn <= v_size
        else n.rn > (least(v_page, pg.pg_pages) - 1) * v_size and n.rn <= least(v_page, pg.pg_pages) * v_size
      end
    ), '[]'::jsonb)
  )
  into v_result
  from paging pg;

  return v_result;
end;
$$;

revoke all on function public.report_orders(date, date, int, int, timestamptz, timestamptz, bigint) from public, anon;
grant execute on function public.report_orders(date, date, int, int, timestamptz, timestamptz, bigint) to authenticated;
