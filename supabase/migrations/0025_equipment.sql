-- Equipment register: what the kitchen owns (pots, boxes, scales, a fridge), with a photo, how many there are, a note,
-- and who counted them last and when; archived instead of deleted. Every change that matters (added, counted, confirmed,
-- renamed, archived, restored) is kept in a short append-only history, shown on the item page and in the owner's audit feed.
-- Plan: docs/plans/zarkebab-feature-port.md, slice 13.
--
-- Additive only. No existing row, column, policy or grant is changed or dropped:
--   1. New table public.equipment, RLS on. Owners and managers (private.can_handle_stock(), 0022) read, add and edit
--      it: name, count, note, photo and archived_at are the only columns a client may write. Never deleted (no delete
--      grant, no delete policy). counted_at, counted_by and counted_by_name are stamped by a trigger whenever the count
--      changes (and on insert), from auth.uid(); a client can neither write them (no column grant) nor keep them from
--      moving. A recount that finds the same number is stamped through public.equipment_confirm_count (4) only.
--      photo_url must be a public URL of a <name>.jpg file at the top of the equipment-photos bucket. archived_at is
--      stamped with the database's clock, whatever time the client sent. One active item per name (case-insensitive);
--      an archived one may share it.
--   2. New table public.equipment_events, the items' history: append-only for every role, with the guards of audit_log
--      (0019), as purchase_events (0022). Owners and managers read it; no client writes: an after trigger on equipment
--      writes it. The server's secret key may read it, never write it.
--   3. New storage bucket equipment-photos with four policies (read, upload, update, delete) for owners and managers.
--      The bucket is public, like dish-photos (0001) and program-photos (0011): the project has no signed-URL
--      plumbing, so a photo is readable by anyone holding its URL, and the URL is unguessable (PhotoField names each
--      file <random uuid>.jpg). Listing the bucket through the API is limited to owners and managers by the read policy.
--   4. New function public.equipment_confirm_count(p_id, p_loaded) (security definer, owners and managers): "counted,
--      still N" — stamps who counted and when without changing the count, refused when the count is no longer the one
--      the control showed. Writes a 'confirmed' event.
--   5. public.audit_feed is replaced (create or replace, same arguments and result): a new area 'equipment' reads
--      equipment_events (item keys 'e' + id). Every other area returns exactly what it returned under 0022.
--
-- Cooks (staff role admin) have no access to any of it: every policy and the audit feed check the role.

-- ---------- 1. equipment ----------
create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120 and char_length(name) <= 120),
  count int not null default 0 check (count between 0 and 100000),
  note text not null default '' check (char_length(note) <= 500),
  -- A public URL of a file at the top of the equipment-photos bucket (PhotoField names them <uuid>.jpg). The project's
  -- host is not known here; the server action and the pages also check it against the project URL. Null: no photo.
  photo_url text check (photo_url is null or (
    char_length(photo_url) <= 1000
    and photo_url ~ '^https?://[^/?#@[:space:]]+/storage/v1/object/public/equipment-photos/[A-Za-z0-9][A-Za-z0-9_-]*\.jpg$'
  )),
  counted_at timestamptz not null default now(),
  counted_by uuid references auth.users (id) on delete set null,
  -- A snapshot (staff name, else the account email), so the card keeps its "counted by" after a team member leaves.
  counted_by_name text not null default '' check (char_length(counted_by_name) <= 320),
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index equipment_name_key on public.equipment (lower(btrim(name))) where archived_at is null;
create index equipment_counted_by_idx on public.equipment (counted_by);
create index equipment_created_by_idx on public.equipment (created_by);

create trigger equipment_updated_at
  before update on public.equipment
  for each row execute function private.set_updated_at();

-- Stamps who counted and when on insert and whenever the count changes, and keeps both as they were otherwise (the
-- only change let through is the "on delete set null" of a removed account clearing counted_by). A recount that found
-- the same number is stamped too, but only inside public.equipment_confirm_count: it names the row in the
-- transaction-local setting taomiq.equipment_confirm first (clients run no SQL of theirs through the API, so they cannot
-- set it, and have no column grant on the stamps anyway). archived_at takes the
-- database's clock when an item is archived and keeps it while it stays archived.
create or replace function private.stamp_equipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := '';
begin
  if tg_op = 'INSERT'
     or new.count is distinct from old.count
     or coalesce(current_setting('taomiq.equipment_confirm', true), '') = new.id::text then
    if v_uid is not null then
      select coalesce(nullif(btrim(s.name), ''), u.email, '')
        into v_name
      from auth.users u
      left join public.staff s on s.user_id = u.id
      where u.id = v_uid;
    end if;
    new.counted_at := now();
    new.counted_by := v_uid;
    new.counted_by_name := left(coalesce(v_name, ''), 320);
  else
    new.counted_at := old.counted_at;
    new.counted_by_name := old.counted_by_name;
    new.counted_by := case when new.counted_by is null then null else old.counted_by end;
  end if;

  if tg_op = 'INSERT' then
    new.archived_at := null;
  elsif new.archived_at is not null then
    new.archived_at := case when old.archived_at is null then now() else old.archived_at end;
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_equipment() from public, anon, authenticated;

