-- Finance ledger: every expense and every income that is not an order (investor money first of all), the day an
-- order was paid, and the three owner-only report functions the Finance screens read.
-- Plan: docs/plans/finance-investor-payroll.md, slice 1.
--
-- Additive only. No existing row, policy, grant or function is changed or dropped:
--   1. public.orders gets a new nullable column paid_at and a new before-update trigger that stamps it when an
--      order moves to 'paid'. No backfill: existing rows keep null and the reports fall back to created_at (filling
--      them in would be an UPDATE of existing rows, plan open question 3).
--   2. New table public.finance_entries with RLS and owner-only select / insert / delete policies. No update: a
--      wrong row is deleted and entered again.
--   3. New functions public.finance_monthly_cashflow, public.finance_totals and public.finance_period: owner only
--      (each raises not_owner, 42501, for anyone else), executable by authenticated.
--
-- Rules every report follows:
--   * Revenue is orders.total of orders in status paid, active or completed, on the Tashkent day of
--     coalesce(paid_at, created_at). Cancelled orders (also those cancelled after payment) are not revenue.
--   * Investor money (finance_entries income / investor_support) is reported on its own and is never income.
--   * Salaries are 0 until the payroll migration (slice 3) replaces these functions; one-off salary entries
--     (expense / salary_one_time) are already part of expenses.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended
-- here, as in 0008: the owner check is the first statement of each function.

-- ---------- 1. orders.paid_at ----------
alter table public.orders add column paid_at timestamptz;

-- Stamped once, the first time an order becomes 'paid'. The status trigger of 0004 (private.check_order_status,
-- trigger orders_check_status) runs first (same event, triggers fire in name order) and rejects a wrong step, so
-- only a real confirmed → paid move reaches this. paid_at is not in the owner's update grant (0004: status and
-- staff_note only), so it is never written from the client; column grants do not apply to values a trigger sets.
create or replace function private.stamp_order_paid_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_order_paid_at() from public;

create trigger orders_stamp_paid_at
  before update of status on public.orders
  for each row execute function private.stamp_order_paid_at();

-- ---------- 2. finance_entries ----------
-- Amounts are whole UZS. The category list per type is the same as src/lib/admin/finance/categories.ts; keep them in
-- step. counterparty is who was paid or who paid (for investor money: the investor's name, totalled per name).
create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('expense', 'income')),
  entry_date date not null,
  category text not null,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'transfer')),
  amount bigint not null check (amount > 0 and amount <= 100000000000),
  counterparty text check (char_length(counterparty) <= 120),
  note text check (char_length(note) <= 500),
  -- Nullable with "set null": the ledger outlives the account that wrote a row.
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_entries_category_check check (
    (entry_type = 'expense' and category in ('ingredients', 'packaging', 'delivery', 'rent', 'utilities',
      'marketing', 'equipment', 'repair', 'tax', 'payment_fees', 'software', 'salary_one_time', 'investment', 'other'))
    or (entry_type = 'income' and category in ('investor_support', 'other_income'))
  ),
  constraint finance_entries_date_check check (entry_date >= date '2024-01-01')
);

create index finance_entries_date_idx on public.finance_entries (entry_date desc, created_at desc);
-- The foreign key's column, so removing an account never scans the whole ledger.
create index finance_entries_created_by_idx on public.finance_entries (created_by);

alter table public.finance_entries enable row level security;

-- The owner reads, adds and deletes; nobody updates. Insert is granted on the entry's own columns only: id,
-- created_by and created_at always come from their defaults (created_by = the signed-in user).
revoke all on table public.finance_entries from anon, authenticated;
grant select, delete on table public.finance_entries to authenticated;
grant insert (entry_type, entry_date, category, payment_method, amount, counterparty, note)
  on table public.finance_entries to authenticated;

create policy "owner reads finance entries" on public.finance_entries
  for select to authenticated
  using ((select private.is_owner()));

