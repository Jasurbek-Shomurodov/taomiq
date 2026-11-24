-- Month close: a finished month is frozen into an official result (the salary its people earned counted in it, not the
-- salary paid in it), months close one after another, and once closed nothing dated in them can be added or deleted
-- until the latest closed month is opened again with a reason. Plus three finance settings for the Month estimate.
-- Plan: docs/plans/finance-investor-payroll.md, slice 4.
--
-- Additive only. No existing row, column, policy or grant is changed or dropped:
--   1. New tables public.finance_month_closes (one frozen row per closed month) and public.finance_close_log (every
--      close and reopen, append-only). RLS on, the owner may read; no client writes at all: only the functions below
--      write them. Triggers keep a close row frozen (it is deleted only by reopening the latest month) and the log
--      append-only (a removed account only clears the actor).
--   2. New private helpers: finance_month_figures (the figures of a month, the one place the close rule lives),
--      finance_first_month, finance_next_to_close, finance_locked_through.
--   3. New functions public.close_finance_month, public.reopen_finance_month and public.finance_close_overview: owner
--      only (each raises not_owner, 42501, for anyone else), executable by authenticated.
--   4. New guard triggers on public.finance_entries, public.finance_salary_events, public.finance_salary_rates and
--      public.finance_employees: nothing that changes a closed month's figures can be written (raises month_closed).
--   5. public.settings gets a new restrictive select policy (finance_* rows are readable by the owner only; every
--      other row reads exactly as before) and a new trigger that checks the values of the three finance_* keys. No
--      settings row is written here.
--
-- The close rule, for a calendar month M (Tashkent days):
--   revenue        orders.total of orders in status paid, active or completed, on the Tashkent day of
--                  coalesce(paid_at, created_at), inside M (as finance_monthly_cashflow counts it)
--   other_income   ledger income / other_income dated in M
--   expenses       ledger expenses dated in M (one-off salary entries included; salary payments NOT included)
--   salary_earned  per employee: pay accrued on the days of M (private.finance_salary_days) + bonuses − fines dated in
--                  M; the per-employee figures are kept in salary_breakdown
--   result         revenue + other_income − expenses − salary_earned
--   investor money is frozen too, for reference, and is never part of the result.
--
-- Closing order: only a month that has fully ended in Tashkent; the first month to close is the first month with any
-- activity (a paid order, a ledger entry, a payroll event or an employee's first day), and after that always the month
-- after the latest closed one, so closed months never have a gap. Reopening is for the latest closed month only, with
-- a reason of at least 10 characters.
--
-- What the lock covers: every day up to the last day of the latest closed month. Because closes have no gaps, that is
-- exactly the closed months plus the empty months before the first activity, so nothing can be back-dated into a
-- hole either. Ledger entries and payroll events dated there cannot be added or deleted; a salary rate starting there
-- cannot be added or deleted; an employee whose first day is there cannot be added; a leaving cannot be recorded,
-- moved or undone when it changes paid days there.
--
-- Not locked: orders. Their revenue of a closed month can still change, for example when an old order is cancelled.
-- Orders get no trigger here (the order flow stays as it is); instead finance_close_overview recomputes every closed
-- month and returns the difference (drift = live result − frozen result), and the Month close screen shows it.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0008, 0013 and 0014: the owner check is the first statement of each public function.

-- ---------- 1a. finance_month_closes ----------
create table public.finance_month_closes (
  id uuid primary key default gen_random_uuid(),
  month_start date not null unique,
  revenue bigint not null,
  order_count int not null,
  other_income bigint not null,
  investor_support bigint not null,
  expenses bigint not null,
  salary_earned bigint not null,
  -- [{ employee_id, name, days, accrued, bonuses, fines, earned }], by name: the people as they were at closing.
  salary_breakdown jsonb not null default '[]'::jsonb,
  result bigint not null,
  closed_by uuid references auth.users (id) on delete set null,
  closed_by_name text,
  closed_at timestamptz not null default now(),
  constraint finance_month_closes_month_check check (
    month_start = date_trunc('month', month_start)::date and month_start >= date '2024-01-01'
  ),
  constraint finance_month_closes_result_check check (result = revenue + other_income - expenses - salary_earned)
);

create index finance_month_closes_closed_by_idx on public.finance_month_closes (closed_by);

alter table public.finance_month_closes enable row level security;

revoke all on table public.finance_month_closes from anon, authenticated;
grant select on table public.finance_month_closes to authenticated;

create policy "owner reads month closes" on public.finance_month_closes
  for select to authenticated
  using ((select private.is_owner()));

-- ---------- 1b. finance_close_log ----------
create table public.finance_close_log (
  id bigint generated always as identity primary key,
  month_start date not null,
  action text not null check (action in ('closed', 'reopened')),
  reason text check (char_length(reason) <= 500),
  -- The month's frozen result at that moment (on a reopen: the result that was taken back).
  result bigint not null,
  actor uuid references auth.users (id) on delete set null,
  actor_name text,
  at timestamptz not null default now(),
  constraint finance_close_log_reopen_reason_check check (action <> 'reopened' or char_length(btrim(coalesce(reason, ''))) >= 10)
);

create index finance_close_log_at_idx on public.finance_close_log (at desc);
create index finance_close_log_actor_idx on public.finance_close_log (actor);

alter table public.finance_close_log enable row level security;

revoke all on table public.finance_close_log from anon, authenticated;
grant select on table public.finance_close_log to authenticated;

create policy "owner reads close log" on public.finance_close_log
  for select to authenticated
  using ((select private.is_owner()));

-- ---------- 1c. frozen rows ----------
-- A close row never changes: the only update let through is the "on delete set null" of a removed account. It is
-- deleted only while no later month is closed (reopen_finance_month deletes the latest one). Runs for every role.
create or replace function private.guard_month_close_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.closed_by is null and (to_jsonb(new) - 'closed_by') = (to_jsonb(old) - 'closed_by') then
      return new;
    end if;
    raise exception 'month_close_frozen' using errcode = '55000';
  end if;
  if exists (select 1 from public.finance_month_closes c where c.month_start > old.month_start) then
    raise exception 'reopen_not_latest' using errcode = '55000';
  end if;
  return old;
end;
$$;

revoke all on function private.guard_month_close_row() from public;

create trigger finance_month_closes_guard
  before update or delete on public.finance_month_closes
  for each row execute function private.guard_month_close_row();

-- The log is append-only; the only update let through is the "on delete set null" of a removed account.
create or replace function private.guard_close_log_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.actor is null and (to_jsonb(new) - 'actor') = (to_jsonb(old) - 'actor') then
    return new;
  end if;
  raise exception 'close_log_append_only' using errcode = '55000';
end;
$$;

revoke all on function private.guard_close_log_row() from public;

create trigger finance_close_log_guard
  before update or delete on public.finance_close_log
  for each row execute function private.guard_close_log_row();

-- ---------- 2a. private.finance_month_figures ----------
-- The figures of the month starting p_month, counted from its 1st to p_through (the month's last day for a finished
-- month; today for the running one), by the close rule in the header. Not callable by clients; the public functions
-- call it after their owner check (as security definer, so RLS does not hide the rows here).
create or replace function private.finance_month_figures(p_month date, p_through date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_from_at timestamptz := p_month::timestamp at time zone 'Asia/Tashkent';
  v_to_at timestamptz := (p_through + 1)::timestamp at time zone 'Asia/Tashkent';
  v_revenue bigint;
  v_orders int;
  v_other bigint;
  v_investor bigint;
  v_expenses bigint;
  v_earned bigint;
  v_breakdown jsonb;
begin
  select coalesce(sum(o.total), 0)::bigint, count(*)::int
    into v_revenue, v_orders
  from public.orders o
  where o.status in ('paid', 'active', 'completed')
    and coalesce(o.paid_at, o.created_at) >= v_from_at
    and coalesce(o.paid_at, o.created_at) < v_to_at;

  select
    coalesce(sum(f.amount) filter (where f.entry_type = 'income' and f.category = 'other_income'), 0)::bigint,
    coalesce(sum(f.amount) filter (where f.entry_type = 'income' and f.category = 'investor_support'), 0)::bigint,
    coalesce(sum(f.amount) filter (where f.entry_type = 'expense'), 0)::bigint
    into v_other, v_investor, v_expenses
  from public.finance_entries f
  where f.entry_date between p_month and p_through;

  with acc as (
    select
      s.s_employee_id as a_id,
      sum(s.s_pay)::bigint as a_pay,
      (count(*) filter (where s.s_pay > 0))::int as a_days
    from private.finance_salary_days(p_month, p_through) s
    group by 1
  ),
  ev as (
    select
      x.employee_id as v_id,
      coalesce(sum(x.amount) filter (where x.kind = 'bonus'), 0)::bigint as v_bonuses,
      coalesce(sum(x.amount) filter (where x.kind = 'fine'), 0)::bigint as v_fines
    from public.finance_salary_events x
    where x.kind in ('bonus', 'fine') and x.event_date between p_month and p_through
    group by 1
  ),
  per as (
    select
      e.id as p_id,
      e.name as p_name,
      coalesce(acc.a_days, 0) as p_days,
      coalesce(acc.a_pay, 0)::bigint as p_accrued,
      coalesce(ev.v_bonuses, 0)::bigint as p_bonuses,
      coalesce(ev.v_fines, 0)::bigint as p_fines
    from public.finance_employees e
    left join acc on acc.a_id = e.id
    left join ev on ev.v_id = e.id
    where coalesce(acc.a_pay, 0) <> 0 or coalesce(ev.v_bonuses, 0) <> 0 or coalesce(ev.v_fines, 0) <> 0
  )
  select
    coalesce(sum(p.p_accrued + p.p_bonuses - p.p_fines), 0)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'employee_id', p.p_id,
          'name', p.p_name,
          'days', p.p_days,
          'accrued', p.p_accrued,
          'bonuses', p.p_bonuses,
          'fines', p.p_fines,
          'earned', p.p_accrued + p.p_bonuses - p.p_fines
        )
        order by p.p_name, p.p_id
      ),
      '[]'::jsonb
    )
    into v_earned, v_breakdown
  from per p;

  return jsonb_build_object(
    'revenue', v_revenue,
    'order_count', v_orders,
    'other_income', v_other,
    'investor_support', v_investor,
    'expenses', v_expenses,
    'salary_earned', v_earned,
    'salary_breakdown', v_breakdown,
    'result', v_revenue + v_other - v_expenses - v_earned
  );