create trigger equipment_stamp
  before insert or update on public.equipment
  for each row execute function private.stamp_equipment();

alter table public.equipment enable row level security;

revoke all on table public.equipment from anon, authenticated;
grant select on table public.equipment to authenticated;
grant insert (name, count, note, photo_url) on table public.equipment to authenticated;
grant update (name, count, note, photo_url, archived_at) on table public.equipment to authenticated;

create policy "stock reads equipment" on public.equipment
  for select to authenticated
  using ((select private.can_handle_stock()));

create policy "stock adds equipment" on public.equipment
  for insert to authenticated
  with check ((select private.can_handle_stock()) and created_by = (select auth.uid()) and archived_at is null);

create policy "stock edits equipment" on public.equipment
  for update to authenticated
  using ((select private.can_handle_stock()))
  with check ((select private.can_handle_stock()));

-- ---------- 2. equipment_events ----------
-- One row per change: added { name, count } · counted { name, from, to } · confirmed { name, count } (recounted, the
-- same number) · renamed { from, to } · archived { name, count } · restored { name, count }. A save that renames and recounts writes two rows. A change of
-- the note or the photo only is not recorded. equipment_id carries no foreign key, as purchase_events: the history is
-- kept whatever happens to the row.
create table public.equipment_events (
  id bigint generated always as identity primary key,
  equipment_id uuid not null,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  actor_name text not null default '' check (char_length(actor_name) <= 320),
  kind text not null check (kind in ('added', 'counted', 'confirmed', 'renamed', 'archived', 'restored')),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);

create index equipment_events_item_idx on public.equipment_events (equipment_id, at desc, id desc);
create index equipment_events_at_idx on public.equipment_events (at desc, id desc);
create index equipment_events_actor_idx on public.equipment_events (actor) where actor is not null;

alter table public.equipment_events enable row level security;

revoke all on table public.equipment_events from anon, authenticated;
grant select on table public.equipment_events to authenticated;
-- As audit_log (0019): the server's secret key may read the history, never write it.
revoke insert, update, delete, truncate on table public.equipment_events from service_role;

create policy "stock reads equipment events" on public.equipment_events
  for select to authenticated
  using ((select private.can_handle_stock()));

-- Append-only for every role (the only update let through is the "on delete set null" of a removed account); TRUNCATE
-- is refused.
create trigger equipment_events_guard
  before update or delete on public.equipment_events
  for each row execute function private.guard_audit_log_row();

create trigger equipment_events_no_truncate
  before truncate on public.equipment_events
  for each statement execute function private.guard_audit_log_truncate();

-- The one place an equipment event is written: the actor and their name as private.write_audit (0019) takes them.
create or replace function private.write_equipment_event(p_equipment_id uuid, p_kind text, p_detail jsonb)
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

  insert into public.equipment_events (equipment_id, actor, actor_name, kind, detail)
  values (
    p_equipment_id,
    v_actor,
    left(coalesce(v_name, ''), 320),
    p_kind,
    jsonb_strip_nulls(coalesce(p_detail, '{}'::jsonb))
  );
end;
$$;

revoke all on function private.write_equipment_event(uuid, text, jsonb) from public, anon, authenticated;

-- After the row changed (a refused write logs nothing).
create or replace function private.log_equipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_equipment_event(new.id, 'added', jsonb_build_object('name', new.name, 'count', new.count));
    return null;
  end if;

  if new.name is distinct from old.name then
    perform private.write_equipment_event(new.id, 'renamed', jsonb_build_object('from', old.name, 'to', new.name));
  end if;
  if new.count is distinct from old.count then
    perform private.write_equipment_event(
      new.id, 'counted', jsonb_build_object('name', new.name, 'from', old.count, 'to', new.count)
    );
  elsif new.counted_at is distinct from old.counted_at then
    -- Only equipment_confirm_count moves the stamp without the count (see private.stamp_equipment).
    perform private.write_equipment_event(new.id, 'confirmed', jsonb_build_object('name', new.name, 'count', new.count));
  end if;
  if old.archived_at is null and new.archived_at is not null then
    perform private.write_equipment_event(new.id, 'archived', jsonb_build_object('name', new.name, 'count', new.count));
  elsif old.archived_at is not null and new.archived_at is null then
    perform private.write_equipment_event(new.id, 'restored', jsonb_build_object('name', new.name, 'count', new.count));
  end if;
  return null;
end;
$$;

revoke all on function private.log_equipment() from public, anon, authenticated;

create trigger equipment_log
  after insert or update on public.equipment
  for each row execute function private.log_equipment();

-- ---------- 3. storage: equipment-photos ----------
insert into storage.buckets (id, name, public)
values ('equipment-photos', 'equipment-photos', true)
on conflict (id) do nothing;

