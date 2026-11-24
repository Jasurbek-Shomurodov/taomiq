-- Payroll: the people the business pays, their daily or monthly rates by the day they start, and every payment,
-- bonus, fine and absence. Salary payments become part of spending in the three finance report functions of 0013, and
-- a new owner-only finance_payroll function says what each person has earned and is owed on a day.
-- Plan: docs/plans/finance-investor-payroll.md, slice 3.
--
-- Additive only. No existing row, table, policy or grant is changed or dropped:
--   1. New tables public.finance_employees, public.finance_salary_rates and public.finance_salary_events, RLS on,
--      owner-only policies. Employees are never deleted (they are ended); rates and events are deleted and entered
--      again, never updated. A new trigger refuses undoing a leaving more than 7 days old.
--   2. New function public.finance_add_employee (security invoker: the caller's grants and policies apply), so a person
--      and their first rate are written together or not at all.
--   3. New private.finance_salary_days: the pay of every employee on every day of a range. The one place the accrual
--      rule lives; finance_payroll reads it.
--   4. public.finance_monthly_cashflow, public.finance_totals and public.finance_period are replaced (create or
--      replace, same arguments, same return types) so salary payments count as salaries and as spending.
--   5. New function public.finance_payroll(p_as_of): owner only (raises not_owner, 42501, for anyone else).
--
-- The accrual rule (zarkebab expenses.js):
--   * The rate on a day is the employee's rate with the latest effective_from on or before that day.
--   * A daily rate pays its amount each day. A monthly rate m in a month of n days pays floor(m / n) each day and one
--     sum more on days 1 .. (m mod n), so a whole month adds up to exactly m.
--   * Nothing is earned before joined_at, after ended_at, on a day recorded as an absence, or before the first rate.
--   * balance = earned (joined_at .. the day) + bonuses − fines − payments, events dated up to the day. Above 0 is
--     owed to the person; below 0 is an advance.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended
-- here, as in 0008 and 0013: the owner check is the first statement of each function.

-- ---------- 1a. finance_employees ----------
-- A person on the payroll. ended_at is the last day worked; is_active is false from the moment an end is recorded.
-- staff_user_id links a back-office account later; nothing in this slice writes it.
create table public.finance_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  job_title text check (char_length(job_title) <= 80),
  joined_at date not null check (joined_at >= date '2024-01-01'),
  ended_at date,
  is_active boolean not null default true,
  staff_user_id uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_employees_end_check check (ended_at is null or ended_at >= joined_at),
  constraint finance_employees_active_check check (is_active = (ended_at is null))
);

create index finance_employees_created_by_idx on public.finance_employees (created_by);
create index finance_employees_staff_user_idx on public.finance_employees (staff_user_id);

alter table public.finance_employees enable row level security;

-- The owner reads, adds and ends (or un-ends) a person; nobody deletes one, so their payments never lose their owner.
revoke all on table public.finance_employees from anon, authenticated;
grant select on table public.finance_employees to authenticated;
grant insert (name, job_title, joined_at) on table public.finance_employees to authenticated;
grant update (ended_at, is_active) on table public.finance_employees to authenticated;

create policy "owner reads employees" on public.finance_employees
  for select to authenticated
  using ((select private.is_owner()));

-- No start after today in Tashkent.
create policy "owner adds employees" on public.finance_employees
  for insert to authenticated
  with check (
    (select private.is_owner())
    and created_by = (select auth.uid())
    and joined_at <= (now() at time zone 'Asia/Tashkent')::date
  );

create policy "owner ends employees" on public.finance_employees
  for update to authenticated
  using ((select private.is_owner()))
  with check (
    (select private.is_owner())
    and (ended_at is null or ended_at <= (now() at time zone 'Asia/Tashkent')::date)
  );

-- Undoing a recorded leaving is for fixing a mistake only: within 7 days of the last working day (Tashkent). Later,
-- clearing ended_at (or moving it later) would pay every day of the gap, so it is refused; a person who comes back
-- after a break is added again as a new employee. Moving the end earlier, and ending someone, are always allowed.
-- Runs for every update, the table owner's too.
create or replace function private.check_employee_resume()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.ended_at is not null
    and old.ended_at < (now() at time zone 'Asia/Tashkent')::date - 7
    and (new.ended_at is null or new.ended_at > old.ended_at) then
    raise exception 'resume_too_late' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_employee_resume() from public;

create trigger finance_employees_check_resume
  before update of ended_at on public.finance_employees
  for each row execute function private.check_employee_resume();

