-- Telegram, round two (owner group events and the morning digest): a database-first outbox for messages to the owner's
-- Telegram group, written inside the same transaction as the change that causes them, delivered by the server after
-- the response (src/lib/telegram/drain.ts) and by a daily scheduled call (src/app/api/telegram/daily/route.ts).
-- Plan: docs/plans/zarkebab-feature-port.md, slice 9a.
--
-- Additive only. No existing table, column, row, policy, trigger, function or grant is changed or dropped:
--   1. New table public.telegram_outbox. RLS on; the owner may read it (private.is_owner()); no client may insert,
--      update or delete, and service_role (the server's secret key) keeps select only: every write goes through the
--      security definer functions below. A row holds facts only (payload), never a sentence: the app renders the text
--      in the language the owner chose.
--   2. public.settings gets a new restrictive select policy (telegram_* rows are readable by the owner only; every
--      other row reads exactly as before, as the finance_* policy of 0015 does) and a new check trigger
--      settings_check_telegram for the two keys:
--        telegram_owner_kinds   a JSON object of booleans per kind (finance, investor, purchase, order, payroll, close,
--                               team, digest). A kind missing from it uses its default: on, except payroll and team.
--        telegram_owner_locale  "ru", "uz" or "uzc" (ru when not set)
--      No settings row is written here.
--   3. New private helpers: telegram_kind_on (the owner's switch for a kind), telegram_actor (a staff name fit to send:
--      null when empty or when it is an email, the fallback name of the audit trails), telegram_changed_fields (the
--      names of the changed fields of a summary, never their values) and telegram_enqueue (the one insert; nothing for
--      a switched-off kind; on conflict of dedupe_key nothing).
--   4. New AFTER INSERT triggers (security definer, so they can write the outbox no client can), one outbox row per
--      source row, dedupe_key '<source>:<id>':
--        audit_log_telegram          audit_log (0019) areas finance (kind finance, or investor for investor money),
--                                    payroll and team. Ledger rows that mirror a purchase are left out (the purchase
--                                    event below is the message).
--        purchase_events_telegram    purchase_events (0022), kind purchase. On an added purchase it also removes the
--                                    pending finance row its own ledger entry queued a moment earlier in the same
--                                    transaction, so one purchase is one message.
--        finance_close_log_telegram  finance_close_log (0015), kind close.
--        order_events_telegram       order_events (0018), kind order: a move to paid or to cancelled, an edit (the names
--                                    of the edited fields only) and a payment method change.
--      Each payload is built from an explicit list of fields (below, per trigger), never by copying a summary: no
--      customer name, phone, address, comment or exclusions; no free text typed by staff (cancel reason, ledger
--      counterparty or note, purchase note, payroll note, close reason); no email.
--      EVERY TRIGGER BODY IS WRAPPED IN AN EXCEPTION BLOCK THAT SWALLOWS ANY ERROR: a failure here never fails or rolls
--      back the owner's change (the block's savepoint undoes only the outbox write). These source tables are written
--      many times a day, two of them behind append-only guards, so a raise here would block the business.
--   5. New functions for the server (execute for service_role only; revoked from public, anon and authenticated):
--        telegram_claim(p_limit)              first skips pending rows due for more than 24 hours (expired) and turns
--                                             sending rows whose lease ran out into uncertain (they may have been
--                                             delivered); then takes up to p_limit (1..20) due pending rows, marks them
--                                             sending with a 2-minute lease (for update skip locked) and returns them
--                                             with that lease_until, the claim token
--        telegram_finish(p_id, p_lease, p_status, p_error, p_retry_after)  applies only with the row's current claim
--                                             token; sent | failed | uncertain | skipped | retry (back to pending after
--                                             a growing gap, or after Telegram's retry_after; failed after the 5th
--                                             attempt) | release (back to pending, the attempt not counted)
--        telegram_drain_begin(p_seconds), telegram_drain_end(p_token)   one drain at a time: a "running until" mark in
--                                             the new private.telegram_drain_lock (one row, RLS on, no grants)
--        telegram_expire()                    pending rows due for more than 24 hours → skipped
--        daily_digest(p_day)                  the figures of the morning digest for the Tashkent day p_day (no personal
--                                             data)
--        telegram_queue_digest(p_day)         queues the digest of p_day once (dedupe_key 'digest:<day>'), when the
--                                             owner's digest switch is on
--   6. New functions for the owner (each raises not_owner, 42501, for anyone else; executable by authenticated):
--        telegram_resend(p_id)      a failed or uncertain row back to pending, with a fresh attempt count
--        telegram_skip_pending()    "Start from now": every pending row skipped
--        telegram_status()          counts by status for the last 7 days, pending and waiting-to-retry counts, the
--                                   latest 20 rows
--        telegram_test()            queues one test message (at most one per 30 seconds)
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0008, 0013, 0015, 0018 and 0019: the owner check is the first statement of each owner function.