create policy "stock reads equipment photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'equipment-photos' and (select private.can_handle_stock()));
create policy "stock uploads equipment photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'equipment-photos' and (select private.can_handle_stock()));
create policy "stock updates equipment photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'equipment-photos' and (select private.can_handle_stock()))
  with check (bucket_id = 'equipment-photos' and (select private.can_handle_stock()));
create policy "stock deletes equipment photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'equipment-photos' and (select private.can_handle_stock()));

-- ---------- 4. equipment_confirm_count ----------
-- "Counted, still N": stamps who counted and when on an active item without changing its count. p_loaded is the count
-- the control showed. Returns { count, counted_at }. Errors (message, code): not_allowed 42501 · not_found P0002 ·
-- archived 55000 · stale 55000 (detail: the count now).
create or replace function public.equipment_confirm_count(p_id uuid, p_loaded int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.equipment;
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_row from public.equipment q where q.id = p_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_row.archived_at is not null then
    raise exception 'archived' using errcode = '55000';
  end if;
  if p_loaded is null or v_row.count <> p_loaded then
    raise exception 'stale' using errcode = '55000', detail = v_row.count::text;
  end if;

  perform set_config('taomiq.equipment_confirm', v_row.id::text, true);
  update public.equipment q set count = q.count where q.id = v_row.id returning * into v_row;
  perform set_config('taomiq.equipment_confirm', '', true);

  return jsonb_build_object('count', v_row.count, 'counted_at', v_row.counted_at);
end;
$$;

revoke all on function public.equipment_confirm_count(uuid, int) from public, anon;
grant execute on function public.equipment_confirm_count(uuid, int) to authenticated;

-- ---------- 5. audit_feed with equipment ----------
-- The body of 0022 with additions marked "0025": the 'equipment' area, the ee source (equipment_events, item keys
-- 'e' + id, subject equipment:<item id>; listed only for no filter or the 'equipment' filter) and target_exists knowing
-- equipment. Nothing else changed: the comments marked "0022" are kept as they were.
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

  -- 0022: 'purchases'. 0025: 'equipment'.
  if p_area is not null
     and p_area not in ('finance', 'payroll', 'team', 'settings', 'catalog', 'orders', 'purchases', 'equipment') then
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
          -- 0022: a purchase's ledger row is reported by the purchase's own event.
          and not (case when a.subject like 'finance_entries:%' then exists (
            select 1 from public.purchase_events pe where pe.finance_entry_id = split_part(a.subject, ':', 2)::uuid
          ) else false end)
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
          -- 0022: as above.
          and not (case when a.subject like 'finance_entries:%' then exists (
            select 1 from public.purchase_events pe where pe.finance_entry_id = split_part(a.subject, ':', 2)::uuid
          ) else false end)
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
    -- 0022: purchases.
    pe as (
      select x.*
      from (
        select
          'p' || lpad(e.id::text, 19, '0') as k,
          e.at as t_at,
          e.actor as t_actor,
          e.actor_name as t_actor_name,
          'purchases'::text as t_area,
          e.action as t_action,
          'purchases:' || e.purchase_id::text as t_subject,
          e.summary as t_summary
        from public.purchase_events e
        -- 0022: a purchase is money too, so the 'finance' filter lists it (with its own 'purchases' area).
        where (p_area is null or p_area in ('purchases', 'finance'))
          and e.at <= v_bound
          and (p_before is null or e.at < p_before or (e.at = p_before and 'p' || lpad(e.id::text, 19, '0') < v_key))
      ) x
      where v_like is null
        or private.audit_matches(x.t_actor_name, x.t_subject, x.t_summary, x.t_at, v_like, v_digits, v_uuid, v_day)
        -- 0022: the uuid of the purchase's ledger row finds it too (that row itself is not listed).
        or (v_uuid is not null and x.t_summary ->> 'entry_id' = v_uuid)
      order by x.t_at desc, x.k desc
      limit v_limit
    ),
    -- 0025: equipment.
    ee as (
      select x.*
      from (
        select
          'e' || lpad(e.id::text, 19, '0') as k,
          e.at as t_at,
          e.actor as t_actor,
          e.actor_name as t_actor_name,
          'equipment'::text as t_area,
          e.kind as t_action,
          'equipment:' || e.equipment_id::text as t_subject,
          e.detail as t_summary
        from public.equipment_events e
        where (p_area is null or p_area = 'equipment')
          and e.at <= v_bound
          and (p_before is null or e.at < p_before or (e.at = p_before and 'e' || lpad(e.id::text, 19, '0') < v_key))
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
      union all
      select * from pe
      -- 0025
      union all
      select * from ee
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
        -- 0022
        when 'purchases' then exists (
          select 1 from public.purchases pu where pu.id = split_part(u.t_subject, ':', 2)::uuid
        )
        -- 0025
        when 'equipment' then exists (
          select 1 from public.equipment q where q.id = split_part(u.t_subject, ':', 2)::uuid
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