-- ---------- 1b. finance_salary_rates ----------
-- What a person earns from a day on: per day or per month. A raise is a new row with its own effective_from; a rate
-- may start in the future (a raise agreed for next month).
create table public.finance_salary_rates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.finance_employees (id) on delete cascade,
  effective_from date not null check (effective_from >= date '2024-01-01'),
  amount bigint not null check (amount > 0 and amount <= 100000000000),
  rate_unit text not null check (rate_unit in ('daily', 'monthly')),
  note text check (char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_salary_rates_day_key unique (employee_id, effective_from)
);

create index finance_salary_rates_created_by_idx on public.finance_salary_rates (created_by);

alter table public.finance_salary_rates enable row level security;

revoke all on table public.finance_salary_rates from anon, authenticated;
grant select, delete on table public.finance_salary_rates to authenticated;
grant insert (employee_id, effective_from, amount, rate_unit, note) on table public.finance_salary_rates to authenticated;

create policy "owner reads salary rates" on public.finance_salary_rates
  for select to authenticated
  using ((select private.is_owner()));

create policy "owner adds salary rates" on public.finance_salary_rates
  for insert to authenticated
  with check ((select private.is_owner()) and created_by = (select auth.uid()));

create policy "owner deletes salary rates" on public.finance_salary_rates
  for delete to authenticated
  using ((select private.is_owner()));

-- ---------- 1c. finance_salary_events ----------
-- payment: money handed over (a payment method, part of spending on its day); bonus: added to what is owed; fine:
-- taken off it (always with a reason); absence: a day without pay (no amount, at most one per person and day).
-- Employees are never deleted, and "restrict" keeps it that way for any row with money attached.
create table public.finance_salary_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.finance_employees (id) on delete restrict,
  kind text not null check (kind in ('payment', 'bonus', 'fine', 'absence')),
  event_date date not null check (event_date >= date '2024-01-01'),
  amount bigint,
  payment_method text check (payment_method in ('cash', 'card', 'transfer')),
  note text check (char_length(note) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_salary_events_amount_kind_check check (
    (kind = 'absence' and amount is null)
    or (kind <> 'absence' and amount is not null and amount > 0 and amount <= 100000000000)
  ),
  constraint finance_salary_events_method_kind_check check ((kind = 'payment') = (payment_method is not null)),
  constraint finance_salary_events_fine_note_check check (kind <> 'fine' or char_length(btrim(coalesce(note, ''))) > 0)
);

create index finance_salary_events_employee_idx on public.finance_salary_events (employee_id, event_date desc);
-- Payments by day, for the month and year reports.
create index finance_salary_events_date_idx on public.finance_salary_events (event_date) where kind = 'payment';
create unique index finance_salary_events_absence_key
  on public.finance_salary_events (employee_id, event_date) where kind = 'absence';
create index finance_salary_events_created_by_idx on public.finance_salary_events (created_by);

alter table public.finance_salary_events enable row level security;

revoke all on table public.finance_salary_events from anon, authenticated;
grant select, delete on table public.finance_salary_events to authenticated;
grant insert (employee_id, kind, event_date, amount, payment_method, note)
  on table public.finance_salary_events to authenticated;

create policy "owner reads salary events" on public.finance_salary_events
  for select to authenticated
  using ((select private.is_owner()));

-- No event dated after today in Tashkent.
create policy "owner adds salary events" on public.finance_salary_events
  for insert to authenticated
  with check (
    (select private.is_owner())
    and created_by = (select auth.uid())
    and event_date <= (now() at time zone 'Asia/Tashkent')::date
  );

create policy "owner deletes salary events" on public.finance_salary_events
  for delete to authenticated
  using ((select private.is_owner()));