end;
$$;

revoke all on function private.finance_month_figures(date, date) from public;

-- ---------- 2b. private.finance_first_month ----------
-- The first month with any activity: a paid order (by its Tashkent payment day), a ledger entry, a payroll event or an
-- employee's first day. Null when there is none.
create or replace function private.finance_first_month()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', least(
    (select min(coalesce(o.paid_at, o.created_at) at time zone 'Asia/Tashkent')
       from public.orders o where o.status in ('paid', 'active', 'completed')),
    (select min(f.entry_date)::timestamp from public.finance_entries f),
    (select min(x.event_date)::timestamp from public.finance_salary_events x),
    (select min(e.joined_at)::timestamp from public.finance_employees e)
  ))::date;
$$;

revoke all on function private.finance_first_month() from public;

-- ---------- 2c. private.finance_next_to_close ----------
-- The month to close next: the month after the latest closed one, or the first month with activity when none is
-- closed yet; null when that month has not ended (p_current is the running Tashkent month) or there is no activity.
create or replace function private.finance_next_to_close(p_current date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last date;
  v_next date;
begin
  select max(c.month_start) into v_last from public.finance_month_closes c;
  if v_last is not null then
    v_next := (v_last + interval '1 month')::date;
  else
    v_next := private.finance_first_month();
  end if;
  if v_next is null or v_next >= p_current then
    return null;
  end if;
  return v_next;
end;
$$;

revoke all on function private.finance_next_to_close(date) from public;

-- ---------- 2d. private.finance_locked_through ----------
-- The last day of the latest closed month: every day up to it is locked. Null when no month is closed. Volatile, so a
-- guard reads the closes committed up to the moment it runs.
create or replace function private.finance_locked_through()
returns date
language sql
volatile
security definer
set search_path = ''
as $$
  select (max(c.month_start) + interval '1 month - 1 day')::date from public.finance_month_closes c;
$$;

revoke all on function private.finance_locked_through() from public;

-- ---------- 3a. close_finance_month ----------
-- Closes one finished month: computes its figures here (nothing is taken from the caller but the month), freezes them
-- and writes the log. Errors (message, code):
--   not_owner 42501 · bad_month 22023 (not the 1st of a month, or before 2024) · month_already_closed 55000 ·
--   month_not_finished 55000 (the running month or a later one) · nothing_to_close 55000 (no activity, or every
--   finished month is closed) · close_out_of_order 55000 (another month must be closed first; detail: that month).
-- Returns the frozen row as JSON.
create or replace function public.close_finance_month(p_month_start date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current date := date_trunc('month', now() at time zone 'Asia/Tashkent')::date;
  v_end date;
  v_next date;
  v_figures jsonb;
  v_uid uuid := auth.uid();
  v_name text;
  v_row public.finance_month_closes;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if p_month_start is null
    or p_month_start <> date_trunc('month', p_month_start)::date
    or p_month_start < date '2024-01-01' then
    raise exception 'bad_month' using errcode = '22023';
  end if;

  -- One close or reopen at a time, and no write to the closed tables while the month is counted: a write that started
  -- before finishes first, one that comes after waits and then meets the close (its guard sees the new row).
  perform pg_advisory_xact_lock(hashtext('public.finance_month_closes'));
  lock table public.finance_entries, public.finance_salary_events, public.finance_salary_rates, public.finance_employees
    in share mode;

  if exists (select 1 from public.finance_month_closes c where c.month_start = p_month_start) then
    raise exception 'month_already_closed' using errcode = '55000';
  end if;
  if p_month_start >= v_current then
    raise exception 'month_not_finished' using errcode = '55000';
  end if;

  v_next := private.finance_next_to_close(v_current);
  if v_next is null then
    raise exception 'nothing_to_close' using errcode = '55000';
  end if;
  if p_month_start <> v_next then
    raise exception 'close_out_of_order' using errcode = '55000', detail = v_next::text;
  end if;

  v_end := (p_month_start + interval '1 month - 1 day')::date;
  v_figures := private.finance_month_figures(p_month_start, v_end);
  select nullif(btrim(s.name), '') into v_name from public.staff s where s.user_id = v_uid;

  insert into public.finance_month_closes (
    month_start, revenue, order_count, other_income, investor_support, expenses, salary_earned, salary_breakdown,
    result, closed_by, closed_by_name
  )
  values (
    p_month_start,
    (v_figures ->> 'revenue')::bigint,
    (v_figures ->> 'order_count')::int,
    (v_figures ->> 'other_income')::bigint,
    (v_figures ->> 'investor_support')::bigint,
    (v_figures ->> 'expenses')::bigint,
    (v_figures ->> 'salary_earned')::bigint,
    v_figures -> 'salary_breakdown',
    (v_figures ->> 'result')::bigint,
    v_uid,
    v_name
  )
  returning * into v_row;

  insert into public.finance_close_log (month_start, action, reason, result, actor, actor_name)
  values (p_month_start, 'closed', null, v_row.result, v_uid, v_name);

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.close_finance_month(date) from public, anon;
grant execute on function public.close_finance_month(date) to authenticated;

-- ---------- 3b. reopen_finance_month ----------
-- Opens the latest closed month again: deletes its frozen row and logs the reason. Errors (message, code):
--   not_owner 42501 · bad_month 22023 · reason_required 22023 (under 10 characters after trimming, or over 500) ·
--   month_not_closed 55000 · reopen_not_latest 55000 (a later month is closed; reopen that one first).
create or replace function public.reopen_finance_month(p_month_start date, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_uid uuid := auth.uid();
  v_name text;
  v_row public.finance_month_closes;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_month_start is null or p_month_start <> date_trunc('month', p_month_start)::date then
    raise exception 'bad_month' using errcode = '22023';
  end if;
  if char_length(v_reason) < 10 or char_length(v_reason) > 500 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('public.finance_month_closes'));

  select * into v_row from public.finance_month_closes c where c.month_start = p_month_start;
  if not found then
    raise exception 'month_not_closed' using errcode = '55000';
  end if;
  if exists (select 1 from public.finance_month_closes c where c.month_start > p_month_start) then
    raise exception 'reopen_not_latest' using errcode = '55000';
  end if;

  select nullif(btrim(s.name), '') into v_name from public.staff s where s.user_id = v_uid;

  delete from public.finance_month_closes c where c.month_start = p_month_start;

  insert into public.finance_close_log (month_start, action, reason, result, actor, actor_name)
  values (p_month_start, 'reopened', v_reason, v_row.result, v_uid, v_name);
end;
$$;

revoke all on function public.reopen_finance_month(date, text) from public, anon;
grant execute on function public.reopen_finance_month(date, text) to authenticated;

-- ---------- 3c. finance_close_overview ----------
-- Everything the Month close screen shows, as JSON:
--   { today, current_month, first_month, next_to_close,
--     months: [{ month_start, status,              oldest first, from the first month (with activity or closed) to
--                                                  the running one, at most the last 60 months;
--                                                  status: closed | ready (next to close) | waiting (an earlier month
--                                                  must be closed first) | current (still running)
--                live: { figures },                counted now; the running month up to today
--                closed: { frozen row } | null,
--                drift: live.result − closed.result | null }],
--     log: [{ month_start, action, reason, result, actor_name, at }]   the 30 latest, newest first }
-- figures: { revenue, order_count, other_income, investor_support, expenses, salary_earned, salary_breakdown, result }.
create or replace function public.finance_close_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_current date := date_trunc('month', now() at time zone 'Asia/Tashkent')::date;
  v_first date;
  v_next date;
  v_month date;
  v_live jsonb;
  v_closed jsonb;
  v_months jsonb := '[]'::jsonb;
  v_log jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  v_first := least(private.finance_first_month(), (select min(c.month_start) from public.finance_month_closes c));
  v_next := private.finance_next_to_close(v_current);

  if v_first is not null then
    v_first := greatest(v_first, (v_current - interval '59 months')::date);
    for v_month in
      select gs::date from generate_series(v_first, v_current, interval '1 month') gs order by 1
    loop
      v_live := private.finance_month_figures(
        v_month,
        least((v_month + interval '1 month - 1 day')::date, v_today)
      );
      select to_jsonb(c) - 'id' into v_closed from public.finance_month_closes c where c.month_start = v_month;
      v_months := v_months || jsonb_build_object(
        'month_start', v_month,
        'status', case
          when v_closed is not null then 'closed'
          when v_month = v_current then 'current'
          when v_month = v_next then 'ready'
          else 'waiting'
        end,
        'live', v_live,
        'closed', v_closed,
        'drift', case
          when v_closed is null then null
          else (v_live ->> 'result')::bigint - (v_closed ->> 'result')::bigint
        end
      );
    end loop;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'month_start', l.month_start, 'action', l.action, 'reason', l.reason, 'result', l.result,
        'actor_name', l.actor_name, 'at', l.at
      )
      order by l.at desc, l.id desc
    ),
    '[]'::jsonb
  )
    into v_log
  from (select * from public.finance_close_log order by at desc, id desc limit 30) l;

  return jsonb_build_object(
    'today', v_today,
    'current_month', v_current,
    'first_month', v_first,
    'next_to_close', v_next,
    'months', v_months,
    'log', v_log
  );