-- No entry dated after today in Tashkent. created_by is checked too, although it cannot be sent (no column grant).
create policy "owner adds finance entries" on public.finance_entries
  for insert to authenticated
  with check (
    (select private.is_owner())
    and created_by = (select auth.uid())
    and entry_date <= (now() at time zone 'Asia/Tashkent')::date
  );

create policy "owner deletes finance entries" on public.finance_entries
  for delete to authenticated
  using ((select private.is_owner()));

-- ---------- 3a. finance_monthly_cashflow ----------
-- One row per Tashkent calendar month for the last p_months months (1..36, the current month included), oldest
-- first. Months with nothing in them are rows of zeros.
create or replace function public.finance_monthly_cashflow(p_months int default 12)
returns table (
  month_start date,
  revenue bigint,
  order_count int,
  investor_support bigint,
  other_income bigint,
  expenses bigint,
  salaries bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_months int := least(greatest(coalesce(p_months, 12), 1), 36);
  v_current date := date_trunc('month', now() at time zone 'Asia/Tashkent')::date;
  v_first date;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  v_first := (v_current - make_interval(months => v_months - 1))::date;

  return query
    with m as (
      select gs::date as m_start
      from generate_series(v_first, v_current, interval '1 month') gs
    ),
    r as (
      select
        date_trunc('month', coalesce(o.paid_at, o.created_at) at time zone 'Asia/Tashkent')::date as r_month,
        sum(o.total)::bigint as r_revenue,
        count(*)::int as r_orders
      from public.orders o
      where o.status in ('paid', 'active', 'completed')
        and coalesce(o.paid_at, o.created_at) >= (v_first::timestamp at time zone 'Asia/Tashkent')
      group by 1
    ),
    e as (
      select
        date_trunc('month', f.entry_date)::date as e_month,
        sum(f.amount) filter (where f.entry_type = 'income' and f.category = 'investor_support')::bigint as e_investor,
        sum(f.amount) filter (where f.entry_type = 'income' and f.category = 'other_income')::bigint as e_other,
        sum(f.amount) filter (where f.entry_type = 'expense')::bigint as e_expenses
      from public.finance_entries f
      where f.entry_date >= v_first
      group by 1
    )
    select
      m.m_start,
      coalesce(r.r_revenue, 0)::bigint,
      coalesce(r.r_orders, 0)::int,
      coalesce(e.e_investor, 0)::bigint,
      coalesce(e.e_other, 0)::bigint,
      coalesce(e.e_expenses, 0)::bigint,
      0::bigint
    from m
    left join r on r.r_month = m.m_start
    left join e on e.e_month = m.m_start
    order by m.m_start;
end;
$$;

revoke all on function public.finance_monthly_cashflow(int) from public, anon;
grant execute on function public.finance_monthly_cashflow(int) to authenticated;

-- ---------- 3b. finance_totals ----------
-- All-time sums, for the investor view (payback): one row. first_order_day is the Tashkent day of the first paid
-- order, first_investment_day the date of the first investor money; null when there is none yet.
create or replace function public.finance_totals()
returns table (
  investor_support bigint,
  revenue bigint,
  other_income bigint,
  expenses bigint,
  salaries bigint,
  first_order_day date,
  first_investment_day date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  return query
    with r as (
      select
        coalesce(sum(o.total), 0)::bigint as r_revenue,
        min((coalesce(o.paid_at, o.created_at) at time zone 'Asia/Tashkent')::date) as r_first
      from public.orders o
      where o.status in ('paid', 'active', 'completed')
    ),
    e as (
      select
        coalesce(sum(f.amount) filter (where f.entry_type = 'income' and f.category = 'investor_support'), 0)::bigint
          as e_investor,
        coalesce(sum(f.amount) filter (where f.entry_type = 'income' and f.category = 'other_income'), 0)::bigint
          as e_other,
        coalesce(sum(f.amount) filter (where f.entry_type = 'expense'), 0)::bigint as e_expenses,
        min(f.entry_date) filter (where f.entry_type = 'income' and f.category = 'investor_support') as e_first
      from public.finance_entries f
    )
    select e.e_investor, r.r_revenue, e.e_other, e.e_expenses, 0::bigint, r.r_first, e.e_first
    from r cross join e;
end;
$$;

revoke all on function public.finance_totals() from public, anon;
grant execute on function public.finance_totals() to authenticated;

-- ---------- 3c. finance_period ----------
-- Everything the Month screen shows for a range of Tashkent days, both ends included, at most 366 days:
--   { revenue, order_count,
--     by_day: [{ day, revenue, spent }]            every day of the range, oldest first,
--     expense_by_category: { category: amount },   income_by_category: { category: amount },
--     investors: [{ name, amount }]                investor money per name ('' when none was given), largest first,
--     largest: [entry]                             the 10 largest expense entries }
-- Amounts are whole UZS as JSON numbers (exact up to 2^53, far above any real figure here).
create or replace function public.finance_period(p_from date, p_to date)
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

  with paid as (
    select (coalesce(o.paid_at, o.created_at) at time zone 'Asia/Tashkent')::date as p_day, o.total as p_total
    from public.orders o
    where o.status in ('paid', 'active', 'completed')
      and coalesce(o.paid_at, o.created_at) >= v_from_at
      and coalesce(o.paid_at, o.created_at) < v_to_at
  ),
  ent as (
    select f.id, f.entry_type, f.entry_date, f.category, f.payment_method, f.amount, f.counterparty, f.note
    from public.finance_entries f
    where f.entry_date between p_from and p_to
  ),
  days as (
    select gs::date as d_day from generate_series(p_from, p_to, interval '1 day') gs
  ),
  rev_day as (
    select p.p_day, sum(p.p_total)::bigint as rd_revenue from paid p group by p.p_day
  ),
  spent_day as (
    select x.entry_date as s_day, sum(x.amount)::bigint as sd_spent
    from ent x where x.entry_type = 'expense' group by x.entry_date
  )
  select jsonb_build_object(
    'revenue', (select coalesce(sum(p.p_total), 0)::bigint from paid p),
    'order_count', (select count(*)::int from paid p),
    'by_day', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object('day', d.d_day, 'revenue', coalesce(rd.rd_revenue, 0), 'spent', coalesce(sd.sd_spent, 0))
          order by d.d_day
        ),
        '[]'::jsonb
      )
      from days d
      left join rev_day rd on rd.p_day = d.d_day
      left join spent_day sd on sd.s_day = d.d_day
    ),
    'expense_by_category', (
      select coalesce(jsonb_object_agg(c.category, c.amount), '{}'::jsonb)
      from (
        select x.category, sum(x.amount)::bigint as amount from ent x where x.entry_type = 'expense' group by x.category
      ) c
    ),
    'income_by_category', (
      select coalesce(jsonb_object_agg(c.category, c.amount), '{}'::jsonb)
      from (
        select x.category, sum(x.amount)::bigint as amount from ent x where x.entry_type = 'income' group by x.category
      ) c
    ),
    'investors', (
      select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'amount', i.amount) order by i.amount desc, i.name), '[]'::jsonb)
      from (
        select coalesce(btrim(x.counterparty), '') as name, sum(x.amount)::bigint as amount
        from ent x
        where x.entry_type = 'income' and x.category = 'investor_support'
        group by 1
      ) i
    ),
    'largest', (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.amount desc, l.entry_date desc, l.id), '[]'::jsonb)
      from (
        select x.id, x.entry_date, x.category, x.payment_method, x.amount, x.counterparty, x.note
        from ent x
        where x.entry_type = 'expense'
        order by x.amount desc, x.entry_date desc, x.id
        limit 10
      ) l
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.finance_period(date, date) from public, anon;
grant execute on function public.finance_period(date, date) to authenticated;