-- ---------- 2. finance_add_employee ----------
-- A person and their first rate (starting on their first day) in one transaction. Security invoker: the inserts run
-- as the caller, so the grants and policies above decide, exactly as two separate inserts would. Returns the id.
create or replace function public.finance_add_employee(
  p_name text,
  p_job_title text,
  p_joined_at date,
  p_rate_amount bigint,
  p_rate_unit text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  insert into public.finance_employees (name, job_title, joined_at)
  values (btrim(p_name), nullif(btrim(coalesce(p_job_title, '')), ''), p_joined_at)
  returning id into v_id;

  insert into public.finance_salary_rates (employee_id, effective_from, amount, rate_unit)
  values (v_id, p_joined_at, p_rate_amount, p_rate_unit);

  return v_id;
end;
$$;

revoke all on function public.finance_add_employee(text, text, date, bigint, text) from public, anon;
grant execute on function public.finance_add_employee(text, text, date, bigint, text) to authenticated;

-- ---------- 3. private.finance_salary_days ----------
-- The pay of each employee on each day from p_from to p_to (both included) that falls inside their employment:
-- one row per employee and day, 0 on an absence or before their first rate. Not callable by clients; the public
-- functions call it after their own owner check (as security definer, so RLS does not hide the rows here).
create or replace function private.finance_salary_days(p_from date, p_to date)
returns table (s_employee_id uuid, s_day date, s_pay bigint)
language sql
stable
set search_path = ''
as $$
  select
    d.d_employee_id,
    d.d_day,
    (case
      when a.id is not null or rt.amount is null then 0
      when rt.rate_unit = 'daily' then rt.amount
      -- Monthly: floor(m / n) a day, one more on days 1 .. m mod n.
      else rt.amount / d.d_days_in_month
        + case when extract(day from d.d_day)::int <= rt.amount % d.d_days_in_month then 1 else 0 end
    end)::bigint
  from (
    select
      e.id as d_employee_id,
      gs::date as d_day,
      extract(day from date_trunc('month', gs) + interval '1 month - 1 day')::int as d_days_in_month
    from public.finance_employees e
    cross join lateral generate_series(
      greatest(p_from, e.joined_at)::timestamp,
      least(p_to, coalesce(e.ended_at, p_to))::timestamp,
      interval '1 day'
    ) gs
  ) d
  left join lateral (
    select r.amount, r.rate_unit
    from public.finance_salary_rates r
    where r.employee_id = d.d_employee_id and r.effective_from <= d.d_day
    order by r.effective_from desc
    limit 1
  ) rt on true
  left join public.finance_salary_events a
    on a.employee_id = d.d_employee_id and a.event_date = d.d_day and a.kind = 'absence';
$$;

revoke all on function private.finance_salary_days(date, date) from public;

-- ---------- 4a. finance_monthly_cashflow (replaced) ----------
-- As in 0013; salaries is now the salary payments of the month (payroll events of kind 'payment', by event_date).
-- One-off salary entries (expense / salary_one_time) stay inside expenses, as before.
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
    ),
    s as (
      select date_trunc('month', p.event_date)::date as s_month, sum(p.amount)::bigint as s_paid
      from public.finance_salary_events p
      where p.kind = 'payment' and p.event_date >= v_first
      group by 1
    )
    select
      m.m_start,
      coalesce(r.r_revenue, 0)::bigint,
      coalesce(r.r_orders, 0)::int,
      coalesce(e.e_investor, 0)::bigint,
      coalesce(e.e_other, 0)::bigint,
      coalesce(e.e_expenses, 0)::bigint,
      coalesce(s.s_paid, 0)::bigint
    from m
    left join r on r.r_month = m.m_start
    left join e on e.e_month = m.m_start
    left join s on s.s_month = m.m_start
    order by m.m_start;
end;
$$;

revoke all on function public.finance_monthly_cashflow(int) from public, anon;
grant execute on function public.finance_monthly_cashflow(int) to authenticated;

-- ---------- 4b. finance_totals (replaced) ----------
-- As in 0013; salaries is now every salary payment ever recorded.
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
    ),
    s as (
      select coalesce(sum(p.amount), 0)::bigint as s_paid
      from public.finance_salary_events p
      where p.kind = 'payment'
    )
    select e.e_investor, r.r_revenue, e.e_other, e.e_expenses, s.s_paid, r.r_first, e.e_first
    from r cross join e cross join s;
end;
$$;

revoke all on function public.finance_totals() from public, anon;
grant execute on function public.finance_totals() to authenticated;