end;
$$;

revoke all on function public.finance_close_overview() from public, anon;
grant execute on function public.finance_close_overview() to authenticated;

-- ---------- 4. guards on the tables a close counts ----------
-- Security definer so the lookup of the closes runs whatever the caller may read; they only ever refuse. Each raises
-- month_closed (55000) when the write would change a figure of a day up to the end of the latest closed month.

-- Ledger entries: no insert or delete dated in a closed month (no client updates exist; any other update is checked on
-- both dates).
create or replace function private.guard_closed_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked date := private.finance_locked_through();
begin
  if v_locked is not null and (
    (tg_op in ('INSERT', 'UPDATE') and new.entry_date <= v_locked)
    or (tg_op in ('DELETE', 'UPDATE') and old.entry_date <= v_locked)
  ) then
    raise exception 'month_closed' using errcode = '55000', detail = v_locked::text;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.guard_closed_entry() from public;

create trigger finance_entries_guard_closed
  before insert or delete or update of entry_type, entry_date, category, amount on public.finance_entries
  for each row execute function private.guard_closed_entry();

-- Payroll events (payments, bonuses, fines, absences): the same by event_date.
create or replace function private.guard_closed_salary_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked date := private.finance_locked_through();
begin
  if v_locked is not null and (
    (tg_op in ('INSERT', 'UPDATE') and new.event_date <= v_locked)
    or (tg_op in ('DELETE', 'UPDATE') and old.event_date <= v_locked)
  ) then
    raise exception 'month_closed' using errcode = '55000', detail = v_locked::text;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.guard_closed_salary_event() from public;

