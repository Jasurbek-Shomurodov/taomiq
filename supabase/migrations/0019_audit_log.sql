-- Audit log: who changed money, payroll, the team, the settings and the catalogue prices, and when, kept by the
-- database itself; plus one owner-only feed that lists those changes together with the month closes (0015,
-- finance_close_log) and the order changes (0018, order_events) by time.
-- Plan: docs/plans/zarkebab-feature-port.md, slice 3.
--
-- Additive only. No existing table, column, row, policy, trigger, function or grant is changed or dropped:
--   1. New table public.audit_log (append-only). RLS on; the owner may read it (private.is_owner()); no client may
--      insert, update or delete: rows are written only by the triggers in 3. service_role (the server's secret key)
--      keeps select only: insert, update, delete and truncate are revoked from it. A row guard trigger keeps the log
--      append-only for every role (the only update let through is the "on delete set null" of a removed account), as
--      finance_close_log does in 0015, and a statement trigger refuses TRUNCATE.
--   2. New private helpers: write_audit (the one insert, with the actor and a name snapshot; security definer, so it
--      writes as its owner, the migration role postgres, not as service_role), audit_changes (old → new of the listed
--      fields that changed), audit_text (the searchable values of a summary: no ids, uuids or ISO dates) and
--      audit_matches (the feed's search rule).
--   3. New after-insert-or-update-or-delete triggers (security definer, so they can write the log no client can). Each
--      is named <table>_audit; the tables' existing triggers are all BEFORE triggers (the closed-month guards of 0015
--      raise before a row changes, so a refused write logs nothing) and AFTER triggers fire only once the row change
--      succeeded. The actor is auth.uid(), which inside the security definer functions that write some of these rows
--      (approve_staff_request, set_staff_role, remove_staff, decline_staff_request; 0008, 0012) is still the caller:
--        finance_entries         added / deleted (the full summary is kept, so a deletion is never silent); changed
--                                for any other update of a tracked field (no client updates exist today)
--        finance_salary_events   added / deleted / changed
--        finance_salary_rates    added / deleted / changed
--        finance_employees       added; ended / resumed (ended_at set or cleared); renamed; changed (job title, first
--                                day, a moved last day); deleted
--        staff                   approved (added by the owner: approve_staff_request), added (no signed-in actor: the
--                                first owner, set up by hand); role_changed; removed
--        staff_requests          declined (pending → declined). An approval is logged by the staff insert above, and
--                                a request removed with its account is not an owner action.
--        settings                added / changed / deleted, with the key's old and new value. The finance_* keys are
--                                included (the log is owner-only). A key that looks secret (secret, token, password,
--                                api key, private) or a value over 1000 characters is logged without its value.
--        programs                added / deleted; changed only when its name or its visibility (active) changed
--        program_variants        added / deleted; changed only when its price per day or its visibility changed
--        durations               added / deleted; changed only when its markup or its trial flag changed
--      Summaries hold the fields a person needs to recognise the row (amount, category, day, employee or staff name,
--      the staff member's email, old → new value). Never a customer's name, phone or address, never a free-text note
--      of a ledger entry; the note of a payroll bonus or fine (its reason) is kept, cut to 200 characters.
--   4. New partial index order_events_audit_at on public.order_events for the order changes the feed shows.
--   5. New function public.audit_feed(p_area, p_search, p_before, p_before_key, p_limit): owner only (raises not_owner,
--      42501, for anyone else), executable by authenticated. Order events are read here too, so through this function
--      they are owner-only (managers keep seeing them on the order page, 0018). The order rows carry the order number,
--      the cancel reason, the names of the edited fields and the payment methods, never the edited values.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0008, 0013, 0015 and 0018: the owner check is the first statement of the public function.

-- ---------- 1. audit_log ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  -- A snapshot (staff name, else the account email), so the log survives a removed team member.
  actor_name text not null default '' check (char_length(actor_name) <= 320),
  area text not null check (area in ('finance', 'payroll', 'team', 'settings', 'catalog')),
  action text not null check (action in (
    'added', 'changed', 'deleted', 'closed', 'reopened', 'approved', 'declined', 'role_changed', 'removed',
    'ended', 'resumed', 'renamed'
  )),
  -- <table>:<id>, e.g. finance_entries:<uuid> or settings:order_cutoff_hour.
  subject text not null check (char_length(subject) between 1 and 200),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object')
);

create index audit_log_at_idx on public.audit_log (at desc, id desc);
create index audit_log_area_at_idx on public.audit_log (area, at desc, id desc);
-- The foreign key's column, so removing an account never scans the whole log.
create index audit_log_actor_idx on public.audit_log (actor) where actor is not null;

alter table public.audit_log enable row level security;

revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;
-- The server's secret key gets every new table by Supabase's default privileges; it may read the log, never write it.
-- The triggers below still write: private.write_audit is security definer and runs as its owner, the role that
-- applies the migrations (postgres, in Supabase and in scripts/test-migrations.sh), never service_role.
revoke insert, update, delete, truncate on table public.audit_log from service_role;

create policy "owner reads audit log" on public.audit_log
  for select to authenticated
  using ((select private.is_owner()));

-- Append-only for every role; the only update let through is the "on delete set null" of a removed account.
create or replace function private.guard_audit_log_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.actor is null and (to_jsonb(new) - 'actor') = (to_jsonb(old) - 'actor') then
    return new;
  end if;
  raise exception 'audit_log_append_only' using errcode = '55000';
end;
$$;

revoke all on function private.guard_audit_log_row() from public;

create trigger audit_log_guard
  before update or delete on public.audit_log
  for each row execute function private.guard_audit_log_row();

-- Row triggers do not see TRUNCATE; this statement trigger refuses it (also a TRUNCATE ... CASCADE from another table).
create or replace function private.guard_audit_log_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log_append_only' using errcode = '55000';
end;
$$;

revoke all on function private.guard_audit_log_truncate() from public;

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.guard_audit_log_truncate();

-- ---------- 2a. private.write_audit ----------
-- The one place a row is written. The actor is the signed-in user (null for the server's secret key, a migration or
-- a cascade); their name is the staff name, else their account email. Nulls are dropped from the summary.
create or replace function private.write_audit(p_area text, p_action text, p_subject text, p_summary jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_name text := '';
begin
  if v_uid is not null then
    select u.id, coalesce(nullif(btrim(s.name), ''), u.email, '')
      into v_actor, v_name
    from auth.users u
    left join public.staff s on s.user_id = u.id
    where u.id = v_uid;
  end if;

  insert into public.audit_log (actor, actor_name, area, action, subject, summary)
  values (
    v_actor,
    left(coalesce(v_name, ''), 320),
    p_area,
    p_action,
    left(p_subject, 200),
    jsonb_strip_nulls(coalesce(p_summary, '{}'::jsonb))
  );
end;
$$;

revoke all on function private.write_audit(text, text, text, jsonb) from public, anon, authenticated;

-- ---------- 2b. private.audit_changes ----------
-- { field: { from, to } } for each listed field whose value differs between the two rows (as JSON; numbers compare by
-- value, so 10 and 10.00 are the same). '{}' when none changed.
create or replace function private.audit_changes(p_old jsonb, p_new jsonb, p_fields text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(f.fld, jsonb_build_object('from', p_old -> f.fld, 'to', p_new -> f.fld)),
    '{}'::jsonb
  )
  from unnest(p_fields) as f(fld)
  where (p_old -> f.fld) is distinct from (p_new -> f.fld);
$$;

revoke all on function private.audit_changes(jsonb, jsonb, text[]) from public;

-- ---------- 2c. private.audit_text ----------
-- The strings and numbers inside a summary that a person would search for, joined by spaces. Left out, so a short
-- term such as "500" or "2026" does not match through them: the values of keys named id or ending in _id, any value
-- that is a uuid, and ISO dates and timestamps (a day is searched by audit_matches below, exactly). Recursive through
-- nested objects and arrays (the changes of an edit).
create or replace function private.audit_text(p_summary jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := '{}';
  v_item record;
  v_text text;
begin
  if p_summary is null then
    return '';
  end if;

  case jsonb_typeof(p_summary)
    when 'object' then
      for v_item in select e.key, e.value from jsonb_each(p_summary) as e loop
        continue when v_item.key = 'id' or v_item.key like '%\_id';
        v_parts := v_parts || private.audit_text(v_item.value);
      end loop;
    when 'array' then
      for v_item in select a.value from jsonb_array_elements(p_summary) as a loop
        v_parts := v_parts || private.audit_text(v_item.value);
      end loop;
    when 'string', 'number' then
      v_text := p_summary #>> '{}';
      if v_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or v_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
        return '';
      end if;
      return v_text;
    else
      return '';
  end case;

  return array_to_string(array_remove(v_parts, ''), ' ');
end;
$$;

revoke all on function private.audit_text(jsonb) from public;

-- ---------- 2d. private.audit_matches ----------
-- Whether a feed row matches a search, given the term prepared by audit_feed:
--   p_like     '%term%' (LIKE characters escaped): the actor's name and audit_text of the summary, case-insensitive
--   p_digits   a term of digits only: a substring of a number in the summary (amounts, order numbers)
--   p_uuid     a term that is a whole uuid: the id part of the subject, exactly (never a substring of the subject)
--   p_day      a term that is a day (YYYY-MM-DD, DD.MM.YYYY or DD/MM/YYYY): the row's Tashkent day, or one of the
--              summary's day fields, exactly
create or replace function private.audit_matches(
  p_actor_name text,
  p_subject text,
  p_summary jsonb,
  p_at timestamptz,
  p_like text,
  p_digits text,
  p_uuid text,
  p_day date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    coalesce(p_actor_name, '') ilike p_like
    or private.audit_text(p_summary) ilike p_like
    or (p_digits is not null and private.audit_text(p_summary) like '%' || p_digits || '%')
    or (p_uuid is not null and split_part(p_subject, ':', 2) = p_uuid)
    or (p_day is not null and (
      (p_at at time zone 'Asia/Tashkent')::date = p_day
      or exists (
        select 1
        from jsonb_each_text(p_summary) as e
        -- from / to: a day setting's old and new value (cycle_anchor).
        where e.key in ('entry_date', 'event_date', 'effective_from', 'joined_at', 'ended_at', 'was_ended_at', 'month_start',
                        'from', 'to')
          and e.value = to_char(p_day, 'YYYY-MM-DD')
      )
    ));
$$;

revoke all on function private.audit_matches(text, text, jsonb, timestamptz, text, text, text, date) from public;

-- ---------- 3a. finance_entries ----------
create or replace function private.audit_finance_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_entries;
  v_summary jsonb;
  v_changes jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  v_summary := jsonb_build_object(
    'entry_id', v_row.id,
    'entry_type', v_row.entry_type,
    'category', v_row.category,
    'amount', v_row.amount,
    'entry_date', v_row.entry_date,
    'payment_method', v_row.payment_method,
    'counterparty', left(nullif(btrim(coalesce(v_row.counterparty, '')), ''), 120)
  );

  if tg_op = 'INSERT' then
    perform private.write_audit('finance', 'added', 'finance_entries:' || v_row.id, v_summary);
  elsif tg_op = 'DELETE' then
    perform private.write_audit('finance', 'deleted', 'finance_entries:' || v_row.id, v_summary);
  else
    v_changes := private.audit_changes(
      to_jsonb(old), to_jsonb(new),
      array['entry_type', 'entry_date', 'category', 'payment_method', 'amount', 'counterparty']
    );
    if v_changes <> '{}'::jsonb then
      perform private.write_audit(
        'finance', 'changed', 'finance_entries:' || v_row.id, v_summary || jsonb_build_object('changes', v_changes)
      );
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.audit_finance_entry() from public;

create trigger finance_entries_audit
  after insert or update or delete on public.finance_entries
  for each row execute function private.audit_finance_entry();

-- ---------- 3b. finance_salary_events ----------
create or replace function private.audit_salary_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_salary_events;
  v_name text;
  v_summary jsonb;
  v_changes jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  select e.name into v_name from public.finance_employees e where e.id = v_row.employee_id;

  v_summary := jsonb_build_object(
    'event_id', v_row.id,
    'employee_id', v_row.employee_id,
    'employee_name', v_name,
    'kind', v_row.kind,
    'amount', v_row.amount,
    'event_date', v_row.event_date,
    'payment_method', v_row.payment_method,
    -- The reason of a fine or a bonus; a payment's or an absence's note is not kept.
    'note', case when v_row.kind in ('bonus', 'fine') then left(nullif(btrim(coalesce(v_row.note, '')), ''), 200) end
  );

  if tg_op = 'INSERT' then
    perform private.write_audit('payroll', 'added', 'finance_salary_events:' || v_row.id, v_summary);
  elsif tg_op = 'DELETE' then
    perform private.write_audit('payroll', 'deleted', 'finance_salary_events:' || v_row.id, v_summary);
  else
    v_changes := private.audit_changes(
      to_jsonb(old), to_jsonb(new),
      array['employee_id', 'kind', 'event_date', 'amount', 'payment_method']
    );
    if v_changes <> '{}'::jsonb then
      perform private.write_audit(
        'payroll', 'changed', 'finance_salary_events:' || v_row.id, v_summary || jsonb_build_object('changes', v_changes)
      );
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.audit_salary_event() from public;

create trigger finance_salary_events_audit
  after insert or update or delete on public.finance_salary_events
  for each row execute function private.audit_salary_event();

-- ---------- 3c. finance_salary_rates ----------
create or replace function private.audit_salary_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.finance_salary_rates;
  v_name text;
  v_summary jsonb;
  v_changes jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  select e.name into v_name from public.finance_employees e where e.id = v_row.employee_id;

  v_summary := jsonb_build_object(
    'rate_id', v_row.id,
    'employee_id', v_row.employee_id,
    'employee_name', v_name,
    'amount', v_row.amount,
    'rate_unit', v_row.rate_unit,
    'effective_from', v_row.effective_from
  );

  if tg_op = 'INSERT' then
    perform private.write_audit('payroll', 'added', 'finance_salary_rates:' || v_row.id, v_summary);
  elsif tg_op = 'DELETE' then
    perform private.write_audit('payroll', 'deleted', 'finance_salary_rates:' || v_row.id, v_summary);
  else
    v_changes := private.audit_changes(
      to_jsonb(old), to_jsonb(new),
      array['employee_id', 'effective_from', 'amount', 'rate_unit']
    );
    if v_changes <> '{}'::jsonb then
      perform private.write_audit(
        'payroll', 'changed', 'finance_salary_rates:' || v_row.id, v_summary || jsonb_build_object('changes', v_changes)
      );
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.audit_salary_rate() from public;

create trigger finance_salary_rates_audit
  after insert or update or delete on public.finance_salary_rates
  for each row execute function private.audit_salary_rate();

-- ---------- 3d. finance_employees ----------
-- One row per kind of change in an update: renamed, then ended / resumed / a moved last day, then other fields.
create or replace function private.audit_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject text;
  v_base jsonb;
  v_changes jsonb;
begin
  if tg_op = 'DELETE' then
    perform private.write_audit(
      'payroll', 'deleted', 'finance_employees:' || old.id,
      jsonb_build_object('employee_id', old.id, 'employee_name', old.name, 'joined_at', old.joined_at)
    );
    return null;
  end if;

  v_subject := 'finance_employees:' || new.id;
  v_base := jsonb_build_object('employee_id', new.id, 'employee_name', new.name);

  if tg_op = 'INSERT' then
    perform private.write_audit(
      'payroll', 'added', v_subject,
      v_base || jsonb_build_object('job_title', new.job_title, 'joined_at', new.joined_at, 'ended_at', new.ended_at)
    );
    return null;
  end if;

  if new.name is distinct from old.name then
    perform private.write_audit(
      'payroll', 'renamed', v_subject, v_base || jsonb_build_object('from', old.name, 'to', new.name)
    );
  end if;

  if new.ended_at is distinct from old.ended_at then
    if old.ended_at is null then
      perform private.write_audit('payroll', 'ended', v_subject, v_base || jsonb_build_object('ended_at', new.ended_at));
    elsif new.ended_at is null then
      perform private.write_audit('payroll', 'resumed', v_subject, v_base || jsonb_build_object('was_ended_at', old.ended_at));
    else
      perform private.write_audit(
        'payroll', 'changed', v_subject,
        v_base || jsonb_build_object('changes', private.audit_changes(to_jsonb(old), to_jsonb(new), array['ended_at']))
      );
    end if;
  end if;

  v_changes := private.audit_changes(to_jsonb(old), to_jsonb(new), array['job_title', 'joined_at']);
  if v_changes <> '{}'::jsonb then
    perform private.write_audit('payroll', 'changed', v_subject, v_base || jsonb_build_object('changes', v_changes));
  end if;

  return null;
end;
$$;

revoke all on function private.audit_employee() from public;

create trigger finance_employees_audit
  after insert or update or delete on public.finance_employees
  for each row execute function private.audit_employee();

-- ---------- 3e. staff ----------
-- The email comes from auth.users (staff has none); on a removal together with the account it may already be gone.
create or replace function private.audit_staff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user uuid;
  v_email text;
  v_base jsonb;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
  else
    v_user := new.user_id;
  end if;
  select u.email into v_email from auth.users u where u.id = v_user;

  if tg_op = 'INSERT' then
    v_base := jsonb_build_object('user_id', new.user_id, 'name', nullif(btrim(new.name), ''), 'email', v_email, 'role', new.role);
    -- approve_staff_request is the only way the owner adds someone; a row added with no signed-in actor (the first
    -- owner, set up by hand) is "added".
    perform private.write_audit(
      'team',
      case when v_uid is not null and v_uid <> new.user_id then 'approved' else 'added' end,
      'staff:' || new.user_id,
      v_base
    );
  elsif tg_op = 'DELETE' then
    perform private.write_audit(
      'team', 'removed', 'staff:' || old.user_id,
      jsonb_build_object('user_id', old.user_id, 'name', nullif(btrim(old.name), ''), 'email', v_email, 'role', old.role)
    );
  elsif new.role is distinct from old.role then
    perform private.write_audit(
      'team', 'role_changed', 'staff:' || new.user_id,
      jsonb_build_object(
        'user_id', new.user_id, 'name', nullif(btrim(new.name), ''), 'email', v_email, 'from', old.role, 'to', new.role
      )
    );
  end if;
  return null;
end;
$$;

revoke all on function private.audit_staff() from public;

create trigger staff_audit
  after insert or update or delete on public.staff
  for each row execute function private.audit_staff();

-- ---------- 3f. staff_requests ----------
create or replace function private.audit_staff_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'declined' and old.status is distinct from 'declined' then
    perform private.write_audit(
      'team', 'declined', 'staff_requests:' || new.user_id,
      jsonb_build_object('user_id', new.user_id, 'name', nullif(btrim(new.name), ''), 'email', new.email)
    );
  end if;
  return null;
end;
$$;

revoke all on function private.audit_staff_request() from public;

create trigger staff_requests_audit
  after update on public.staff_requests
  for each row execute function private.audit_staff_request();

-- ---------- 3g. settings ----------
create or replace function private.audit_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_hidden boolean;
  v_summary jsonb;
begin
  if tg_op = 'DELETE' then
    v_key := old.key;
  else
    v_key := new.key;
  end if;

  if tg_op = 'UPDATE' and new.value is not distinct from old.value and new.key = old.key then
    return null;
  end if;

  v_hidden := v_key ~* '(secret|token|password|passwd|api_?key|private)'
    or (tg_op <> 'INSERT' and char_length(old.value::text) > 1000)
    or (tg_op <> 'DELETE' and char_length(new.value::text) > 1000);

  if v_hidden then
    v_summary := jsonb_build_object('key', v_key, 'hidden', true);
  elsif tg_op = 'INSERT' then
    v_summary := jsonb_build_object('key', v_key, 'to', new.value);
  elsif tg_op = 'DELETE' then
    v_summary := jsonb_build_object('key', v_key, 'from', old.value);
  else
    v_summary := jsonb_build_object('key', v_key, 'from', old.value, 'to', new.value);
  end if;

  perform private.write_audit(
    'settings',
    case tg_op when 'INSERT' then 'added' when 'DELETE' then 'deleted' else 'changed' end,
    'settings:' || v_key,
    v_summary
  );
  return null;
end;
$$;

revoke all on function private.audit_setting() from public;

create trigger settings_audit
  after insert or update or delete on public.settings
  for each row execute function private.audit_setting();

-- ---------- 3h. programs ----------
create or replace function private.audit_program()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(
      'catalog', 'added', 'programs:' || new.id,
      jsonb_build_object('program_id', new.id, 'name', new.name, 'active', new.active)
    );
  elsif tg_op = 'DELETE' then
    perform private.write_audit(
      'catalog', 'deleted', 'programs:' || old.id,
      jsonb_build_object('program_id', old.id, 'name', old.name, 'active', old.active)
    );
  else
    v_changes := private.audit_changes(to_jsonb(old), to_jsonb(new), array['name', 'active']);
    if v_changes <> '{}'::jsonb then
      perform private.write_audit(
        'catalog', 'changed', 'programs:' || new.id,
        jsonb_build_object('program_id', new.id, 'name', new.name, 'active', new.active, 'changes', v_changes)
      );
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.audit_program() from public;

create trigger programs_audit
  after insert or update or delete on public.programs
  for each row execute function private.audit_program();

-- ---------- 3i. program_variants ----------
-- saveProgram writes every level of a program on each save; only a real change of price or visibility is logged.
create or replace function private.audit_program_variant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.program_variants;
  v_program text;
  v_summary jsonb;
  v_changes jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;

  -- On a program removed with its levels, the program is already gone: no name then.
  select p.name into v_program from public.programs p where p.id = v_row.program_id;

  v_summary := jsonb_build_object(
    'variant_id', v_row.id,
    'program_id', v_row.program_id,
    'program_name', v_program,
    'kcal', v_row.kcal,
    'price_per_day', v_row.price_per_day,
    'active', v_row.active
  );

  if tg_op = 'INSERT' then
    perform private.write_audit('catalog', 'added', 'program_variants:' || v_row.id, v_summary);
  elsif tg_op = 'DELETE' then
    perform private.write_audit('catalog', 'deleted', 'program_variants:' || v_row.id, v_summary);
  else
    v_changes := private.audit_changes(to_jsonb(old), to_jsonb(new), array['price_per_day', 'active']);
    if v_changes <> '{}'::jsonb then
      perform private.write_audit(
        'catalog', 'changed', 'program_variants:' || v_row.id, v_summary || jsonb_build_object('changes', v_changes)
      );
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.audit_program_variant() from public;

create trigger program_variants_audit
  after insert or update or delete on public.program_variants
  for each row execute function private.audit_program_variant();

-- ---------- 3j. durations ----------
-- saveDurations writes every duration on each save; only a real change of markup or trial flag is logged.
create or replace function private.audit_duration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(
      'catalog', 'added', 'durations:' || new.days,
      jsonb_build_object('days', new.days, 'markup_pct', new.markup_pct, 'is_trial', new.is_trial)
    );
  elsif tg_op = 'DELETE' then
    perform private.write_audit(
      'catalog', 'deleted', 'durations:' || old.days,
      jsonb_build_object('days', old.days, 'markup_pct', old.markup_pct, 'is_trial', old.is_trial)
    );
  else
    v_changes := private.audit_changes(to_jsonb(old), to_jsonb(new), array['days', 'markup_pct', 'is_trial']);
    if v_changes <> '{}'::jsonb then
      perform private.write_audit(
        'catalog', 'changed', 'durations:' || new.days,
        jsonb_build_object('days', new.days, 'markup_pct', new.markup_pct, 'is_trial', new.is_trial, 'changes', v_changes)
      );
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.audit_duration() from public;

create trigger durations_audit
  after insert or update or delete on public.durations
  for each row execute function private.audit_duration();

-- ---------- 4. order changes the feed shows ----------
-- The same predicate as the order source of audit_feed below, so the planner can use it.
create index order_events_audit_at on public.order_events (at desc, id desc)
  where kind in ('edited', 'payment_method') or (kind = 'status' and to_status = 'cancelled');

-- ---------- 5. audit_feed ----------
-- One time-ordered list, newest first, of three sources:
--   audit_log           (key 'l…') areas finance, payroll, team, settings, catalog
--   finance_close_log   (key 'c…') area finance, action closed | reopened, subject finance_month_closes:<month>,
--                       summary { month_start, result, reason }
--   order_events        (key 'o…') area orders: a cancellation (action cancelled, summary { order_id, number, reason }),
--                       an edit (edited, { order_id, number, fields: [names], account_unlinked }) and a payment
--                       method change (payment_changed, { order_id, number, from, to })
-- Arguments:
--   p_area        null = every area; else finance | payroll | team | settings | catalog | orders (bad_area, 22023)
--   p_search      trimmed, at most 60 characters, matched by private.audit_matches: case-insensitive substring of the
--                 actor's name and of the summary's searchable values (audit_text: no ids, uuids or ISO dates); a term
--                 of digits (spaces, dots, commas, # and № ignored, as in "1 500 000" or "#123") also matches amounts
--                 and order numbers by their digits; a whole uuid matches the subject's id exactly; a day
--                 (2026-11-25, 25.11.2026, 25/11/2026) matches the row's Tashkent day or a day field of the summary.
--   p_before, p_before_key   the cursor: only rows older than the row (at, item_key) given, for "older" paging. The
--                 key breaks ties between rows of one instant (one transaction writes several), so no row is skipped.
--   p_limit       1..201 rows (100 by default); ask for one more than a page to know whether an older page exists.
-- target_exists says whether the page a row links to still has its record (the ledger entry, the employee, the team
-- member or request, the program, level or duration, the order); settings and month closes always link.
--
-- Index use: each source has a plain upper time bound (at <= the cursor, 'infinity' without one) beside the tie-break,
-- so a range scan of the (at desc, id desc) indexes starts at the cursor; audit_log is read in two branches, every area
-- (p_area null: audit_log_at_idx) or one area (audit_log_area_at_idx), and the branch that does not apply is skipped by
-- its constant filter.
create or replace function public.audit_feed(
  p_area text default null,
  p_search text default null,
  p_before timestamptz default null,
  p_before_key text default null,
  p_limit int default 100
)
returns table (
  item_key text,
  at timestamptz,
  actor uuid,
  actor_name text,
  area text,
  action text,
  subject text,
  summary jsonb,
  target_exists boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 201);
  v_search text := left(btrim(coalesce(p_search, '')), 60);
  v_bound timestamptz := coalesce(p_before, 'infinity'::timestamptz);
  v_key text := coalesce(p_before_key, '');
  v_like text;
  v_digits text;
  v_uuid text;
  v_day date;
  v_parts text[];
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  if p_area is not null and p_area not in ('finance', 'payroll', 'team', 'settings', 'catalog', 'orders') then
    raise exception 'bad_area' using errcode = '22023';
  end if;

  if v_search <> '' then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';

    if v_search ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_uuid := lower(v_search);
    elsif v_search ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
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

    if v_uuid is null and v_day is null
       and regexp_replace(v_search, '[[:space:].,#№' || chr(160) || chr(8239) || ']', '', 'g') ~ '^[0-9]+$' then
      v_digits := regexp_replace(v_search, '[^0-9]', '', 'g');
    end if;
  end if;

  return query
    with lg as (
      (
        select
          'l' || lpad(a.id::text, 19, '0') as k,
          a.at as t_at,
          a.actor as t_actor,
          a.actor_name as t_actor_name,
          a.area as t_area,
          a.action as t_action,
          a.subject as t_subject,
          a.summary as t_summary
        from public.audit_log a
        where p_area is null
          and a.at <= v_bound
          and (p_before is null or a.at < p_before or (a.at = p_before and 'l' || lpad(a.id::text, 19, '0') < v_key))
          and (v_like is null
               or private.audit_matches(a.actor_name, a.subject, a.summary, a.at, v_like, v_digits, v_uuid, v_day))
        order by a.at desc, a.id desc
        limit v_limit
      )
      union all
      (
        select
          'l' || lpad(a.id::text, 19, '0') as k,
          a.at as t_at,
          a.actor as t_actor,
          a.actor_name as t_actor_name,
          a.area as t_area,
          a.action as t_action,
          a.subject as t_subject,
          a.summary as t_summary
        from public.audit_log a
        where a.area = p_area
          and a.at <= v_bound
          and (p_before is null or a.at < p_before or (a.at = p_before and 'l' || lpad(a.id::text, 19, '0') < v_key))
          and (v_like is null
               or private.audit_matches(a.actor_name, a.subject, a.summary, a.at, v_like, v_digits, v_uuid, v_day))
        order by a.at desc, a.id desc
        limit v_limit
      )
    ),
    cl as (
      select x.*
      from (
        select
          'c' || lpad(c.id::text, 19, '0') as k,
          c.at as t_at,
          c.actor as t_actor,
          coalesce(c.actor_name, '') as t_actor_name,
          'finance'::text as t_area,
          c.action as t_action,
          'finance_month_closes:' || c.month_start::text as t_subject,
          jsonb_strip_nulls(jsonb_build_object('month_start', c.month_start, 'result', c.result, 'reason', c.reason))
            as t_summary
        from public.finance_close_log c
        where (p_area is null or p_area = 'finance')
          and c.at <= v_bound
          and (p_before is null or c.at < p_before or (c.at = p_before and 'c' || lpad(c.id::text, 19, '0') < v_key))
      ) x
      where v_like is null
        or private.audit_matches(x.t_actor_name, x.t_subject, x.t_summary, x.t_at, v_like, v_digits, v_uuid, v_day)
      order by x.t_at desc, x.k desc
      limit v_limit
    ),
    oe as (
      select x.*
      from (
        select
          'o' || lpad(e.id::text, 19, '0') as k,
          e.at as t_at,
          e.actor as t_actor,
          e.actor_name as t_actor_name,
          'orders'::text as t_area,
          case e.kind when 'status' then 'cancelled' when 'edited' then 'edited' else 'payment_changed' end as t_action,
          'orders:' || e.order_id::text as t_subject,
          jsonb_strip_nulls(jsonb_build_object(
            'order_id', e.order_id,
            'number', o.number,
            'reason', case when e.kind = 'status' then e.detail ->> 'reason' end,
            'fields', case when e.kind = 'edited' then (
              select coalesce(jsonb_agg(f.fld order by f.fld), '[]'::jsonb)
              from jsonb_object_keys(e.detail) as f(fld)
              where f.fld <> 'account_unlinked'
            ) end,
            'account_unlinked', case when e.kind = 'edited' and e.detail ? 'account_unlinked' then true end,
            'from', case when e.kind = 'payment_method' then e.detail -> 'from' end,
            'to', case when e.kind = 'payment_method' then e.detail -> 'to' end
          )) as t_summary
        from public.order_events e
        left join public.orders o on o.id = e.order_id
        where (p_area is null or p_area = 'orders')
          and (e.kind in ('edited', 'payment_method') or (e.kind = 'status' and e.to_status = 'cancelled'))
          and e.at <= v_bound
          and (p_before is null or e.at < p_before or (e.at = p_before and 'o' || lpad(e.id::text, 19, '0') < v_key))
      ) x
      where v_like is null
        or private.audit_matches(x.t_actor_name, x.t_subject, x.t_summary, x.t_at, v_like, v_digits, v_uuid, v_day)
      order by x.t_at desc, x.k desc
      limit v_limit
    ),
    u as (
      select * from lg
      union all
      select * from cl
      union all
      select * from oe
    )
    select
      u.k,
      u.t_at,
      u.t_actor,
      u.t_actor_name,
      u.t_area,
      u.t_action,
      u.t_subject,
      u.t_summary,
      case split_part(u.t_subject, ':', 1)
        when 'finance_entries' then exists (
          select 1 from public.finance_entries f where f.id = split_part(u.t_subject, ':', 2)::uuid
        )
        when 'finance_salary_events' then exists (
          select 1 from public.finance_employees m where m.id = (u.t_summary ->> 'employee_id')::uuid
        )
        when 'finance_salary_rates' then exists (
          select 1 from public.finance_employees m where m.id = (u.t_summary ->> 'employee_id')::uuid
        )
        when 'finance_employees' then exists (
          select 1 from public.finance_employees m where m.id = split_part(u.t_subject, ':', 2)::uuid
        )
        when 'staff' then exists (
          select 1 from public.staff s where s.user_id = split_part(u.t_subject, ':', 2)::uuid
        )
        when 'staff_requests' then (
          exists (select 1 from public.staff_requests r where r.user_id = split_part(u.t_subject, ':', 2)::uuid)
          or exists (select 1 from public.staff s where s.user_id = split_part(u.t_subject, ':', 2)::uuid)
        )
        when 'settings' then true
        when 'programs' then exists (
          select 1 from public.programs p where p.id = split_part(u.t_subject, ':', 2)::uuid
        )
        when 'program_variants' then exists (
          select 1 from public.program_variants v where v.id = split_part(u.t_subject, ':', 2)::uuid
        )
        when 'durations' then exists (
          select 1 from public.durations d where d.days = split_part(u.t_subject, ':', 2)::int
        )
        when 'finance_month_closes' then true
        when 'orders' then exists (
          select 1 from public.orders o where o.id = split_part(u.t_subject, ':', 2)::uuid
        )
        else false
      end
    from u
    order by u.t_at desc, u.k desc
    limit v_limit;
end;
$$;

revoke all on function public.audit_feed(text, text, timestamptz, text, int) from public, anon;
grant execute on function public.audit_feed(text, text, timestamptz, text, int) to authenticated;