-- ---------- 1. telegram_outbox ----------
create table public.telegram_outbox (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('finance', 'investor', 'purchase', 'order', 'payroll', 'close', 'team', 'digest', 'test')),
  -- '<source>:<id>' (audit:12, purchase:5, close:3, order:40), 'digest:<day>' or 'test:<30-second slot>'.
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'uncertain', 'skipped')),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  -- A short code (http_400, timeout, network, lease_expired, not_configured, expired), never a response body.
  last_error text check (char_length(last_error) <= 60),
  sent_at timestamptz
);

create index telegram_outbox_due_idx on public.telegram_outbox (status, next_attempt_at);
create index telegram_outbox_created_idx on public.telegram_outbox (created_at desc);

alter table public.telegram_outbox enable row level security;

revoke all on table public.telegram_outbox from anon, authenticated;
grant select on table public.telegram_outbox to authenticated;
-- As audit_log (0019): the server's secret key may read the outbox, never write it directly; the functions below write.
revoke insert, update, delete, truncate on table public.telegram_outbox from service_role;

create policy "owner reads telegram outbox" on public.telegram_outbox
  for select to authenticated
  using ((select private.is_owner()));

-- ---------- 2. telegram settings ----------
create policy "telegram settings owner only" on public.settings
  as restrictive
  for select to anon, authenticated
  using (key not like 'telegram\_%' or (select private.is_owner()));