create trigger finance_salary_events_guard_closed
  before insert or delete or update of employee_id, kind, event_date, amount on public.finance_salary_events
  for each row execute function private.guard_closed_salary_event();

-- Salary rates: a rate pays from its effective_from on, so adding or deleting one that starts on or before the locked
-- day changes the pay of locked days. One starting later only touches open days.
create or replace function private.guard_closed_salary_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked date := private.finance_locked_through();
begin
  if v_locked is not null and (
    (tg_op in ('INSERT', 'UPDATE') and new.effective_from <= v_locked)
    or (tg_op in ('DELETE', 'UPDATE') and old.effective_from <= v_locked)
  ) then
    raise exception 'month_closed' using errcode = '55000', detail = v_locked::text;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.guard_closed_salary_rate() from public;

create trigger finance_salary_rates_guard_closed
  before insert or delete or update of employee_id, effective_from, amount, rate_unit on public.finance_salary_rates
  for each row execute function private.guard_closed_salary_rate();

-- Employees: the paid days run from joined_at to ended_at (open = still working). A new person whose first day is
-- locked, a changed first day, or a leaving recorded, moved or undone so that a locked day changes between paid and
-- not paid, is refused. The first changed day of a new end is the day after the earlier of the two ends (an open end
-- counts as the later one; least() skips a null).
create or replace function private.guard_closed_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked date := private.finance_locked_through();
  v_from date;
