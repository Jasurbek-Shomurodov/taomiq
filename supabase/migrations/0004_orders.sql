-- Order requests (soft launch): customers place an order on the site, the owner confirms it
-- by phone/Telegram and takes payment manually. Online payment is added to this table later.
-- Additive only: new table, indexes, policies, an updated_at trigger, a status-transition trigger,
-- settings rows (on conflict do nothing) and a function callable only with the service_role key.

-- ---------- orders ----------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1001) unique,
  status text not null default 'new'
    check (status in ('new', 'confirmed', 'paid', 'active', 'completed', 'cancelled')),
  variant_id uuid not null references public.program_variants (id) on delete restrict,
  program_name text not null,           -- snapshot
  kcal int not null,                    -- snapshot
  days int not null,                    -- delivered days
  weekdays_only boolean not null default false,
  start_date date not null,
  price_per_day int not null,           -- UZS, snapshot
  total int not null,                   -- UZS = price_per_day * days
  customer_name text not null,
  phone text not null check (phone ~ '^\+998[0-9]{9}$'),
  address text not null,
  delivery_window text not null,
  comment text not null default '',
  exclusions text not null default '',
  locale text not null default 'uz' check (locale in ('uz', 'ru')),
  source jsonb not null default '{}',   -- utm_* and ref, whitelisted keys only
  ip_hash text not null default '',     -- SHA-256 of the client IP + server secret; the raw IP is never stored
  staff_note text not null default '',
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_status_created on public.orders (status, created_at desc);
create index orders_phone_created on public.orders (phone, created_at desc);
create index orders_variant on public.orders (variant_id);
create index orders_ip_created on public.orders (ip_hash, created_at desc);

-- ---------- updated_at ----------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function private.set_updated_at();

-- ---------- status transitions ----------
-- new → confirmed → paid → active → completed, one step at a time; any open order can be cancelled.
-- completed and cancelled are final. Same rule as canMove() in src/lib/admin/orders.ts; keep them in step.
-- Enforced here so a direct API call with the owner's session cannot skip or reverse a step.
create or replace function private.check_order_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
    (old.status = 'new' and new.status = 'confirmed')
    or (old.status = 'confirmed' and new.status = 'paid')
    or (old.status = 'paid' and new.status = 'active')
    or (old.status = 'active' and new.status = 'completed')
    or (old.status in ('new', 'confirmed', 'paid', 'active') and new.status = 'cancelled')
  ) then
    raise exception 'invalid_transition: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;

revoke all on function private.check_order_status() from public;

create trigger orders_check_status
  before update on public.orders
  for each row execute function private.check_order_status();

-- ---------- row level security ----------
-- No anon or customer policies: orders are written only through submit_order() below.
-- Only the owner reads and updates them (cooks/admins never see personal data). No delete.
-- The owner may change only the status and the staff note; snapshots, price and contact data are
-- read-only. Triggers (updated_at above) still set other columns: column grants apply to the
-- statement's SET list, not to values a trigger writes.
alter table public.orders enable row level security;

revoke all on table public.orders from anon, authenticated;
grant select on table public.orders to authenticated;
grant update (status, staff_note) on table public.orders to authenticated;

create policy "owner read orders" on public.orders
  for select to authenticated using ((select private.is_owner()));
create policy "owner update orders" on public.orders
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));

-- ---------- settings ----------
insert into public.settings (key, value) values
  ('delivery_windows', '["06:00–08:00", "07:00–09:00", "08:00–10:00"]'),
  ('order_cutoff_hour', '14')
on conflict (key) do nothing;

-- ---------- submit_order ----------
-- Called only by the site's server action with the secret (service_role) key, never with the
-- public key: otherwise anyone could call /rest/v1/rpc/submit_order directly and skip the form.
-- Validates everything, computes the price on the server (never trusts the client) and returns
-- the order number.
-- Errors are raised with stable codes as the message; the server action maps them to text.
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

  if p_locale is null or p_locale not in ('uz', 'ru') then
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
