-- Finance analysis, round two: a limit on how far back a record may be entered by hand, bank fee rates per payment
-- method (for an estimate only), and four owner-only read functions for the Finance screens: the whole history with
-- day totals, the month's indicators (daily burn, runway, all-time balance), money in and out per
-- payment method with estimated fees, and the records (best month, best 10 days, best day, profitable runs).
-- Plan: docs/plans/zarkebab-feature-port.md, slice 8.
--
-- Additive only. No existing row, table, column, policy or grant is changed or dropped:
--   1. private.check_finance_setting (0015, trigger settings_check_finance) is replaced (create or replace, same
--      signature) to accept one more key, finance_backdate_days: a JSON whole number 0..31. The three keys of 0015 are
--      checked exactly as before. Like every finance_* key it is readable by the owner only (the restrictive policy of
--      0015) and written by the owner only (0003). No settings row is written here: a missing row means 3 days.
--   2. New private.finance_backdate_days(): the setting's value, 3 when the row is missing or not a whole 0..31.
--   3. New before-insert triggers finance_entries_guard_window and finance_salary_events_guard_window
--      (private.check_finance_backdate): a row a signed-in client inserts itself (current_user = authenticated: the
--      Finance → Records form and the payroll forms) must be dated today or up to N days back in Tashkent, N from the
--      setting. Refused rows raise backdate_limit (22023; detail: the earliest day allowed, hint: N). Only the owner is
--      checked: anyone else is refused by RLS as before, so the limit is not revealed. Not checked:
--        * writes made inside a security definer function (current_user is then the function's owner): purchase_save
--          (0022), which mirrors a receipt into the ledger under its own 3-day rule and lets the owner fix an older
--          receipt of an open month; any later system function that writes the ledger;
--        * migrations and backfills (run as postgres), the server's secret key (service_role);
--        * deletes and the existing rows: the trigger is on insert only, and no client may update either table.
--      The closed-month guards of 0015 are untouched and fire first (trigger names sort "guard_closed" before
--      "guard_window"), so a day in a closed month still says month_closed.
--   4. New table public.finance_fee_rates: a bank fee rate per method (card, transfer) in basis points from a day on.
--      RLS on, the owner reads, adds and deletes; nobody updates (a wrong rate is deleted and added again). A new
--      after trigger records each add and delete in the audit log (0019) as a settings change, key finance_fee_rates.
--      The rates feed an estimate only; nothing here writes a fee to the ledger.
--   5. New functions, owner only (each raises not_owner, 42501, for anyone else), executable by authenticated:
--        finance_history(...)      every ledger row and salary payment, newest first, search, kind filter, cursor
--                                  paging, with each listed day's totals
--        finance_indicators(month) the month's cash sums and the all-time balance up to the month's last counted day
--        finance_method_flow(...)  money in and out per payment method over a range, with estimated bank fees
--        finance_records()         best month, best 10 days in a row, best day, longest run of profitable months
--      and one private helper, private.finance_cash_sums(from, to), the cash rule in one place.
--
-- The cash rule every function here follows (as finance_period and finance_monthly_cashflow, 0013 / 0014):
--   revenue     orders.total of orders in status paid, active or completed, on the Tashkent day of
--               coalesce(paid_at, created_at)
--   income      revenue + ledger other_income
--   investor    ledger investor_support: never income, reported on its own
--   spent       ledger expenses (one-off salary entries included) + salary payments (payroll kind 'payment')
-- Salary earned but not yet paid is not spending here (the month close, 0015, counts that instead).
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0008, 0013, 0015, 0019 and 0022: the owner check is the first statement of each public function.

-- ---------- 1. finance_backdate_days in the finance settings check ----------
-- As in 0015, plus finance_backdate_days. Checked as text, so 3.0 (which an int cast refuses) is refused here too.
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
  if new.key not in ('finance_monthly_rent', 'finance_break_even_daily', 'finance_tax_rate_pct', 'finance_backdate_days') then
    raise exception 'unknown_finance_setting' using errcode = '23514';
  end if;
  if jsonb_typeof(new.value) <> 'number' then
    raise exception 'bad_finance_setting' using errcode = '23514';
  end if;
  if new.key = 'finance_backdate_days' then
    if (new.value #>> '{}') !~ '^([0-9]|[12][0-9]|3[01])$' then
      raise exception 'bad_finance_setting' using errcode = '23514';
    end if;
    return new;
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

-- ---------- 2. finance_backdate_days ----------
-- Security definer: the guard below runs as the client, and the finance_* rows are owner-only to read. Only the
-- number leaves the function. 3 when the row is missing (the default) or malformed.
create or replace function private.finance_backdate_days()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when jsonb_typeof(s.value) = 'number' and (s.value #>> '{}') ~ '^([0-9]|[12][0-9]|3[01])$'
          then (s.value #>> '{}')::int
      end
      from public.settings s
      where s.key = 'finance_backdate_days'
    ),
    3
  );
$$;

revoke all on function private.finance_backdate_days() from public, anon;
grant execute on function private.finance_backdate_days() to authenticated;

-- ---------- 3. the backdate guard ----------
-- Security invoker on purpose: current_user is the role of the statement that inserts. A client insert through the API
-- runs as authenticated; inside a security definer function (purchase_save) it is that function's owner, in a
-- migration postgres, with the secret key service_role. Only the first is a record typed by hand, so only it is
-- checked. tg_argv[0] names the row's day column (entry_date or event_date).
create or replace function private.check_finance_backdate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_day date;
  v_days int;
  v_earliest date;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  -- Only the owner may insert these rows (RLS). Anyone else gets the policy's own refusal, so the limit is never
  -- revealed through this error.
  if not private.is_owner() then
    return new;
  end if;
  v_day := (to_jsonb(new) ->> tg_argv[0])::date;
  v_days := private.finance_backdate_days();
  v_earliest := (now() at time zone 'Asia/Tashkent')::date - v_days;
  if v_day < v_earliest then
    raise exception 'backdate_limit' using errcode = '22023', detail = v_earliest::text, hint = v_days::text;
  end if;
  return new;
end;
$$;

revoke all on function private.check_finance_backdate() from public;

create trigger finance_entries_guard_window
  before insert on public.finance_entries
  for each row execute function private.check_finance_backdate('entry_date');

create trigger finance_salary_events_guard_window
  before insert on public.finance_salary_events
  for each row execute function private.check_finance_backdate('event_date');

-- ---------- 4. finance_fee_rates ----------
-- What the bank keeps of a payment by card or by transfer, from a day on: rate_bp basis points (150 = 1.5 %), at most
-- 20 %. A change of rate is a new row with its own effective_from. Cash has no fee and no row.
create table public.finance_fee_rates (
  id uuid primary key default gen_random_uuid(),
  method text not null check (method in ('card', 'transfer')),
  rate_bp int not null check (rate_bp between 0 and 2000),
  effective_from date not null check (effective_from >= date '2024-01-01'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_fee_rates_day_key unique (method, effective_from)
);

create index finance_fee_rates_created_by_idx on public.finance_fee_rates (created_by);

alter table public.finance_fee_rates enable row level security;

revoke all on table public.finance_fee_rates from anon, authenticated;
grant select, delete on table public.finance_fee_rates to authenticated;
grant insert (method, rate_bp, effective_from) on table public.finance_fee_rates to authenticated;

create policy "owner reads fee rates" on public.finance_fee_rates
  for select to authenticated
  using ((select private.is_owner()));

create policy "owner adds fee rates" on public.finance_fee_rates
  for insert to authenticated
  with check ((select private.is_owner()) and created_by = (select auth.uid()));

create policy "owner deletes fee rates" on public.finance_fee_rates
  for delete to authenticated
  using ((select private.is_owner()));

-- Each add and delete in the audit log (0019), area settings, as a change of the key finance_fee_rates: the audit page
-- shows it with the Settings screen's other changes. Updates do not exist for clients; the "on delete set null" of a
-- removed account is not logged.
create or replace function private.audit_fee_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_fee_rates;
begin
  if tg_op = 'UPDATE' then
    return null;
  end if;
  v_row := coalesce(new, old);
  perform private.write_audit(
    'settings',
    case tg_op when 'INSERT' then 'added' else 'deleted' end,
    'settings:finance_fee_rates',
    jsonb_build_object(
      'key', 'finance_fee_rates',
      case tg_op when 'INSERT' then 'to' else 'from' end,
      jsonb_build_object('method', v_row.method, 'rate_bp', v_row.rate_bp, 'effective_from', v_row.effective_from)
    )
  );
  return null;
end;
$$;

revoke all on function private.audit_fee_rate() from public;

create trigger finance_fee_rates_audit
  after insert or delete on public.finance_fee_rates
  for each row execute function private.audit_fee_rate();

-- ---------- 5a. private.finance_cash_sums ----------
-- The cash sums of the Tashkent days p_from .. p_to (both included; p_from null = from the beginning) by the rule in
-- the header: { revenue, order_count, other_income, investor_support, expenses, salaries }. Not callable by clients;
-- the public functions call it after their owner check.
create or replace function private.finance_cash_sums(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'revenue', coalesce(o.o_revenue, 0),
    'order_count', coalesce(o.o_count, 0),
    'other_income', coalesce(f.f_other, 0),
    'investor_support', coalesce(f.f_investor, 0),
    'expenses', coalesce(f.f_expenses, 0),
    'salaries', coalesce(s.s_paid, 0)
  )
  from (
    select sum(x.total)::bigint as o_revenue, count(*)::int as o_count
    from public.orders x
    where x.status in ('paid', 'active', 'completed')
      and (p_from is null or coalesce(x.paid_at, x.created_at) >= (p_from::timestamp at time zone 'Asia/Tashkent'))
      and coalesce(x.paid_at, x.created_at) < ((p_to + 1)::timestamp at time zone 'Asia/Tashkent')
  ) o
  cross join (
    select
      sum(e.amount) filter (where e.entry_type = 'income' and e.category = 'other_income')::bigint as f_other,
      sum(e.amount) filter (where e.entry_type = 'income' and e.category = 'investor_support')::bigint as f_investor,
      sum(e.amount) filter (where e.entry_type = 'expense')::bigint as f_expenses
    from public.finance_entries e
    where (p_from is null or e.entry_date >= p_from) and e.entry_date <= p_to
  ) f
  cross join (
    select sum(p.amount)::bigint as s_paid
    from public.finance_salary_events p
    where p.kind = 'payment' and (p_from is null or p.event_date >= p_from) and p.event_date <= p_to
  ) s;
$$;

revoke all on function private.finance_cash_sums(date, date) from public, anon, authenticated;

-- ---------- 5b. finance_history ----------
-- Every ledger row (expense, investor money, other income) and every salary payment, newest day first and, within a
-- day, newest first. Arguments:
--   p_from, p_to     optional range of days (both included); null = no bound
--   p_search         trimmed, at most 60 characters, folded as private.fold_search (0022) does: matches the
--                    counterparty (for a salary payment, the employee's name) and the comment as a substring; a term
--                    of digits (spaces, dots and commas ignored) also matches amounts by their digits; a day
--                    (2026-11-25 or 25.11.2026) matches that day's rows
--   p_kind           null = every kind; else expense | investor | other_income | salary (bad_kind, 22023)
--   p_categories     ledger categories whose name matched the search in the screen's languages (the names live in
--                    the app, not here); null or empty = none
--   p_before_day, p_before_key   the cursor: only rows after (older than) the row given, for "older" paging
--   p_limit          1..200 rows (100 by default)
-- Returns { rows: [{ key, day, kind, id, category, method, amount, counterparty, note, created_at, added_by,
--                    employee_id, purchase_id }],
--           more: whether older rows exist,
--           days: [{ day, count, expenses, salaries, other_income, investor_support }] }
-- days holds the listed days only, each totalled over every row of that day that matches the same search and kind
-- (also rows on the next page), so a day header is right however the page cuts it. Errors: not_owner 42501 ·
-- bad_kind 22023 · bad_period 22023 (p_to before p_from).
create or replace function public.finance_history(
  p_from date default null,
  p_to date default null,
  p_search text default null,
  p_kind text default null,
  p_categories text[] default null,
  p_before_day date default null,
  p_before_key text default null,
  p_limit int default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_search text := left(btrim(coalesce(p_search, '')), 60);
  v_like text;
  v_digits text;
  v_day date;
  v_parts text[];
  v_categories text[] := coalesce(p_categories, '{}');
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_kind is not null and p_kind not in ('expense', 'investor', 'other_income', 'salary') then
    raise exception 'bad_kind' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  if v_search <> '' then
    v_like := '%' || replace(replace(replace(private.fold_search(v_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    if v_search ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      v_parts := string_to_array(v_search, '-');
    elsif v_search ~ '^[0-9]{1,2}[./][0-9]{1,2}[./][0-9]{4}$' then
      v_parts := regexp_split_to_array(v_search, '[./]');
      v_parts := array[v_parts[3], v_parts[2], v_parts[1]];
    end if;
    if v_parts is not null then
      begin
        v_day := make_date(v_parts[1]::int, v_parts[2]::int, v_parts[3]::int);
      exception
        when datetime_field_overflow or invalid_datetime_format then
          v_day := null;
      end;
    end if;
    if v_day is null
       and regexp_replace(v_search, '[[:space:].,' || chr(160) || chr(8239) || ']', '', 'g') ~ '^[0-9]+$' then
      v_digits := regexp_replace(v_search, '[^0-9]', '', 'g');
    end if;
  end if;

  with src as (
    select
      f.entry_date as h_day,
      -- created_at as fixed-width text, then the source and the id: sorts newest first and never ties.
      to_char(f.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') || 'e' || f.id::text as h_key,
      case
        when f.entry_type = 'expense' then 'expense'
        when f.category = 'investor_support' then 'investor'
        else 'other_income'
      end as h_kind,
      f.id as h_id,
      f.category as h_category,
      f.payment_method as h_method,
      f.amount as h_amount,
      f.counterparty as h_who,
      f.note as h_note,
      f.created_at as h_created_at,
      f.created_by as h_created_by,
      null::uuid as h_employee_id
    from public.finance_entries f
    where (p_kind is null or p_kind <> 'salary')
      and (p_from is null or f.entry_date >= p_from)
      and (p_to is null or f.entry_date <= p_to)
    union all
    select
      x.event_date,
      to_char(x.created_at at time zone 'UTC', 'YYYYMMDDHH24MISSUS') || 's' || x.id::text,
      'salary',
      x.id,
      'salary',
      x.payment_method,
      x.amount,
      e.name,
      x.note,
      x.created_at,
      x.created_by,
      x.employee_id
    from public.finance_salary_events x
    join public.finance_employees e on e.id = x.employee_id
    where x.kind = 'payment'
      and (p_kind is null or p_kind = 'salary')
      and (p_from is null or x.event_date >= p_from)
      and (p_to is null or x.event_date <= p_to)
  ),
  matched as (
    select s.*
    from src s
    where (p_kind is null or s.h_kind = p_kind)
      and (
        v_like is null
        or private.fold_search(s.h_who) like v_like
        or private.fold_search(s.h_note) like v_like
        or s.h_category = any (v_categories)
        or (v_digits is not null and s.h_amount::text like '%' || v_digits || '%')
        or (v_day is not null and s.h_day = v_day)
      )
  ),
  page as (
    select m.*
    from matched m
    where p_before_day is null
      or m.h_day < p_before_day
      or (m.h_day = p_before_day and m.h_key collate "C" < coalesce(p_before_key, '') collate "C")
    order by m.h_day desc, m.h_key collate "C" desc
    limit v_limit + 1
  ),
  shown as (
    select p.* from page p order by p.h_day desc, p.h_key collate "C" desc limit v_limit
  )
  select jsonb_build_object(
    'rows', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'key', r.h_key,
            'day', r.h_day,
            'kind', r.h_kind,
            'id', r.h_id,
            'category', r.h_category,
            'method', r.h_method,
            'amount', r.h_amount,
            'counterparty', r.h_who,
            'note', r.h_note,
            'created_at', r.h_created_at,
            'added_by', (select nullif(btrim(st.name), '') from public.staff st where st.user_id = r.h_created_by),
            'employee_id', r.h_employee_id,
            'purchase_id', (
              select pu.id from public.purchases pu where r.h_kind = 'expense' and pu.finance_entry_id = r.h_id
            )
          )
          order by r.h_day desc, r.h_key collate "C" desc
        ),
        '[]'::jsonb
      )
      from shown r
    ),
    'more', (select count(*) > v_limit from page),
    'days', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'day', d.d_day,
            'count', d.d_count,
            'expenses', d.d_expenses,
            'salaries', d.d_salaries,
            'other_income', d.d_other,
            'investor_support', d.d_investor
          )
          order by d.d_day desc
        ),
        '[]'::jsonb
      )
      from (
        select
          m.h_day as d_day,
          count(*)::int as d_count,
          coalesce(sum(m.h_amount) filter (where m.h_kind = 'expense'), 0)::bigint as d_expenses,
          coalesce(sum(m.h_amount) filter (where m.h_kind = 'salary'), 0)::bigint as d_salaries,
          coalesce(sum(m.h_amount) filter (where m.h_kind = 'other_income'), 0)::bigint as d_other,
          coalesce(sum(m.h_amount) filter (where m.h_kind = 'investor'), 0)::bigint as d_investor
        from matched m
        where m.h_day in (select s.h_day from shown s)
        group by m.h_day
      ) d
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.finance_history(date, date, text, text, text[], date, text, int) from public, anon;
grant execute on function public.finance_history(date, date, text, text, text[], date, text, int) to authenticated;

-- ---------- 5c. finance_indicators ----------
-- The month starting p_month_start (a past month or the running one), counted from its 1st to its last day, or to today
-- (Tashkent) for the running month:
--   { month_start, through, days,                       days = through − month_start + 1
--     month: { cash sums of month_start .. through },
--     balance: { cash sums from the beginning to through } }
-- The app derives the figures (src/lib/admin/finance/analysis.ts): daily burn = spent / days, all-time balance = all
-- revenue, other income and investor money − all expenses and salary payments up to `through`, runway = balance / daily
-- burn. (A savings rate by the finance rule would equal the Month screen's margin, so none is shown.)
-- Errors: not_owner 42501 · bad_month 22023 (not the 1st of a month, before 2024, or after the running month).
create or replace function public.finance_indicators(p_month_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_through date;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_month_start is null
    or p_month_start <> date_trunc('month', p_month_start)::date
    or p_month_start < date '2024-01-01'
    or p_month_start > v_today then
    raise exception 'bad_month' using errcode = '22023';
  end if;

  v_through := least((p_month_start + interval '1 month - 1 day')::date, v_today);
  return jsonb_build_object(
    'month_start', p_month_start,
    'through', v_through,
    'days', v_through - p_month_start + 1,
    'month', private.finance_cash_sums(p_month_start, v_through),
    'balance', private.finance_cash_sums(null, v_through)
  );
end;
$$;

revoke all on function public.finance_indicators(date) from public, anon;
grant execute on function public.finance_indicators(date) to authenticated;

-- ---------- 5d. finance_method_flow ----------
-- Money in and out per payment method over the Tashkent days p_from .. p_to (both included, at most 366 days):
--   { methods: [{ method,                cash | card | transfer, then unknown (orders paid before slice 2 recorded no
--                                        method; only listed when there are such orders)
--                 order_count, orders,   paid orders and their revenue (the cash rule)
--                 other_income, investor_support, expenses, salaries,
--                 fee,                   estimated bank fee: Σ order total × the method's rate in force on the order's
--                                        paid day ÷ 10 000, rounded to whole UZS once per method
--                 unrated_count, unrated_orders }],   orders of a card or transfer day with no rate in force yet
--     fee_total }
-- The fee is an estimate for the screen only: it is not written anywhere. Ledger rows and salary payments carry no fee.
-- Errors: not_owner 42501 · bad_period 22023.
create or replace function public.finance_method_flow(p_from date, p_to date)
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
    select
      coalesce(o.payment_method, 'unknown') as p_method,
      (coalesce(o.paid_at, o.created_at) at time zone 'Asia/Tashkent')::date as p_day,
      o.total as p_total
    from public.orders o
    where o.status in ('paid', 'active', 'completed')
      and coalesce(o.paid_at, o.created_at) >= (p_from::timestamp at time zone 'Asia/Tashkent')
      and coalesce(o.paid_at, o.created_at) < ((p_to + 1)::timestamp at time zone 'Asia/Tashkent')
  ),
  rated as (
    select p.p_method, p.p_total, r.rate_bp as p_rate
    from paid p
    left join lateral (
      select fr.rate_bp
      from public.finance_fee_rates fr
      where fr.method = p.p_method and fr.effective_from <= p.p_day
      order by fr.effective_from desc
      limit 1
    ) r on true
  ),
  ord as (
    select
      x.p_method as m,
      count(*)::int as o_count,
      sum(x.p_total)::bigint as o_sum,
      round(coalesce(sum(x.p_total::numeric * x.p_rate) filter (where x.p_rate is not null), 0) / 10000)::bigint as o_fee,
      (count(*) filter (where x.p_rate is null and x.p_method in ('card', 'transfer')))::int as o_unrated_count,
      coalesce(sum(x.p_total) filter (where x.p_rate is null and x.p_method in ('card', 'transfer')), 0)::bigint
        as o_unrated_sum
    from rated x
    group by x.p_method
  ),
  led as (
    select
      f.payment_method as m,
      sum(f.amount) filter (where f.entry_type = 'income' and f.category = 'other_income')::bigint as l_other,
      sum(f.amount) filter (where f.entry_type = 'income' and f.category = 'investor_support')::bigint as l_investor,
      sum(f.amount) filter (where f.entry_type = 'expense')::bigint as l_expenses
    from public.finance_entries f
    where f.entry_date between p_from and p_to
    group by f.payment_method
  ),
  sal as (
    select s.payment_method as m, sum(s.amount)::bigint as s_paid
    from public.finance_salary_events s
    where s.kind = 'payment' and s.event_date between p_from and p_to
    group by s.payment_method
  ),
  methods as (
    select v.m, v.ord
    from (values ('cash', 1), ('card', 2), ('transfer', 3), ('unknown', 4)) as v(m, ord)
    where v.m <> 'unknown' or exists (select 1 from ord where ord.m = 'unknown')
  ),
  flow as (
    select
      mt.m,
      mt.ord,
      coalesce(ord.o_count, 0) as f_count,
      coalesce(ord.o_sum, 0)::bigint as f_orders,
      coalesce(led.l_other, 0)::bigint as f_other,
      coalesce(led.l_investor, 0)::bigint as f_investor,
      coalesce(led.l_expenses, 0)::bigint as f_expenses,
      coalesce(sal.s_paid, 0)::bigint as f_salaries,
      coalesce(ord.o_fee, 0)::bigint as f_fee,
      coalesce(ord.o_unrated_count, 0) as f_unrated_count,
      coalesce(ord.o_unrated_sum, 0)::bigint as f_unrated_sum
    from methods mt
    left join ord on ord.m = mt.m
    left join led on led.m = mt.m
    left join sal on sal.m = mt.m
  )
  select jsonb_build_object(
    'methods', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'method', fl.m,
          'order_count', fl.f_count,
          'orders', fl.f_orders,
          'other_income', fl.f_other,
          'investor_support', fl.f_investor,
          'expenses', fl.f_expenses,
          'salaries', fl.f_salaries,
          'fee', fl.f_fee,
          'unrated_count', fl.f_unrated_count,
          'unrated_orders', fl.f_unrated_sum
        )
        order by fl.ord
      ),
      '[]'::jsonb
    ),
    'fee_total', coalesce(sum(fl.f_fee), 0)::bigint
  )
  into v_result
  from flow fl;

  return v_result;
end;
$$;

revoke all on function public.finance_method_flow(date, date) from public, anon;
grant execute on function public.finance_method_flow(date, date) to authenticated;

-- ---------- 5e. finance_records ----------
-- The records of the whole history, by the cash rule:
--   { current_month, months,                           the running month; how many months since the first activity
--     best_month:        { month_start, revenue, order_count } | null   finished month with the highest revenue
--     best_result_month: { month_start, result } | null                finished month with the highest result
--     best_day:          { day, revenue, order_count } | null           the day with the highest revenue
--     best_ten_days:     { from, to, revenue, order_count } | null      the 10 days in a row (up to today) with the
--                                                                      highest revenue; null with fewer than 10 days
--                                                                      since the first paid order
--     longest_run:       { months, from, to } | null                    the longest run of finished months in a row
--                                                                      with a result above 0
--     current_run:       int                                           finished months in a row up to last month with
--                                                                      a result above 0 (0 when last month was not)
--     current:           { revenue, order_count } }                    the running month so far
-- result = revenue + other income − expenses − salary payments (investor money never counts). Months run from the
-- first month with activity (private.finance_first_month, 0015). Ties go to the earlier date.
-- Errors: not_owner 42501.
create or replace function public.finance_records()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_current date := date_trunc('month', now() at time zone 'Asia/Tashkent')::date;
  v_first date := private.finance_first_month();
  v_first_day date;
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if v_first is null or v_first > v_current then
    return jsonb_build_object(
      'current_month', v_current, 'months', 0, 'best_month', null, 'best_result_month', null, 'best_day', null,
      'best_ten_days', null, 'longest_run', null, 'current_run', 0,
      'current', jsonb_build_object('revenue', 0, 'order_count', 0)
    );
  end if;

  select min((coalesce(o.paid_at, o.created_at) at time zone 'Asia/Tashkent')::date)
    into v_first_day
  from public.orders o
  where o.status in ('paid', 'active', 'completed');

  with paid as (
    select (coalesce(o.paid_at, o.created_at) at time zone 'Asia/Tashkent')::date as p_day, o.total as p_total
    from public.orders o
    where o.status in ('paid', 'active', 'completed')
  ),
  by_day as (
    select p.p_day as d_day, sum(p.p_total)::bigint as d_revenue, count(*)::int as d_count
    from paid p
    group by p.p_day
  ),
  months as (
    select gs::date as m_start from generate_series(v_first, v_current, interval '1 month') gs
  ),
  rev as (
    select date_trunc('month', d.d_day)::date as r_month, sum(d.d_revenue)::bigint as r_revenue, sum(d.d_count)::int as r_count
    from by_day d
    group by 1
  ),
  led as (
    select
      date_trunc('month', f.entry_date)::date as l_month,
      coalesce(sum(f.amount) filter (where f.entry_type = 'income' and f.category = 'other_income'), 0)::bigint as l_other,
      coalesce(sum(f.amount) filter (where f.entry_type = 'expense'), 0)::bigint as l_expenses
    from public.finance_entries f
    group by 1
  ),
  sal as (
    select date_trunc('month', s.event_date)::date as s_month, sum(s.amount)::bigint as s_paid
    from public.finance_salary_events s
    where s.kind = 'payment'
    group by 1
  ),
  cash as (
    select
      m.m_start,
      coalesce(r.r_revenue, 0)::bigint as c_revenue,
      coalesce(r.r_count, 0) as c_count,
      (coalesce(r.r_revenue, 0) + coalesce(l.l_other, 0) - coalesce(l.l_expenses, 0) - coalesce(s.s_paid, 0))::bigint
        as c_result
    from months m
    left join rev r on r.r_month = m.m_start
    left join led l on l.l_month = m.m_start
    left join sal s on s.s_month = m.m_start
  ),
  done as (
    select c.*, row_number() over (order by c.m_start) as c_n from cash c where c.m_start < v_current
  ),
  -- Gaps and islands: profitable months in a row share (row number − row number among profitable months).
  islands as (
    select
      d.m_start,
      d.c_n - row_number() over (order by d.m_start) as i_group
    from done d
    where d.c_result > 0
  ),
  runs as (
    select min(i.m_start) as r_from, max(i.m_start) as r_to, count(*)::int as r_months
    from islands i
    group by i.i_group
  ),
  days as (
    select gs::date as g_day, coalesce(b.d_revenue, 0)::bigint as g_revenue, coalesce(b.d_count, 0) as g_count
    from generate_series(coalesce(v_first_day, v_today), v_today, interval '1 day') gs
    left join by_day b on b.d_day = gs::date
  ),
  windows as (
    select
      g.g_day as w_to,
      sum(g.g_revenue) over w as w_revenue,
      sum(g.g_count) over w as w_count,
      count(*) over w as w_days
    from days g
    window w as (order by g.g_day rows between 9 preceding and current row)
  )
  select jsonb_build_object(
    'current_month', v_current,
    'months', (select count(*) from months),
    'best_month', (
      select jsonb_build_object('month_start', d.m_start, 'revenue', d.c_revenue, 'order_count', d.c_count)
      from done d where d.c_revenue > 0 order by d.c_revenue desc, d.m_start limit 1
    ),
    'best_result_month', (
      select jsonb_build_object('month_start', d.m_start, 'result', d.c_result)
      from done d order by d.c_result desc, d.m_start limit 1
    ),
    'best_day', (
      select jsonb_build_object('day', b.d_day, 'revenue', b.d_revenue, 'order_count', b.d_count)
      from by_day b where b.d_revenue > 0 order by b.d_revenue desc, b.d_day limit 1
    ),
    'best_ten_days', (
      select jsonb_build_object(
        'from', w.w_to - 9, 'to', w.w_to, 'revenue', w.w_revenue::bigint, 'order_count', w.w_count::int
      )
      from windows w
      where v_first_day is not null and w.w_days = 10 and w.w_revenue > 0
      order by w.w_revenue desc, w.w_to
      limit 1
    ),
    'longest_run', (
      select jsonb_build_object('months', r.r_months, 'from', r.r_from, 'to', r.r_to)
      from runs r order by r.r_months desc, r.r_from limit 1
    ),
    'current_run', coalesce((
      select r.r_months from runs r where r.r_to = (v_current - interval '1 month')::date
    ), 0),
    'current', (
      select jsonb_build_object('revenue', c.c_revenue, 'order_count', c.c_count) from cash c where c.m_start = v_current
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.finance_records() from public, anon;
grant execute on function public.finance_records() to authenticated;