begin
  if v_locked is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    v_from := new.joined_at;
  elsif tg_op = 'DELETE' then
    v_from := old.joined_at;
  else
    if new.joined_at is distinct from old.joined_at then
      v_from := least(new.joined_at, old.joined_at);
    end if;
    if new.ended_at is distinct from old.ended_at then
      v_from := least(v_from, least(new.ended_at, old.ended_at) + 1);
    end if;
  end if;
  if v_from is not null and v_from <= v_locked then
    raise exception 'month_closed' using errcode = '55000', detail = v_locked::text;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.guard_closed_employee() from public;

create trigger finance_employees_guard_closed
  before insert or delete or update of joined_at, ended_at on public.finance_employees
  for each row execute function private.guard_closed_employee();

-- ---------- 5. finance settings in public.settings ----------
-- Three keys, written by the owner through the existing owner-only write policy (0003, "staff write settings"); a row
-- is deleted to clear a setting:
--   finance_monthly_rent       whole UZS, 0 .. 100 000 000 000: the rent the month is expected to pay
--   finance_break_even_daily   whole UZS, 0 .. 100 000 000 000: the revenue a day needs to cover the month's costs
--   finance_tax_rate_pct       a number 0 .. 100 with at most 2 decimals: the rate for an estimated tax line
-- Every settings row is readable by anyone (0001, "public read settings": the site reads delivery windows and the
-- cut-off hour). These are business figures, so a restrictive policy keeps finance_* rows to the owner; every other
-- row reads exactly as before.
create policy "finance settings owner only" on public.settings
  as restrictive
  for select to anon, authenticated
  using (key not like 'finance\_%' or (select private.is_owner()));

create or replace function private.check_finance_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_number numeric;
begin
  if new.key not like 'finance\_%' then
    return new;
  end if;
  if new.key not in ('finance_monthly_rent', 'finance_break_even_daily', 'finance_tax_rate_pct') then
    raise exception 'unknown_finance_setting' using errcode = '23514';
  end if;
  if jsonb_typeof(new.value) <> 'number' then
    raise exception 'bad_finance_setting' using errcode = '23514';
  end if;
  v_number := (new.value #>> '{}')::numeric;
  if new.key = 'finance_tax_rate_pct' then
    if v_number < 0 or v_number > 100 or v_number <> round(v_number, 2) then
      raise exception 'bad_finance_setting' using errcode = '23514';
    end if;
  elsif v_number < 0 or v_number > 100000000000 or v_number <> trunc(v_number) then
    raise exception 'bad_finance_setting' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_finance_setting() from public;

create trigger settings_check_finance
  before insert or update on public.settings
  for each row execute function private.check_finance_setting();
