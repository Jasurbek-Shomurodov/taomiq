-- Third site language: Uzbek in Cyrillic script ('uzc'), next to Uzbek Latin ('uz') and Russian ('ru').
-- Plan: docs/plans/third-locale-uzbek-cyrillic.md.
--
-- NOT PURELY ADDITIVE. Owner-approved on 23 Nov 2026 for production:
--   * orders.locale: the check constraint orders_locale_check is dropped and re-added to also allow 'uzc'.
--     It only widens the allowed values; no rows change.
--   * staff: table-level UPDATE is revoked from anon and authenticated, then UPDATE on the single column
--     locale is granted to authenticated. There was no update policy on staff before, so nobody could update
--     it through the API; after this migration a staff member can change only their own locale.
--   * public.submit_order() is replaced (create or replace) with the same signature and body; the only
--     change is that p_locale may be 'uzc'. Its execute privileges are re-stated below.
-- Everything else is additive: new text columns with empty defaults and a new policy. No data backfill: the
-- site converts the Latin text when a *_uzc value is empty (src/lib/data/localized.ts).

-- ---------- catalogue text in Cyrillic Uzbek ----------
-- Empty means "not written yet": the site shows the Latin text converted to Cyrillic.
alter table public.programs
  add column tagline_uzc text not null default '',
  add column description_uzc text not null default '';

alter table public.dishes
  add column name_uzc text not null default '',
  add column ingredients_uzc text not null default '';

-- ---------- orders.locale ----------
-- The name is Postgres's default for the inline check in 0004_orders.sql. A plain drop (no "if exists")
-- so a different name fails the migration instead of leaving the old, narrower check in place.
alter table public.orders drop constraint orders_locale_check;
alter table public.orders add constraint orders_locale_check check (locale in ('uz', 'uzc', 'ru'));

-- ---------- staff: admin interface language ----------
alter table public.staff
  add column locale text not null default 'ru' check (locale in ('uz', 'uzc', 'ru'));

-- A staff member may change their own interface language and nothing else. The column grant limits
-- what can be written; the policy limits whose row. Owner-only writes elsewhere are unchanged.
revoke update on table public.staff from anon, authenticated;
grant update (locale) on table public.staff to authenticated;

create policy "staff update own locale" on public.staff
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------- submit_order ----------
-- Same as 0004_orders.sql except that p_locale may be 'uzc'.
create or replace function public.submit_order(
  p_variant_id uuid,
  p_days int,
  p_weekdays_only boolean,
  p_start_date date,
  p_name text,
  p_phone text,
  p_address text,
  p_window text,
  p_comment text,
  p_exclusions text,
  p_locale text,
  p_source jsonb,
  p_ip_hash text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Tashkent';
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_program_name text;
  v_kcal int;
  v_base_price int;
  v_markup numeric;
  v_cutoff int;
  v_windows jsonb;
  v_earliest date;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := btrim(coalesce(p_phone, ''));
  v_address text := btrim(coalesce(p_address, ''));
  v_window text := btrim(coalesce(p_window, ''));
  v_comment text := btrim(coalesce(p_comment, ''));
  v_exclusions text := btrim(coalesce(p_exclusions, ''));
  v_weekdays_only boolean := coalesce(p_weekdays_only, false);
  v_ip_hash text := left(btrim(coalesce(p_ip_hash, '')), 128);
  v_source jsonb := '{}'::jsonb;
  v_key text;
  v_price int;
  v_number bigint;
begin
  -- Plan
  select p.name, v.kcal, v.price_per_day
    into v_program_name, v_kcal, v_base_price
  from public.program_variants v
  join public.programs p on p.id = v.program_id
  where v.id = p_variant_id and v.active and p.active;
  if not found then
    raise exception 'invalid_variant';
  end if;

  select d.markup_pct into v_markup from public.durations d where d.days = p_days;
  if not found then
    raise exception 'invalid_days';
  end if;

  -- Start date, Tashkent time: tomorrow before the cutoff hour, otherwise the day after; at most 60 days ahead.
  select (s.value #>> '{}')::int into v_cutoff from public.settings s where s.key = 'order_cutoff_hour';
  v_cutoff := coalesce(v_cutoff, 14);
  v_earliest := v_today + case when extract(hour from v_now) < v_cutoff then 1 else 2 end;
  if p_start_date is null
     or p_start_date < v_earliest
     or p_start_date > v_today + 60
     or (v_weekdays_only and extract(isodow from p_start_date) in (6, 7)) then
    raise exception 'invalid_date';
  end if;

  -- Contact and delivery
  if v_phone !~ '^\+998[0-9]{9}$' then
    raise exception 'invalid_phone';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'invalid_name';
  end if;
  if char_length(v_address) not between 5 and 300 then
    raise exception 'invalid_address';
  end if;

  select s.value into v_windows from public.settings s where s.key = 'delivery_windows';
  if v_windows is null or jsonb_typeof(v_windows) <> 'array' or not (v_windows ? v_window) then
    raise exception 'invalid_window';
  end if;

  if char_length(v_comment) > 500 or char_length(v_exclusions) > 500 then
    raise exception 'too_long';
  end if;

  if p_locale is null or p_locale not in ('uz', 'uzc', 'ru') then
    raise exception 'invalid_locale';
  end if;

  -- Attribution: whitelisted keys, string values, at most 100 characters each.
  if p_source is not null and jsonb_typeof(p_source) = 'object' then
    foreach v_key in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'] loop
      if jsonb_typeof(p_source -> v_key) = 'string' then
        v_source := v_source || jsonb_build_object(v_key, left(p_source ->> v_key, 100));
      end if;
    end loop;
  end if;

  -- Abuse limits: 3 new orders per phone in 24 hours, 10 orders per connection in an hour.
  -- The locks make concurrent submissions from one phone or one connection count correctly.
  perform pg_advisory_xact_lock(hashtext('submit_order:phone:' || v_phone));
  if (
    select count(*) from public.orders o
    where o.phone = v_phone and o.status = 'new' and o.created_at > now() - interval '24 hours'
  ) >= 3 then
    raise exception 'rate_limited';
  end if;
  if v_ip_hash <> '' then
    perform pg_advisory_xact_lock(hashtext('submit_order:ip:' || v_ip_hash));
    if (
      select count(*) from public.orders o
      where o.ip_hash = v_ip_hash and o.created_at > now() - interval '1 hour'
    ) >= 10 then
      raise exception 'rate_limited';
    end if;
  end if;

  -- Same rule as pricePerDay() in src/lib/data/types.ts:
  -- base * (100 + markup) / 100, rounded half up to the nearest 1,000 UZS (exact numeric arithmetic).
  v_price := (round(v_base_price * (100 + v_markup) / 100000.0) * 1000)::int;

  insert into public.orders (
    variant_id, program_name, kcal, days, weekdays_only, start_date, price_per_day, total,
    customer_name, phone, address, delivery_window, comment, exclusions, locale, source, ip_hash
  ) values (
    p_variant_id, v_program_name, v_kcal, p_days, v_weekdays_only, p_start_date, v_price, v_price * p_days,
    v_name, v_phone, v_address, v_window, v_comment, v_exclusions, p_locale, v_source, v_ip_hash
  )
  returning number into v_number;

  return v_number;
end;
$$;

revoke execute on function public.submit_order(uuid, int, boolean, date, text, text, text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.submit_order(uuid, int, boolean, date, text, text, text, text, text, text, text, jsonb, text)
  to service_role;