-- ---------- 4c. finance_period (replaced) ----------
-- As in 0013, plus salary payments: a new 'salaries' figure (their sum over the range) and each day's 'spent' now
-- holds that day's salary payments too. expense_by_category and largest stay ledger entries only.
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
  sal as (
    select p.event_date as sl_day, p.amount as sl_amount
    from public.finance_salary_events p
    where p.kind = 'payment' and p.event_date between p_from and p_to
  ),
  days as (
    select gs::date as d_day from generate_series(p_from, p_to, interval '1 day') gs
  ),
  rev_day as (
    select p.p_day, sum(p.p_total)::bigint as rd_revenue from paid p group by p.p_day
  ),
  spent_day as (
    select u.s_day, sum(u.s_amount)::bigint as sd_spent
    from (
      select x.entry_date as s_day, x.amount as s_amount from ent x where x.entry_type = 'expense'
      union all
      select y.sl_day, y.sl_amount from sal y
    ) u
    group by u.s_day
  )
  select jsonb_build_object(
    'revenue', (select coalesce(sum(p.p_total), 0)::bigint from paid p),
    'order_count', (select count(*)::int from paid p),
    'salaries', (select coalesce(sum(y.sl_amount), 0)::bigint from sal y),
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

-- ---------- 5. finance_payroll ----------
-- Every employee (active first, then by name) as of p_as_of (a Tashkent day; today when null):
--   rate_amount, rate_unit, rate_from   the rate in force on p_as_of (null when none has started yet)
--   first_rate_from                     the start of the earliest rate (null without any); after joined_at, the days
--                                       before it earn nothing
--   accrued                             pay earned from joined_at to p_as_of (absences and days before the first rate
--                                       earn nothing; nothing after ended_at)
--   bonuses, fines, paid                events dated up to p_as_of
--   balance                             accrued + bonuses − fines − paid; below 0 is an advance
--   month_pay                           the pay of the whole calendar month of p_as_of, every day of it, by the rates
--                                       and absences recorded (the month's salary commitment)
--   paid_month                          payments from the 1st of that month to p_as_of
create or replace function public.finance_payroll(p_as_of date default null)
returns table (
  employee_id uuid,
  name text,
  job_title text,
  joined_at date,
  ended_at date,
  is_active boolean,
  rate_amount bigint,
  rate_unit text,
  rate_from date,
  first_rate_from date,
  accrued bigint,
  bonuses bigint,
  fines bigint,
  paid bigint,
  balance bigint,
  month_pay bigint,
  paid_month bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_as_of date := coalesce(p_as_of, (now() at time zone 'Asia/Tashkent')::date);
  v_month date;
  v_month_end date;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if v_as_of < date '2024-01-01' or v_as_of > date '2100-01-01' then
    raise exception 'bad_date' using errcode = '22023';
  end if;

  v_month := date_trunc('month', v_as_of)::date;
  v_month_end := (date_trunc('month', v_as_of) + interval '1 month - 1 day')::date;

  return query
    with acc as (
      select s.s_employee_id as a_id, sum(s.s_pay)::bigint as a_pay
      from private.finance_salary_days(date '2024-01-01', v_as_of) s
      group by 1
    ),
    mon as (
      select s.s_employee_id as m_id, sum(s.s_pay)::bigint as m_pay
      from private.finance_salary_days(v_month, v_month_end) s
      group by 1
    ),
    ev as (
      select
        x.employee_id as v_id,
        coalesce(sum(x.amount) filter (where x.kind = 'bonus'), 0)::bigint as v_bonuses,
        coalesce(sum(x.amount) filter (where x.kind = 'fine'), 0)::bigint as v_fines,
        coalesce(sum(x.amount) filter (where x.kind = 'payment'), 0)::bigint as v_paid,
        coalesce(sum(x.amount) filter (where x.kind = 'payment' and x.event_date >= v_month), 0)::bigint as v_paid_month
      from public.finance_salary_events x
      where x.event_date <= v_as_of
      group by 1
    )
    select
      e.id,
      e.name,
      e.job_title,
      e.joined_at,
      e.ended_at,
      e.is_active,
      rt.amount,
      rt.rate_unit,
      rt.effective_from,
      (select min(f.effective_from) from public.finance_salary_rates f where f.employee_id = e.id),
      coalesce(acc.a_pay, 0)::bigint,
      coalesce(ev.v_bonuses, 0)::bigint,
      coalesce(ev.v_fines, 0)::bigint,
      coalesce(ev.v_paid, 0)::bigint,
      (coalesce(acc.a_pay, 0) + coalesce(ev.v_bonuses, 0) - coalesce(ev.v_fines, 0) - coalesce(ev.v_paid, 0))::bigint,
      coalesce(mon.m_pay, 0)::bigint,
      coalesce(ev.v_paid_month, 0)::bigint
    from public.finance_employees e
    left join lateral (
      select r.amount, r.rate_unit, r.effective_from
      from public.finance_salary_rates r
      where r.employee_id = e.id and r.effective_from <= v_as_of
      order by r.effective_from desc
      limit 1
    ) rt on true
    left join acc on acc.a_id = e.id
    left join mon on mon.m_id = e.id
    left join ev on ev.v_id = e.id
    order by e.is_active desc, e.name, e.id;
end;
$$;

revoke all on function public.finance_payroll(date) from public, anon;
grant execute on function public.finance_payroll(date) to authenticated;