create or replace function private.check_telegram_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
begin
  if new.key not like 'telegram\_%' then
    return new;
  end if;

  if new.key = 'telegram_owner_kinds' then
    if jsonb_typeof(new.value) <> 'object' then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;
    for v_item in select e.key, e.value from jsonb_each(new.value) as e loop
      if v_item.key not in ('finance', 'investor', 'purchase', 'order', 'payroll', 'close', 'team', 'digest')
         or jsonb_typeof(v_item.value) <> 'boolean' then
        raise exception 'bad_setting' using errcode = '23514', detail = new.key;
      end if;
    end loop;
  elsif new.key = 'telegram_owner_locale' then
    if jsonb_typeof(new.value) <> 'string' or (new.value #>> '{}') not in ('ru', 'uz', 'uzc') then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;
  else
    raise exception 'unknown_telegram_setting' using errcode = '23514', detail = new.key;
  end if;

  return new;
end;
$$;

revoke all on function private.check_telegram_setting() from public;

create trigger settings_check_telegram
  before insert or update on public.settings
  for each row execute function private.check_telegram_setting();

-- ---------- 3. helpers ----------
-- The owner's switch for a kind: the stored boolean, else the default (on, except payroll and team). test is always on.
create or replace function private.telegram_kind_on(p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_kind = 'test' or coalesce(
    (
      select case when jsonb_typeof(s.value -> p_kind) = 'boolean' then (s.value ->> p_kind)::boolean end
      from public.settings s
      where s.key = 'telegram_owner_kinds' and jsonb_typeof(s.value) = 'object'
    ),
    p_kind in ('finance', 'investor', 'purchase', 'order', 'close', 'digest')
  );
$$;

revoke all on function private.telegram_kind_on(text) from public, anon, authenticated;

-- A staff name fit for a message: the audit trails fall back to the account email when a person has no staff name
-- (0019 write_audit, 0022 write_purchase_event), and an email is never sent.
create or replace function private.telegram_actor(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name is null or btrim(p_name) = '' or position('@' in p_name) > 0 then null
    else left(btrim(p_name), 120)
  end;
$$;

revoke all on function private.telegram_actor(text) from public, anon, authenticated;

-- The names of the changed fields of a summary's `changes` object ({ field: { from, to } }), sorted; never the values.
create or replace function private.telegram_changed_fields(p_changes jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_changes) = 'object' then (
    select jsonb_agg(k.key order by k.key) from jsonb_object_keys(p_changes) as k(key)
  ) end;
$$;

revoke all on function private.telegram_changed_fields(jsonb) from public, anon, authenticated;

-- The one insert. Nothing for a switched-off kind; a second row with the same dedupe_key is not written.
create or replace function private.telegram_enqueue(p_kind text, p_dedupe_key text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.telegram_kind_on(p_kind) then
    return;
  end if;
  insert into public.telegram_outbox (kind, dedupe_key, payload)
  values (p_kind, p_dedupe_key, jsonb_strip_nulls(coalesce(p_payload, '{}'::jsonb)))
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke all on function private.telegram_enqueue(text, text, jsonb) from public, anon, authenticated;

-- ---------- 4a. audit_log → finance, investor, payroll, team ----------
-- Payload whitelist:
--   finance / investor  action, entry_id (to match a purchase's ledger row), entry_type, category, amount, entry_date,
--                       payment_method, fields (names of changed fields), actor.   Not sent: counterparty (who paid or
--                       was paid, typed by staff; for investor money the investor's name), the note.
--   payroll             action, record (event | rate | employee), employee_name, event_kind, amount, event_date,
--                       payment_method, rate_unit, effective_from, joined_at, ended_at, fields, actor.   Not sent: the
--                       note of a bonus or fine, the job title, the old name of a rename.
--   team                action, name (staff name), role, from_role, to_role, actor.   Not sent: the email.
create or replace function private.telegram_from_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_entry text;
  v_record text;
  v_payload jsonb;
begin
  begin
    if new.area = 'finance' and split_part(new.subject, ':', 1) = 'finance_entries' then
      v_entry := new.summary ->> 'entry_id';
      -- A ledger row that mirrors a purchase (0022): purchase_save edits it with taomiq.purchase_entry set, and
      -- purchase_delete writes the purchase's event before removing it. Its message is the purchase's own.
      if coalesce(current_setting('taomiq.purchase_entry', true), '') = v_entry
         or exists (select 1 from public.purchase_events pe where pe.finance_entry_id = v_entry::uuid) then
        return null;
      end if;
      v_kind := case when new.summary ->> 'category' = 'investor_support' then 'investor' else 'finance' end;
      v_payload := jsonb_build_object(
        'action', new.action,
        'entry_id', v_entry,
        'entry_type', new.summary ->> 'entry_type',
        'category', new.summary ->> 'category',
        'amount', new.summary -> 'amount',
        'entry_date', new.summary ->> 'entry_date',
        'payment_method', new.summary ->> 'payment_method',
        'fields', private.telegram_changed_fields(new.summary -> 'changes'),
        'actor', private.telegram_actor(new.actor_name)
      );

    elsif new.area = 'payroll' then
      v_kind := 'payroll';
      v_record := case split_part(new.subject, ':', 1)
        when 'finance_salary_events' then 'event'
        when 'finance_salary_rates' then 'rate'
        when 'finance_employees' then 'employee'
      end;
      if v_record is null then
        return null;
      end if;
      v_payload := jsonb_build_object(
        'action', new.action,
        'record', v_record,
        'employee_name', private.telegram_actor(new.summary ->> 'employee_name'),
        'event_kind', new.summary ->> 'kind',
        'amount', new.summary -> 'amount',
        'event_date', new.summary ->> 'event_date',
        'payment_method', new.summary ->> 'payment_method',
        'rate_unit', new.summary ->> 'rate_unit',
        'effective_from', new.summary ->> 'effective_from',
        'joined_at', new.summary ->> 'joined_at',
        'ended_at', coalesce(new.summary ->> 'ended_at', new.summary ->> 'was_ended_at'),
        'fields', private.telegram_changed_fields(new.summary -> 'changes'),
        'actor', private.telegram_actor(new.actor_name)
      );

    elsif new.area = 'team' then
      v_kind := 'team';
      v_payload := jsonb_build_object(
        'action', new.action,
        'name', private.telegram_actor(new.summary ->> 'name'),
        'role', new.summary ->> 'role',
        'from_role', case when new.action = 'role_changed' then new.summary ->> 'from' end,
        'to_role', case when new.action = 'role_changed' then new.summary ->> 'to' end,
        'actor', private.telegram_actor(new.actor_name)
      );

    else
      return null;
    end if;

    perform private.telegram_enqueue(v_kind, 'audit:' || new.id, v_payload);
  exception
    when others then
      -- Never fail the owner's change: the savepoint of this block undoes only the outbox write.
      null;
  end;
  return null;
end;
$$;

revoke all on function private.telegram_from_audit() from public, anon, authenticated;

create trigger audit_log_telegram
  after insert on public.audit_log
  for each row execute function private.telegram_from_audit();

-- ---------- 4b. purchase_events → purchase ----------
-- Payload whitelist: action, amount (the receipt's total), day, payment_method, lines (count), buyer (the payroll
-- employee's name), fields (names of changed fields, plus lines and note when those changed), actor.   Not sent: the
-- note, the ingredient names.
create or replace function private.telegram_from_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields jsonb;
begin
  begin
    -- One purchase, one message: drop the finance row its ledger entry queued earlier in this transaction
    -- (purchase_save inserts the ledger row first, then the receipt, then this event). Done whatever the owner's
    -- purchase switch says, so a switched-off purchase never shows up as an expense either.
    if new.action = 'added' then
      delete from public.telegram_outbox o
      where o.status = 'pending'
        and o.created_at = now()
        and o.kind in ('finance', 'investor')
        and o.payload ->> 'entry_id' = new.finance_entry_id::text;
    end if;

    v_fields := coalesce(private.telegram_changed_fields(new.summary -> 'changes'), '[]'::jsonb)
      || case when (new.summary ->> 'lines_changed')::boolean then '["lines"]'::jsonb else '[]'::jsonb end
      || case when (new.summary ->> 'note_changed')::boolean then '["note"]'::jsonb else '[]'::jsonb end;

    perform private.telegram_enqueue(
      'purchase',
      'purchase:' || new.id,
      jsonb_build_object(
        'action', new.action,
        'amount', new.summary -> 'amount',
        'day', new.summary ->> 'entry_date',
        'payment_method', new.summary ->> 'payment_method',
        'lines', new.summary -> 'lines',
        'buyer', private.telegram_actor(new.summary ->> 'buyer_name'),
        'fields', case when jsonb_array_length(v_fields) > 0 then v_fields end,
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

revoke all on function private.telegram_from_purchase() from public, anon, authenticated;

create trigger purchase_events_telegram
  after insert on public.purchase_events
  for each row execute function private.telegram_from_purchase();

-- ---------- 4c. finance_close_log → close ----------
-- Payload whitelist: action (closed | reopened), month_start, result, actor.   Not sent: the reason of a reopen.
create or replace function private.telegram_from_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.telegram_enqueue(
      'close',
      'close:' || new.id,
      jsonb_build_object(
        'action', new.action,
        'month_start', new.month_start,
        'result', new.result,
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

revoke all on function private.telegram_from_close() from public, anon, authenticated;

create trigger finance_close_log_telegram
  after insert on public.finance_close_log
  for each row execute function private.telegram_from_close();

-- ---------- 4d. order_events → order ----------
-- Payload whitelist: event (paid | cancelled | edited | payment_method), number, program, kcal, days, total,
-- from_status, payment_method (the method of a move to paid), method_from / method_to (a method change), fields (the
-- names of the edited fields), actor.   Not sent: the customer's name, phone, address, comment and exclusions, the
-- edited values, the cancel reason.
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

create trigger order_events_telegram
  after insert on public.order_events
  for each row execute function private.telegram_from_order();

-- ---------- 5a. telegram_claim ----------
-- First, before anything is taken:
--   * a sending row whose lease ran out becomes uncertain (lease_expired; it may have been delivered, so it is never
--     sent again by itself). Its lease_until is kept: it is the claim token a late answer from that sender carries.
--   * a pending row due for more than 24 hours is skipped (expired), so switching the chat on later never sends days of
--     old events. A resent row starts again from now (telegram_resend), so it is claimed normally.
-- Then up to p_limit (1..20) due pending rows are marked sending with a 2-minute lease and returned, each with its
-- lease_until: the claim token telegram_finish needs.
create or replace function public.telegram_claim(p_limit int default 5)
returns table (id bigint, kind text, payload jsonb, created_at timestamptz, attempts int, lease_until timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.telegram_outbox o
  set status = 'uncertain', last_error = 'lease_expired'
  where o.status = 'sending' and o.lease_until < now();

  update public.telegram_outbox o
  set status = 'skipped', last_error = 'expired', lease_until = null
  where o.status = 'pending' and o.next_attempt_at < now() - interval '24 hours';

  return query
    with due as (
      select o.id
      from public.telegram_outbox o
      where o.status = 'pending' and o.next_attempt_at <= now()
      order by o.next_attempt_at, o.id
      limit least(greatest(coalesce(p_limit, 5), 1), 20)
      for update skip locked
    )
    update public.telegram_outbox o
    set status = 'sending', attempts = o.attempts + 1, lease_until = clock_timestamp() + interval '2 minutes'
    from due
    where o.id = due.id
    returning o.id, o.kind, o.payload, o.created_at, o.attempts, o.lease_until;
end;
$$;

revoke all on function public.telegram_claim(int) from public, anon, authenticated;
grant execute on function public.telegram_claim(int) to service_role;

-- ---------- 5b. telegram_finish ----------
-- Applies only with the claim token (p_lease, the lease_until telegram_claim returned): to the row while this sender
-- still holds it (sending, same lease), or after its lease ran out under this same claim (uncertain, lease_expired,
-- same lease: the late answer is the truth). A row that was resent and claimed again since carries another lease, so
-- an old sender's late answer never changes it.
--   retry    back to pending after 30 s, 2 min, 8 min, 32 min, or after p_retry_after seconds when Telegram said how
--            long to wait (a 429), bounded to 5 s .. 1 hour; the 5th attempt that asks for a retry ends failed
--   release  back to pending now, the attempt not counted (claimed, never tried)
-- Returns whether a row was updated.
create or replace function public.telegram_finish(
  p_id bigint,
  p_lease timestamptz,
  p_status text,
  p_error text default null,
  p_retry_after int default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 60);
begin
  if p_status is null or p_status not in ('sent', 'failed', 'uncertain', 'skipped', 'retry', 'release') then
    raise exception 'bad_status' using errcode = '22023';
  end if;
  if p_lease is null then
    return false;
  end if;

  update public.telegram_outbox o
  set status = case p_status
        when 'retry' then case when o.attempts >= 5 then 'failed' else 'pending' end
        when 'release' then 'pending'
        else p_status
      end,
      attempts = case when p_status = 'release' then greatest(o.attempts - 1, 0) else o.attempts end,
      next_attempt_at = case p_status
        when 'retry' then now() + case
          when p_retry_after is not null then make_interval(secs => least(greatest(p_retry_after, 5), 3600))
          else make_interval(secs => 30 * power(4, greatest(o.attempts - 1, 0))::int)
        end
        when 'release' then now()
        else o.next_attempt_at
      end,
      lease_until = null,
      last_error = case when p_status in ('sent', 'release') then null else v_error end,
      sent_at = case when p_status = 'sent' then now() else o.sent_at end
  where o.id = p_id
    and o.lease_until = p_lease
    and (o.status = 'sending' or (o.status = 'uncertain' and o.last_error = 'lease_expired'));
  return found;
end;
$$;

revoke all on function public.telegram_finish(bigint, timestamptz, text, text, int) from public, anon, authenticated;
grant execute on function public.telegram_finish(bigint, timestamptz, text, text, int) to service_role;

-- ---------- 5b2. one drain at a time ----------
-- A "drain running until" mark, so two drains (two saves at once, or a save during the morning run) do not send side by
-- side and break Telegram's per-group pace. A row of its own in the private schema (not exposed to the API); RLS on, no
-- grants: only the two functions below touch it.
create table private.telegram_drain_lock (
  id int primary key default 1 check (id = 1),
  running_until timestamptz,
  token uuid
);

alter table private.telegram_drain_lock enable row level security;
revoke all on table private.telegram_drain_lock from public, anon, authenticated, service_role;

insert into private.telegram_drain_lock (id) values (1);

-- Takes the mark for p_seconds (5..600) and returns its token, or null while another drain holds it. A drain that dies
-- holding it loses it when its time runs out.
create or replace function public.telegram_drain_begin(p_seconds int)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  update private.telegram_drain_lock l
  set running_until = clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_seconds, 60), 5), 600)),
      token = v_token
  where l.id = 1 and (l.running_until is null or l.running_until < clock_timestamp());
  return case when found then v_token end;
end;
$$;

revoke all on function public.telegram_drain_begin(int) from public, anon, authenticated;
grant execute on function public.telegram_drain_begin(int) to service_role;

-- Gives the mark back (only with its own token) and says what is waiting, in the same call, so a row queued while this
-- drain held the mark is never left behind: a save whose own drain found the mark taken committed its row before that
-- drain tried, so it is counted here.
--   { released: whether this token held the mark, due: pending rows due now, next_retry_in: seconds until the earliest
--     pending row due within the next 30 seconds (null when none) }
create or replace function public.telegram_drain_end(p_token uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_released boolean;
begin
  update private.telegram_drain_lock l
  set running_until = null, token = null
  where l.id = 1 and l.token = p_token;
  v_released := found;

  return jsonb_build_object(
    'released', v_released,
    'due', (
      select count(*)::int from public.telegram_outbox o
      where o.status = 'pending' and o.next_attempt_at <= now()
        and o.next_attempt_at >= now() - interval '24 hours'
    ),
    'next_retry_in', (
      select ceil(extract(epoch from min(o.next_attempt_at) - clock_timestamp()))::int
      from public.telegram_outbox o
      where o.status = 'pending' and o.next_attempt_at > clock_timestamp()
        and o.next_attempt_at <= clock_timestamp() + interval '30 seconds'
    )
  );
end;
$$;

revoke all on function public.telegram_drain_end(uuid) from public, anon, authenticated;
grant execute on function public.telegram_drain_end(uuid) to service_role;

-- ---------- 5c. telegram_expire ----------
-- Pending rows due for more than 24 hours are skipped, so switching the chat on later does not flood it. A row's
-- next_attempt_at is never before its created_at, and a resent row starts again from now.
create or replace function public.telegram_expire()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.telegram_outbox o
  set status = 'skipped', last_error = 'expired', lease_until = null
  where o.status = 'pending' and o.next_attempt_at < now() - interval '24 hours';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.telegram_expire() from public, anon, authenticated;
grant execute on function public.telegram_expire() to service_role;

-- ---------- 5d. daily_digest ----------
-- The morning digest's figures for the Tashkent day p_day, as jsonb. No personal data: counts, sums, program names,
-- calorie levels and delivery windows only (the phones read for the "ending" count never leave this function).
--   yesterday (p_day - 1, recorded that Tashkent day):
--     placed            orders created
--     paid, paid_sum    orders paid, on the cash basis of the reports (private.report_paid_orders, 0021)
--     cancelled         orders moved to cancelled (order_events, 0018)
--     expenses, expenses_sum    ledger expenses entered, without the rows that mirror a purchase
--     purchases, purchases_sum  purchase receipts entered (0022)
--     investor_sum      investor money entered
--   today (p_day):
--     levels            rations per program and calorie level, the kitchen sheet's rule (private.ration_counts, 0023,
--                       statuses confirmed, paid and active, as kitchen_orders, 0009)
--     deliveries        orders delivering, and per delivery window (the delivery sheet's rule, 0010)
--   ending, ending_next customers whose plan ends today .. today + 2, unrenewed (the customers_ending rule, 0020)
--   new_orders          orders waiting in status new
--   outbox_problems     outbox rows failed or uncertain in the last 7 days
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
      and p_day - o.start_date < o.days * 2 + 7
      and private.order_day_index(o.start_date, o.weekdays_only, p_day) between 1 and o.days
    group by o.delivery_window
  ) w;

  -- The prefilter and rule of public.customers_ending (0020), with p_day as today.
  v_phones := array(
    select distinct o.phone
    from public.orders o
    where o.status in ('paid', 'active')
      and o.start_date <= p_day + 2
      and p_day - o.start_date < o.days * 2 + 7
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

-- ---------- 5e. telegram_queue_digest ----------
-- 'queued', 'exists' (already queued for that day: a repeated call sends nothing twice) or 'off' (the owner's digest
-- switch is off).
create or replace function public.telegram_queue_digest(p_day date)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_day is null then
    raise exception 'bad_day' using errcode = '22023';
  end if;
  if not private.telegram_kind_on('digest') then
    return 'off';
  end if;
  if exists (select 1 from public.telegram_outbox t where t.dedupe_key = 'digest:' || p_day::text) then
    return 'exists';
  end if;
  insert into public.telegram_outbox (kind, dedupe_key, payload)
  values ('digest', 'digest:' || p_day::text, jsonb_strip_nulls(public.daily_digest(p_day)))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return case when v_count > 0 then 'queued' else 'exists' end;
end;
$$;

revoke all on function public.telegram_queue_digest(date) from public, anon, authenticated;
grant execute on function public.telegram_queue_digest(date) to service_role;

-- ---------- 6a. telegram_resend ----------
create or replace function public.telegram_resend(p_id bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  update public.telegram_outbox o
  set status = 'pending', attempts = 0, next_attempt_at = now(), lease_until = null, last_error = null
  where o.id = p_id and o.status in ('failed', 'uncertain');
  return found;
end;
$$;

revoke all on function public.telegram_resend(bigint) from public, anon;
grant execute on function public.telegram_resend(bigint) to authenticated;

-- ---------- 6a2. telegram_skip_pending ----------
-- "Start from now": every pending row is skipped (skipped_by_owner), so switching the chat on does not send what queued
-- before. Returns how many.
create or replace function public.telegram_skip_pending()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  update public.telegram_outbox o
  set status = 'skipped', last_error = 'skipped_by_owner', lease_until = null
  where o.status = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.telegram_skip_pending() from public, anon;
grant execute on function public.telegram_skip_pending() to authenticated;

-- ---------- 6b. telegram_status ----------
-- { counts: { <status>: n } of the rows created in the last 7 days, pending: every pending row (any age), waiting_retry:
-- the pending rows waiting for a later retry, recent: [the latest 20 rows: id, created_at, kind, status, attempts,
-- last_error, sent_at, next_attempt_at, payload] }. The payloads hold no personal data (4).
create or replace function public.telegram_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'counts', (
      select coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb)
      from (
        select t.status, count(*)::int as n
        from public.telegram_outbox t
        where t.created_at >= now() - interval '7 days'
        group by t.status
      ) c
    ),
    'pending', (select count(*)::int from public.telegram_outbox t where t.status = 'pending'),
    'waiting_retry', (
      select count(*)::int from public.telegram_outbox t
      where t.status = 'pending' and t.attempts > 0 and t.next_attempt_at > now()
    ),
    'recent', (
      select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
      from (
        select t.id, t.created_at, t.kind, t.status, t.attempts, t.last_error, t.sent_at, t.next_attempt_at, t.payload
        from public.telegram_outbox t
        order by t.created_at desc, t.id desc
        limit 20
      ) r
    )
  );
end;
$$;

revoke all on function public.telegram_status() from public, anon;
grant execute on function public.telegram_status() to authenticated;

-- ---------- 6c. telegram_test ----------
-- Queues one test message. Returns false when one was queued in the same 30-second slot already (a double click).
create or replace function public.telegram_test()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  insert into public.telegram_outbox (kind, dedupe_key, payload)
  values ('test', 'test:' || floor(extract(epoch from now()) / 30)::bigint::text, '{}'::jsonb)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.telegram_test() from public, anon;
grant execute on function public.telegram_test() to authenticated;
