-- Settings screen in the back office: checked values for the catalogue and contact settings, the two new contact keys,
-- and a read-only summary of the applied migrations for the System panel.
-- Plan: docs/plans/zarkebab-feature-port.md, slice 1.
--
-- Additive only. No existing row, column, policy, trigger or grant is changed or dropped:
--   1. New trigger settings_check_catalogue on public.settings (before insert or update; existing rows are not
--      re-checked). It checks the values of five keys and leaves every other key alone (the finance_* keys keep their
--      own check, settings_check_finance from 0015):
--        order_cutoff_hour  a JSON number, a whole hour 0..23
--        delivery_windows   a JSON array of 1..12 distinct strings "HH:MM–HH:MM" (en dash), each start before its end;
--                           the shape submit_order (0007), the order form and the delivery sheet already read
--        cycle_anchor       a JSON string, a real calendar day "YYYY-MM-DD"
--        contact_phone      a JSON string: empty, or an Uzbek number "+998" and 9 digits
--        contact_telegram   a JSON string: empty, or a Telegram username without "@" (5..32 letters, digits, "_",
--                           starting with a letter)
--      A refused value raises bad_setting (23514), like the finance check.
--   2. Two new rows in public.settings, contact_phone and contact_telegram, both empty strings, inserted only when
--      missing (on conflict do nothing). They are public like every non-finance setting (0001, 0015): the public site
--      shows them in slice 12.
--   3. New function public.applied_migrations_summary(): the number of applied migrations and the latest one, read
--      from supabase_migrations.schema_migrations, or null when that table does not exist (a local test database).
--      Owner only (raises not_owner, 42501, for anyone else), executable by authenticated.
--
-- Writes stay owner only (policy "staff write settings", 0003); reads are unchanged.

-- ---------- 1. value checks ----------

create or replace function private.check_catalogue_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_text text;
  v_item jsonb;
  v_seen text[] := '{}';
begin
  if new.key not in ('order_cutoff_hour', 'delivery_windows', 'cycle_anchor', 'contact_phone', 'contact_telegram') then
    return new;
  end if;

  if new.key = 'order_cutoff_hour' then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;
    -- Checked as text: submit_order casts this text to int, and '14.0'::int fails although 14.0 is a whole number.
    if (new.value #>> '{}') !~ '^([0-9]|1[0-9]|2[0-3])$' then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;

  elsif new.key = 'delivery_windows' then
    if jsonb_typeof(new.value) <> 'array'
       or jsonb_array_length(new.value) < 1
       or jsonb_array_length(new.value) > 12 then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;
    for v_item in select e.value from jsonb_array_elements(new.value) as e loop
      if jsonb_typeof(v_item) <> 'string' then
        raise exception 'bad_setting' using errcode = '23514', detail = new.key;
      end if;
      v_text := v_item #>> '{}';
      if v_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]–([01][0-9]|2[0-3]):[0-5][0-9]$'
         or split_part(v_text, '–', 1) collate "C" >= split_part(v_text, '–', 2) collate "C"
         or v_text = any (v_seen) then
        raise exception 'bad_setting' using errcode = '23514', detail = new.key;
      end if;
      v_seen := v_seen || v_text;
    end loop;

  elsif new.key = 'cycle_anchor' then
    if jsonb_typeof(new.value) <> 'string' then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;
    v_text := new.value #>> '{}';
    if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;
    begin
      -- A real day only: 2026-02-30 either fails the cast or comes back as another day.
      if to_char(v_text::date, 'YYYY-MM-DD') <> v_text then
        raise exception 'bad_setting' using errcode = '23514', detail = new.key;
      end if;
    exception
      when datetime_field_overflow or invalid_datetime_format then
        raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end;

  elsif new.key = 'contact_phone' then
    if jsonb_typeof(new.value) <> 'string' then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;
    v_text := new.value #>> '{}';
    if v_text <> '' and v_text !~ '^\+998[0-9]{9}$' then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;

  elsif new.key = 'contact_telegram' then
    if jsonb_typeof(new.value) <> 'string' then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;
    v_text := new.value #>> '{}';
    if v_text <> '' and v_text !~ '^[A-Za-z][A-Za-z0-9_]{4,31}$' then
      raise exception 'bad_setting' using errcode = '23514', detail = new.key;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.check_catalogue_setting() from public;

create trigger settings_check_catalogue
  before insert or update on public.settings
  for each row execute function private.check_catalogue_setting();

-- ---------- 2. contact keys ----------

insert into public.settings (key, value) values
  ('contact_phone', '""'),
  ('contact_telegram', '""')
on conflict (key) do nothing;

-- ---------- 3. applied migrations (System panel) ----------
-- Security definer: the API roles cannot read the supabase_migrations schema. Only a count and the latest version and
-- name leave the function, never the statements.

create or replace function public.applied_migrations_summary()
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

  if to_regclass('supabase_migrations.schema_migrations') is null then
    return null;
  end if;

  -- Dynamic, so the function is created (and runs) where the table does not exist.
  execute $q$
    select jsonb_build_object(
      'count', (select count(*) from supabase_migrations.schema_migrations),
      'latest_version', (select m.version from supabase_migrations.schema_migrations m order by m.version desc limit 1),
      'latest_name', (select m.name from supabase_migrations.schema_migrations m order by m.version desc limit 1)
    )
  $q$ into v_result;
  return v_result;
end;
$$;

revoke all on function public.applied_migrations_summary() from public, anon;
grant execute on function public.applied_migrations_summary() to authenticated;
