-- Ingredients and purchases: a catalogue of what the kitchen buys (names in three languages, a category, the unit it is
-- bought in, the usual price), and market receipts (a day, who bought, how it was paid, lines of ingredient, quantity
-- and amount). Every receipt is mirrored by exactly one ingredients expense in the finance ledger (0013), kept in step
-- on create, edit and delete, and written only by the functions below.
-- Plan: docs/plans/zarkebab-feature-port.md, slice 6.
--
-- Additive only. No existing row, column, policy or grant is changed or dropped:
--   1. New private.can_handle_stock(): owners and managers (the same roles as private.can_handle_orders, 0012, kept as
--      its own rule so the stock screens can change without touching orders).
--   2. New tables, RLS on:
--        ingredient_categories  seeded with ten categories. Owners and managers read; the owner adds and renames.
--        ingredients            owners and managers read, add and edit (also archive and restore). Never deleted.
--        purchases              owners and managers read. No client writes: purchase_save and purchase_delete only.
--        purchase_lines         owners and managers read. No client writes (the same two functions).
--        purchase_events        the purchases' own audit trail (added / changed / deleted), append-only, the owner
--                               reads it, written only by the two functions. Read by audit_feed (6).
--      Managers buy at the market, so they see a receipt's own amounts; they never read finance_entries (owner-only,
--      0013) and nothing here returns another finance figure.
--   3. New triggers on purchases: the day of a receipt is today or up to 3 days back (Tashkent) when it is added or its
--      day is changed; nothing dated in a closed month (0015) is added, changed or deleted.
--   4. New trigger finance_entries_guard_purchase on public.finance_entries (before update or delete): a ledger row that
--      mirrors a purchase is refused (purchase_entry, 55000) unless purchase_save is updating that very row. Finance →
--      Records shows such a row locked, with a link to the purchase. Existing rows and policies are untouched.
--   5. New functions (security definer; each refuses anyone but owners and managers with not_allowed, 42501):
--        purchase_buyers()        id and name of the active payroll employees, nothing else (never a rate or a balance)
--        purchase_locked_through() the last day of the latest closed month, so a receipt there is shown read-only
--        purchase_save(...)       creates or edits a receipt, its lines and its one ledger row; idempotent by request id
--        purchase_delete(...)     removes the receipt, its lines and its ledger row
--        purchases_page(...)      the History tab: a period, search, category and method filters, paging
--        purchases_analytics(...) the Analytics tab
--        purchase_grid(...)       the Sheet tab: ingredients × days
--   Managers may edit or delete a receipt only while its day is in the same 3-day window as a new one (too_old,
--   55000); the owner may change any receipt of an open month.
--   6. public.audit_feed is replaced (create or replace, same arguments and result): a new area 'purchases' reads
--      purchase_events, and the finance rows of a purchase's mirrored ledger entry are left out of the feed, so one
--      purchase shows as one line ("purchase added: 1 250 000, 25 Nov, 6 lines") instead of a purchase line plus a
--      ledger line for the same action. Purchase events are listed under the 'finance' filter too (keeping their own
--      'purchases' area), and a search by the ledger entry's uuid finds them. The audit_log rows are kept as written.
--
-- Money is whole UZS (bigint), quantities numeric(12,3). Unit cost is always derived (amount / quantity), never stored.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0008, 0013, 0015, 0018 and 0019: the role check is the first statement of each public function.

-- ---------- 1. can_handle_stock ----------
create or replace function private.can_handle_stock()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role in ('owner', 'manager')
  );
$$;

revoke all on function private.can_handle_stock() from public;
grant execute on function private.can_handle_stock() to anon, authenticated;

-- Folded text for the purchases search: lower case, ё as е, no apostrophes of any kind (as foldSearchText in
-- src/lib/admin/dish-status.ts), so "goʻsht", "go'sht" and "gosht" find the same ingredient.
create or replace function private.fold_search(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(replace(lower(coalesce(p_text, '')), 'ё', 'е'), '[ʻʼ''‘’`´]', '', 'g');
$$;

revoke all on function private.fold_search(text) from public;

-- ---------- 2a. ingredient_categories ----------
create table public.ingredient_categories (
  id uuid primary key default gen_random_uuid(),
  name_ru text not null check (char_length(btrim(name_ru)) between 1 and 60),
  name_uz text not null check (char_length(btrim(name_uz)) between 1 and 60),
  -- Empty: the panel converts the Latin name (src/lib/data/localized.ts).
  name_uzc text not null default '' check (char_length(name_uzc) <= 60),
  sort int not null default 100 check (sort between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ingredient_categories_name_ru_key on public.ingredient_categories (lower(btrim(name_ru)));
create unique index ingredient_categories_name_uz_key on public.ingredient_categories (lower(btrim(name_uz)));

create trigger ingredient_categories_updated_at
  before update on public.ingredient_categories
  for each row execute function private.set_updated_at();

alter table public.ingredient_categories enable row level security;

revoke all on table public.ingredient_categories from anon, authenticated;
grant select on table public.ingredient_categories to authenticated;
grant insert (name_ru, name_uz, name_uzc, sort) on table public.ingredient_categories to authenticated;
grant update (name_ru, name_uz, name_uzc, sort) on table public.ingredient_categories to authenticated;

create policy "stock reads ingredient categories" on public.ingredient_categories
  for select to authenticated
  using ((select private.can_handle_stock()));

create policy "owner adds ingredient categories" on public.ingredient_categories
  for insert to authenticated
  with check ((select private.is_owner()));

create policy "owner edits ingredient categories" on public.ingredient_categories
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

insert into public.ingredient_categories (name_ru, name_uz, name_uzc, sort) values
  ('Мясо и птица', 'Goʻsht va parranda', 'Гўшт ва парранда', 10),
  ('Рыба и морепродукты', 'Baliq va dengiz mahsulotlari', 'Балиқ ва денгиз маҳсулотлари', 20),
  ('Молочные продукты и яйца', 'Sut mahsulotlari va tuxum', 'Сут маҳсулотлари ва тухум', 30),
  ('Овощи и зелень', 'Sabzavotlar va koʻkatlar', 'Сабзавотлар ва кўкатлар', 40),
  ('Фрукты и ягоды', 'Mevalar va rezavorlar', 'Мевалар ва резаворлар', 50),
  ('Крупы, мука и бобовые', 'Yorma, un va dukkaklilar', 'Ёрма, ун ва дуккаклилар', 60),
  ('Масла и соусы', 'Yogʻlar va souslar', 'Ёғлар ва соуслар', 70),
  ('Специи и приправы', 'Ziravorlar', 'Зираворлар', 80),
  ('Упаковка', 'Qadoqlash', 'Қадоқлаш', 90),
  ('Прочее', 'Boshqa', 'Бошқа', 100);

-- ---------- 2b. ingredients ----------
-- unit is how it is bought and priced: kg, l, pcs (pieces) or pack. usual_price is whole UZS per unit (null =
-- unknown). pieces_per_unit is how many pieces one unit holds (30 eggs in a tray), for the tech cards of slice 7.
-- archived_at hides an ingredient from the pickers; it is never deleted, so receipts keep their lines.
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name_ru text not null check (char_length(btrim(name_ru)) between 1 and 120),
  name_uz text not null check (char_length(btrim(name_uz)) between 1 and 120),
  name_uzc text not null default '' check (char_length(name_uzc) <= 120),
  category_id uuid not null references public.ingredient_categories (id),
  unit text not null check (unit in ('kg', 'l', 'pcs', 'pack')),
  usual_price bigint check (usual_price is null or (usual_price > 0 and usual_price <= 100000000000)),
  pieces_per_unit int check (pieces_per_unit is null or (pieces_per_unit between 1 and 100000)),
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active ingredient per name (either language, case-insensitive); an archived one may share it.
create unique index ingredients_name_ru_key on public.ingredients (lower(btrim(name_ru))) where archived_at is null;
create unique index ingredients_name_uz_key on public.ingredients (lower(btrim(name_uz))) where archived_at is null;
create index ingredients_category_idx on public.ingredients (category_id);
create index ingredients_created_by_idx on public.ingredients (created_by);

create trigger ingredients_updated_at
  before update on public.ingredients
  for each row execute function private.set_updated_at();

alter table public.ingredients enable row level security;

revoke all on table public.ingredients from anon, authenticated;
grant select on table public.ingredients to authenticated;
grant insert (name_ru, name_uz, name_uzc, category_id, unit, usual_price, pieces_per_unit)
  on table public.ingredients to authenticated;
grant update (name_ru, name_uz, name_uzc, category_id, unit, usual_price, pieces_per_unit, archived_at)
  on table public.ingredients to authenticated;

create policy "stock reads ingredients" on public.ingredients
  for select to authenticated
  using ((select private.can_handle_stock()));

create policy "stock adds ingredients" on public.ingredients
  for insert to authenticated
  with check ((select private.can_handle_stock()) and created_by = (select auth.uid()) and archived_at is null);

create policy "stock edits ingredients" on public.ingredients
  for update to authenticated
  using ((select private.can_handle_stock()))
  with check ((select private.can_handle_stock()));

-- ---------- 2c. purchases ----------
-- One market receipt. finance_entry_id is its one ledger row (expense / ingredients, amount = total, same day and
-- payment method, counterparty = the buyer's name). request_id is the idempotency key of the save that created it;
-- last_request_id that of the latest edit. buyer_name is a snapshot, so the receipt keeps its buyer's name.
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  day date not null check (day >= date '2024-01-01'),
  buyer_id uuid references public.finance_employees (id) on delete set null,
  buyer_name text not null default '' check (char_length(buyer_name) <= 120),
  payment_method text not null check (payment_method in ('cash', 'card', 'transfer')),
  note text not null default '' check (char_length(note) <= 500),
  total bigint not null check (total > 0 and total <= 100000000000),
  finance_entry_id uuid not null unique references public.finance_entries (id),
  request_id uuid not null unique,
  last_request_id uuid,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchases_day_idx on public.purchases (day desc, created_at desc);
create index purchases_buyer_idx on public.purchases (buyer_id);
create index purchases_created_by_idx on public.purchases (created_by);
create index purchases_updated_by_idx on public.purchases (updated_by);

alter table public.purchases enable row level security;

revoke all on table public.purchases from anon, authenticated;
grant select on table public.purchases to authenticated;

create policy "stock reads purchases" on public.purchases
  for select to authenticated
  using ((select private.can_handle_stock()));

-- ---------- 2d. purchase_lines ----------
-- ingredient_name, unit and usual_price are snapshots taken when the line was first saved, so the receipt reads as it
-- was even after the catalogue changes (the price difference is against the usual price of that day).
create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  ingredient_name text not null check (char_length(ingredient_name) <= 120),
  unit text not null check (unit in ('kg', 'l', 'pcs', 'pack')),
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 1000000),
  amount bigint not null check (amount > 0 and amount <= 100000000000),
  usual_price bigint check (usual_price is null or usual_price > 0),
  sort int not null default 0
);

create index purchase_lines_purchase_idx on public.purchase_lines (purchase_id, sort);
create index purchase_lines_ingredient_idx on public.purchase_lines (ingredient_id);

alter table public.purchase_lines enable row level security;

revoke all on table public.purchase_lines from anon, authenticated;
grant select on table public.purchase_lines to authenticated;

create policy "stock reads purchase lines" on public.purchase_lines
  for select to authenticated
  using ((select private.can_handle_stock()));

-- ---------- 2e. purchase_events ----------
-- The purchases' audit trail. purchase_id and finance_entry_id carry no foreign key: the row outlives a deleted
-- receipt. summary: { purchase_id, entry_id, entry_date (the receipt's day), amount (its total), payment_method,
-- buyer_name, lines (count), items (up to 5 ingredient names) } and, for a change, changes: { field: { from, to } } and
-- lines_changed. Never the note.
create table public.purchase_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users (id) on delete set null,
  actor_name text not null default '' check (char_length(actor_name) <= 320),
  action text not null check (action in ('added', 'changed', 'deleted')),
  purchase_id uuid not null,
  finance_entry_id uuid not null,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object')
);

create index purchase_events_at_idx on public.purchase_events (at desc, id desc);
create index purchase_events_entry_idx on public.purchase_events (finance_entry_id);
create index purchase_events_actor_idx on public.purchase_events (actor) where actor is not null;

alter table public.purchase_events enable row level security;

revoke all on table public.purchase_events from anon, authenticated;
grant select on table public.purchase_events to authenticated;
-- As audit_log (0019): the server's secret key may read the trail, never write it.
revoke insert, update, delete, truncate on table public.purchase_events from service_role;

create policy "owner reads purchase events" on public.purchase_events
  for select to authenticated
  using ((select private.is_owner()));

-- Append-only for every role, with the guards of audit_log (0019): the only update let through is the "on delete set
-- null" of a removed account; TRUNCATE is refused.
create trigger purchase_events_guard
  before update or delete on public.purchase_events
  for each row execute function private.guard_audit_log_row();

create trigger purchase_events_no_truncate
  before truncate on public.purchase_events
  for each statement execute function private.guard_audit_log_truncate();

-- The one place a purchase event is written: the actor and their name as private.write_audit (0019) takes them.
create or replace function private.write_purchase_event(
  p_action text,
  p_purchase_id uuid,
  p_entry_id uuid,
  p_summary jsonb
)
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

  insert into public.purchase_events (actor, actor_name, action, purchase_id, finance_entry_id, summary)
  values (
    v_actor,
    left(coalesce(v_name, ''), 320),
    p_action,
    p_purchase_id,
    p_entry_id,
    jsonb_strip_nulls(coalesce(p_summary, '{}'::jsonb))
  );
end;
$$;

revoke all on function private.write_purchase_event(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- A receipt as its events describe it.
create or replace function private.purchase_summary(p_row public.purchases)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'purchase_id', p_row.id,
    'entry_id', p_row.finance_entry_id,
    'entry_date', p_row.day,
    'amount', p_row.total,
    'payment_method', p_row.payment_method,
    'buyer_name', nullif(btrim(p_row.buyer_name), ''),
    'lines', (select count(*)::int from public.purchase_lines l where l.purchase_id = p_row.id),
    'items', (
      select coalesce(jsonb_agg(x.ingredient_name order by x.amount desc, x.sort), '[]'::jsonb)
      from (
        select l.ingredient_name, l.amount, l.sort
        from public.purchase_lines l
        where l.purchase_id = p_row.id
        order by l.amount desc, l.sort
        limit 5
      ) x
    )
  );
$$;

revoke all on function private.purchase_summary(public.purchases) from public, anon, authenticated;

-- ---------- 3. purchases triggers ----------
-- The days a receipt may carry: today or up to 3 days back, in Tashkent (PURCHASE_BACKDATE_DAYS in
-- src/lib/admin/purchases.ts).
create or replace function private.purchase_day_ok(p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_day is not null
    and p_day <= (now() at time zone 'Asia/Tashkent')::date
    and p_day >= (now() at time zone 'Asia/Tashkent')::date - 3;
$$;

revoke all on function private.purchase_day_ok(date) from public;

-- Checked when a receipt is added and when its day is changed; an edit that keeps the day (a fixed quantity on an
-- older receipt) is not refused by it (the closed-month guard below still is).
create or replace function private.check_purchase_day()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.day is distinct from old.day) and not private.purchase_day_ok(new.day) then
    raise exception 'purchase_day'
      using errcode = '22023', detail = ((now() at time zone 'Asia/Tashkent')::date - 3)::text;
  end if;
  return new;
end;
$$;

revoke all on function private.check_purchase_day() from public;

create trigger purchases_check_day
  before insert or update of day on public.purchases
  for each row execute function private.check_purchase_day();

-- Nothing dated up to the end of the latest closed month (0015) is added, changed or deleted (month_closed, 55000), as
-- for ledger entries. Its mirrored ledger row obeys the ledger's own guard (finance_entries_guard_closed) as well.
-- Updates are checked on the receipt's own columns only, so the "on delete set null" of a removed account (created_by,
-- updated_by) still goes through on an old receipt.
create or replace function private.guard_closed_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locked date := private.finance_locked_through();
begin
  if v_locked is not null and (
    (tg_op in ('INSERT', 'UPDATE') and new.day <= v_locked)
    or (tg_op in ('DELETE', 'UPDATE') and old.day <= v_locked)
  ) then
    raise exception 'month_closed' using errcode = '55000', detail = v_locked::text;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.guard_closed_purchase() from public;

create trigger purchases_guard_closed
  before insert or delete or update of day, buyer_id, buyer_name, payment_method, note, total, finance_entry_id
  on public.purchases
  for each row execute function private.guard_closed_purchase();

-- ---------- 4. the ledger row of a purchase is locked ----------
-- A finance_entries row that mirrors a purchase cannot be updated or deleted (purchase_entry, 55000, detail: the
-- purchase id), except by purchase_save while it updates that row: it names the row in the transaction-local setting
-- taomiq.purchase_entry first. Clients cannot set it (the API runs no SQL of theirs) and have no update grant anyway.
-- purchase_delete removes the purchase first, so its ledger row is no longer referenced when it is deleted.
create or replace function private.guard_purchase_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase uuid;
begin
  -- The "on delete set null" of a removed account only clears created_by: let it through.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;
  select p.id into v_purchase from public.purchases p where p.finance_entry_id = old.id;
  if v_purchase is not null
     and coalesce(current_setting('taomiq.purchase_entry', true), '') <> old.id::text then
    raise exception 'purchase_entry' using errcode = '55000', detail = v_purchase::text;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function private.guard_purchase_entry() from public;

create trigger finance_entries_guard_purchase
  before update or delete on public.finance_entries
  for each row execute function private.guard_purchase_entry();

-- ---------- 5a. purchase_buyers ----------
-- Who can be named as the buyer: the active payroll employees, id and name only.
create or replace function public.purchase_buyers()
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
    select e.id, btrim(e.name)
    from public.finance_employees e
    where e.is_active
    order by lower(btrim(e.name)), e.id;
end;
$$;

revoke all on function public.purchase_buyers() from public, anon;
grant execute on function public.purchase_buyers() to authenticated;

-- The last day of the latest closed month (null: none), so the purchase screens can show a receipt there as read-only
-- and keep the day picker out of it. Managers cannot read finance_month_closes (0015); this returns only the day.
create or replace function public.purchase_locked_through()
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return private.finance_locked_through();
end;
$$;

revoke all on function public.purchase_locked_through() from public, anon;
grant execute on function public.purchase_locked_through() to authenticated;

-- ---------- 5b. purchase_save ----------
-- Creates (p_id null) or edits a receipt. p_lines: [{ ingredient_id, quantity (a decimal string or number, up to 3
-- decimals), amount (whole UZS) }], 1..100 lines. The total is the sum of the amounts. Its one ledger row is created
-- or updated in the same transaction.
--
-- Idempotent: a create with a request id that already made a receipt returns that receipt; an edit whose request id is
-- the receipt's last edit returns it unchanged. An edit takes the updated_at the form was loaded with (stale-write
-- guard). An edit that changes nothing writes nothing.
--
-- Returns { id, total, updated_at, replay }. Errors (message, code):
--   not_allowed 42501 · bad_request 22023 · not_found P0002 · stale 55000 · too_old 55000 (a manager editing a
--   receipt dated before the 3-day window; detail: the earliest day) · invalid_method 22023 ·
--   purchase_day 22023 (detail: the earliest day allowed) · note_too_long 22023 · invalid_buyer 22023 ·
--   no_lines 22023 · too_many_lines 22023 · invalid_line / invalid_quantity / invalid_amount / invalid_ingredient /
--   ingredient_archived 22023 (detail: the line's position, from 1) · total_too_large 22023 · month_closed 55000
create or replace function public.purchase_save(
  p_request_id uuid,
  p_id uuid,
  p_day date,
  p_buyer_id uuid,
  p_method text,
  p_note text,
  p_lines jsonb,
  p_loaded_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  v_row public.purchases;
  v_new public.purchases;
  v_buyer_name text := '';
  v_buyer_active boolean;
  v_total bigint := 0;
  v_item record;
  v_ing uuid;
  v_qty numeric;
  v_amount bigint;
  v_ingredient public.ingredients;
  v_old_line public.purchase_lines;
  v_lines jsonb := '[]'::jsonb;
  v_old_cmp jsonb;
  v_new_cmp jsonb;
  v_entry uuid;
  v_before jsonb;
  v_after jsonb;
  v_changes jsonb;
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'bad_request' using errcode = '22023';
  end if;

  if p_id is null then
    select * into v_row from public.purchases p where p.request_id = p_request_id;
    if found then
      return jsonb_build_object('id', v_row.id, 'total', v_row.total, 'updated_at', v_row.updated_at, 'replay', true);
    end if;
  else
    select * into v_row from public.purchases p where p.id = p_id for update;
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if v_row.last_request_id = p_request_id then
      return jsonb_build_object('id', v_row.id, 'total', v_row.total, 'updated_at', v_row.updated_at, 'replay', true);
    end if;
    if p_loaded_at is null or v_row.updated_at is distinct from p_loaded_at then
      raise exception 'stale' using errcode = '55000';
    end if;
    -- A manager changes only recent receipts (the window of a new one); the owner any receipt of an open month.
    if not private.is_owner() and not private.purchase_day_ok(v_row.day) then
      raise exception 'too_old'
        using errcode = '55000', detail = ((now() at time zone 'Asia/Tashkent')::date - 3)::text;
    end if;
  end if;

  if p_method is null or p_method not in ('cash', 'card', 'transfer') then
    raise exception 'invalid_method' using errcode = '22023';
  end if;
  -- An edit may keep its day (the trigger checks only a new or changed day).
  if (p_id is null or p_day is distinct from v_row.day) and not private.purchase_day_ok(p_day) then
    raise exception 'purchase_day'
      using errcode = '22023', detail = ((now() at time zone 'Asia/Tashkent')::date - 3)::text;
  end if;
  if char_length(v_note) > 500 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  -- The buyer: an active employee, or the one the receipt already names (who may have left since).
  if p_buyer_id is not null then
    select btrim(e.name), e.is_active into v_buyer_name, v_buyer_active
    from public.finance_employees e where e.id = p_buyer_id;
    if not found or (not v_buyer_active and (p_id is null or v_row.buyer_id is distinct from p_buyer_id)) then
      raise exception 'invalid_buyer' using errcode = '22023';
    end if;
    if p_id is not null and v_row.buyer_id = p_buyer_id and not v_buyer_active then
      v_buyer_name := v_row.buyer_name;
    end if;
  end if;
  v_buyer_name := left(coalesce(v_buyer_name, ''), 120);

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'too_many_lines' using errcode = '22023';
  end if;

  for v_item in select l.value, l.ord from jsonb_array_elements(p_lines) with ordinality as l(value, ord) loop
    if jsonb_typeof(v_item.value) <> 'object' then
      raise exception 'invalid_line' using errcode = '22023', detail = v_item.ord::text;
    end if;
    begin
      v_ing := (v_item.value ->> 'ingredient_id')::uuid;
      v_qty := (v_item.value ->> 'quantity')::numeric;
      v_amount := (v_item.value ->> 'amount')::bigint;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'invalid_line' using errcode = '22023', detail = v_item.ord::text;
    end;
    if v_ing is null then
      raise exception 'invalid_ingredient' using errcode = '22023', detail = v_item.ord::text;
    end if;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 or v_qty <> round(v_qty, 3) then
      raise exception 'invalid_quantity' using errcode = '22023', detail = v_item.ord::text;
    end if;
    if v_amount is null or v_amount <= 0 or v_amount > 100000000000 then
      raise exception 'invalid_amount' using errcode = '22023', detail = v_item.ord::text;
    end if;

    select * into v_ingredient from public.ingredients i where i.id = v_ing;
    if not found then
      raise exception 'invalid_ingredient' using errcode = '22023', detail = v_item.ord::text;
    end if;

    -- A line of the same ingredient already on this receipt keeps its snapshots (name, unit, usual price of the day).
    v_old_line := null;
    if p_id is not null then
      select * into v_old_line from public.purchase_lines l
      where l.purchase_id = p_id and l.ingredient_id = v_ing
      order by l.sort
      limit 1;
    end if;
    if v_ingredient.archived_at is not null and v_old_line.id is null then
      raise exception 'ingredient_archived' using errcode = '22023', detail = v_item.ord::text;
    end if;

    v_total := v_total + v_amount;
    if v_total > 100000000000 then
      raise exception 'total_too_large' using errcode = '22023';
    end if;

    v_lines := v_lines || jsonb_build_object(
      'ingredient_id', v_ing,
      'ingredient_name', coalesce(v_old_line.ingredient_name, left(btrim(v_ingredient.name_ru), 120)),
      'unit', coalesce(v_old_line.unit, v_ingredient.unit),
      'quantity', v_qty,
      'amount', v_amount,
      'usual_price', case when v_old_line.id is not null then v_old_line.usual_price else v_ingredient.usual_price end,
      'sort', v_item.ord
    );
  end loop;

  if p_id is null then
    -- A second save of the same request waits on the request id's unique index and lands in the handler, which
    -- returns the receipt the first one made. The block's savepoint undoes this attempt's ledger row.
    begin
      insert into public.finance_entries (entry_type, entry_date, category, payment_method, amount, counterparty, note)
      values ('expense', p_day, 'ingredients', p_method, v_total, nullif(v_buyer_name, ''), nullif(v_note, ''))
      returning id into v_entry;

      insert into public.purchases (
        day, buyer_id, buyer_name, payment_method, note, total, finance_entry_id, request_id, last_request_id,
        created_by, updated_by
      )
      values (
        p_day, p_buyer_id, v_buyer_name, p_method, v_note, v_total, v_entry, p_request_id, p_request_id, v_uid, v_uid
      )
      returning * into v_new;
    exception
      when unique_violation then
        select * into v_row from public.purchases p where p.request_id = p_request_id;
        if found then
          return jsonb_build_object('id', v_row.id, 'total', v_row.total, 'updated_at', v_row.updated_at, 'replay', true);
        end if;
        raise;
    end;

    insert into public.purchase_lines (purchase_id, ingredient_id, ingredient_name, unit, quantity, amount, usual_price, sort)
    select v_new.id, (x ->> 'ingredient_id')::uuid, x ->> 'ingredient_name', x ->> 'unit', (x ->> 'quantity')::numeric,
           (x ->> 'amount')::bigint, (x ->> 'usual_price')::bigint, (x ->> 'sort')::int
    from jsonb_array_elements(v_lines) as x;

    perform private.write_purchase_event('added', v_new.id, v_entry, private.purchase_summary(v_new));
    return jsonb_build_object('id', v_new.id, 'total', v_new.total, 'updated_at', v_new.updated_at, 'replay', false);
  end if;

  -- An edit: nothing written when nothing changed.
  select coalesce(
    jsonb_agg(jsonb_build_object('i', l.ingredient_id, 'q', l.quantity, 'a', l.amount) order by l.sort, l.id),
    '[]'::jsonb
  )
    into v_old_cmp
  from public.purchase_lines l where l.purchase_id = p_id;
  select coalesce(
    jsonb_agg(jsonb_build_object('i', x ->> 'ingredient_id', 'q', (x ->> 'quantity')::numeric, 'a', (x ->> 'amount')::bigint)
      order by (x ->> 'sort')::int),
    '[]'::jsonb
  )
    into v_new_cmp
  from jsonb_array_elements(v_lines) as x;

  if v_old_cmp = v_new_cmp
     and p_day = v_row.day
     and p_buyer_id is not distinct from v_row.buyer_id
     and p_method = v_row.payment_method
     and v_note = v_row.note then
    return jsonb_build_object('id', v_row.id, 'total', v_row.total, 'updated_at', v_row.updated_at, 'replay', false);
  end if;

  v_before := private.purchase_summary(v_row);

  update public.purchases p
  set day = p_day,
      buyer_id = p_buyer_id,
      buyer_name = v_buyer_name,
      payment_method = p_method,
      note = v_note,
      total = v_total,
      last_request_id = p_request_id,
      updated_by = v_uid,
      updated_at = now()
  where p.id = p_id
  returning * into v_new;

  delete from public.purchase_lines l where l.purchase_id = p_id;
  insert into public.purchase_lines (purchase_id, ingredient_id, ingredient_name, unit, quantity, amount, usual_price, sort)
  select p_id, (x ->> 'ingredient_id')::uuid, x ->> 'ingredient_name', x ->> 'unit', (x ->> 'quantity')::numeric,
         (x ->> 'amount')::bigint, (x ->> 'usual_price')::bigint, (x ->> 'sort')::int
  from jsonb_array_elements(v_lines) as x;

  perform set_config('taomiq.purchase_entry', v_row.finance_entry_id::text, true);
  update public.finance_entries f
  set entry_date = p_day,
      payment_method = p_method,
      amount = v_total,
      counterparty = nullif(v_buyer_name, ''),
      note = nullif(v_note, '')
  where f.id = v_row.finance_entry_id;
  perform set_config('taomiq.purchase_entry', '', true);

  v_after := private.purchase_summary(v_new);
  v_changes := private.audit_changes(v_before, v_after, array['entry_date', 'amount', 'payment_method', 'buyer_name', 'lines']);
  perform private.write_purchase_event(
    'changed', v_new.id, v_new.finance_entry_id,
    v_after || jsonb_build_object(
      'changes', v_changes,
      'lines_changed', case when v_old_cmp <> v_new_cmp then true end,
      'note_changed', case when v_note <> v_row.note then true end
    )
  );

  return jsonb_build_object('id', v_new.id, 'total', v_new.total, 'updated_at', v_new.updated_at, 'replay', false);
end;
$$;

revoke all on function public.purchase_save(uuid, uuid, date, uuid, text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.purchase_save(uuid, uuid, date, uuid, text, text, jsonb, timestamptz) to authenticated;

-- ---------- 5c. purchase_delete ----------
-- Removes a receipt, its lines and its ledger row. p_loaded_at (optional) is the updated_at the page showed: a receipt
-- changed since is not deleted (stale). Deleting one that is already gone returns false. Errors: not_allowed 42501 ·
-- stale 55000 · too_old 55000 (a manager, a receipt dated before the 3-day window) · month_closed 55000.
create or replace function public.purchase_delete(p_id uuid, p_loaded_at timestamptz default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.purchases;
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select * into v_row from public.purchases p where p.id = p_id for update;
  if not found then
    return false;
  end if;
  if p_loaded_at is not null and v_row.updated_at is distinct from p_loaded_at then
    raise exception 'stale' using errcode = '55000';
  end if;
  if not private.is_owner() and not private.purchase_day_ok(v_row.day) then
    raise exception 'too_old'
      using errcode = '55000', detail = ((now() at time zone 'Asia/Tashkent')::date - 3)::text;
  end if;

  perform private.write_purchase_event('deleted', v_row.id, v_row.finance_entry_id, private.purchase_summary(v_row));

  delete from public.purchases p where p.id = v_row.id;
  perform set_config('taomiq.purchase_entry', v_row.finance_entry_id::text, true);
  delete from public.finance_entries f where f.id = v_row.finance_entry_id;
  perform set_config('taomiq.purchase_entry', '', true);
  return true;
end;
$$;

revoke all on function public.purchase_delete(uuid, timestamptz) from public, anon;
grant execute on function public.purchase_delete(uuid, timestamptz) to authenticated;

-- ---------- 5d. purchases_page ----------
-- The History tab: receipts dated p_from .. p_to (at most 366 days), newest first, optionally matching a search (an
-- ingredient name in any language, the buyer, the note; folded as private.fold_search), with a line of a category,
-- paid by a method. { rows: [{ id, day, created_at, updated_at, buyer_name, payment_method, total, note, lines,
-- items: [{ name_ru, name_uz, name_uzc }] (the 4 largest lines) }], count, amount (of every matching receipt), page,
-- pages }. A page past the end is clamped to the last one.
create or replace function public.purchases_page(
  p_from date,
  p_to date,
  p_search text default null,
  p_category uuid default null,
  p_method text default null,
  p_page int default 1,
  p_page_size int default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_size int := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_search text := private.fold_search(left(btrim(coalesce(p_search, '')), 60));
  v_like text;
  v_result jsonb;
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;
  if p_method is not null and p_method not in ('cash', 'card', 'transfer') then
    raise exception 'bad_method' using errcode = '22023';
  end if;

  if v_search <> '' then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with m as materialized (
    select p.*
    from public.purchases p
    where p.day between p_from and p_to
      and (p_method is null or p.payment_method = p_method)
      and (p_category is null or exists (
        select 1 from public.purchase_lines l
        join public.ingredients i on i.id = l.ingredient_id
        where l.purchase_id = p.id and i.category_id = p_category
      ))
      and (v_like is null
        or private.fold_search(p.buyer_name) like v_like
        or private.fold_search(p.note) like v_like
        or exists (
          select 1 from public.purchase_lines l
          join public.ingredients i on i.id = l.ingredient_id
          where l.purchase_id = p.id
            and (private.fold_search(i.name_ru) like v_like
              or private.fold_search(i.name_uz) like v_like
              or private.fold_search(i.name_uzc) like v_like
              or private.fold_search(l.ingredient_name) like v_like)
        ))
  ),
  stats as (
    select count(*)::int as n, coalesce(sum(m.total), 0)::bigint as amount from m
  ),
  paging as (
    select greatest(1, ceil(s.n::numeric / v_size)::int) as pages from stats s
  ),
  pg as (
    select m.*
    from m, paging
    order by m.day desc, m.created_at desc, m.id
    offset (least(v_page, (select pages from paging)) - 1) * v_size
    limit v_size
  )
  select jsonb_build_object(
    'count', (select n from stats),
    'amount', (select amount from stats),
    'pages', (select pages from paging),
    'page', least(v_page, (select pages from paging)),
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pg.id,
        'day', pg.day,
        'created_at', pg.created_at,
        'updated_at', pg.updated_at,
        'buyer_name', pg.buyer_name,
        'payment_method', pg.payment_method,
        'total', pg.total,
        'note', pg.note,
        'lines', (select count(*)::int from public.purchase_lines l where l.purchase_id = pg.id),
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object('name_ru', x.name_ru, 'name_uz', x.name_uz, 'name_uzc', x.name_uzc)
            order by x.amount desc, x.sort), '[]'::jsonb)
          from (
            select i.name_ru, i.name_uz, i.name_uzc, l.amount, l.sort
            from public.purchase_lines l
            join public.ingredients i on i.id = l.ingredient_id
            where l.purchase_id = pg.id
            order by l.amount desc, l.sort
            limit 4
          ) x
        )
      ) order by pg.day desc, pg.created_at desc, pg.id), '[]'::jsonb)
      from pg
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.purchases_page(date, date, text, uuid, text, int, int) from public, anon;
grant execute on function public.purchases_page(date, date, text, uuid, text, int, int) to authenticated;

-- ---------- 5e. purchases_analytics ----------
-- The Analytics tab for p_from .. p_to (at most 366 days):
--   { total, receipts, days (in the period), days_with_purchases, ingredients (distinct),
--     by_day: [{ day, amount }]                         every day of the period, oldest first
--     by_category: [{ id, name_ru, name_uz, name_uzc, amount }]   largest first
--     by_method: [{ method, amount, receipts }]         largest first
--     by_buyer: [{ name, amount, receipts }]            '' for receipts without a buyer, largest first
--     top: [{ ingredient_id, name_ru, name_uz, name_uzc, unit, quantity, amount, lines, avg_cost, latest_cost,
--             latest_day, usual_price }]                the 20 largest by amount, per ingredient and unit }
-- avg_cost is Σ amount / Σ quantity, latest_cost that of the latest line, both rounded to whole UZS per unit.
create or replace function public.purchases_analytics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  with p as materialized (
    select * from public.purchases x where x.day between p_from and p_to
  ),
  l as materialized (
    select ln.*, p.day, p.created_at as p_created_at, i.category_id
    from public.purchase_lines ln
    join p on p.id = ln.purchase_id
    join public.ingredients i on i.id = ln.ingredient_id
  ),
  top as (
    select
      l.ingredient_id,
      l.unit,
      sum(l.quantity) as quantity,
      sum(l.amount)::bigint as amount,
      count(*)::int as lines
    from l
    group by l.ingredient_id, l.unit
    order by sum(l.amount) desc, l.ingredient_id
    limit 20
  )
  select jsonb_build_object(
    'total', (select coalesce(sum(p.total), 0)::bigint from p),
    'receipts', (select count(*)::int from p),
    'days', (p_to - p_from + 1),
    'days_with_purchases', (select count(distinct p.day)::int from p),
    'ingredients', (select count(distinct l.ingredient_id)::int from l),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.d, 'amount', coalesce(s.amount, 0)) order by d.d), '[]'::jsonb)
      from (select gs::date as d from generate_series(p_from, p_to, interval '1 day') gs) d
      left join (select p.day, sum(p.total)::bigint as amount from p group by p.day) s on s.day = d.d
    ),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_ru', c.name_ru, 'name_uz', c.name_uz, 'name_uzc', c.name_uzc, 'amount', s.amount
      ) order by s.amount desc, c.sort, c.id), '[]'::jsonb)
      from (select l.category_id, sum(l.amount)::bigint as amount from l group by l.category_id) s
      join public.ingredient_categories c on c.id = s.category_id
    ),
    'by_method', (
      select coalesce(jsonb_agg(jsonb_build_object('method', s.payment_method, 'amount', s.amount, 'receipts', s.receipts)
        order by s.amount desc, s.payment_method), '[]'::jsonb)
      from (
        select p.payment_method, sum(p.total)::bigint as amount, count(*)::int as receipts from p group by p.payment_method
      ) s
    ),
    'by_buyer', (
      select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'amount', s.amount, 'receipts', s.receipts)
        order by s.amount desc, s.name), '[]'::jsonb)
      from (
        select btrim(p.buyer_name) as name, sum(p.total)::bigint as amount, count(*)::int as receipts
        from p group by btrim(p.buyer_name)
      ) s
    ),
    'top', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ingredient_id', t.ingredient_id,
        'name_ru', i.name_ru,
        'name_uz', i.name_uz,
        'name_uzc', i.name_uzc,
        'unit', t.unit,
        'quantity', t.quantity,
        'amount', t.amount,
        'lines', t.lines,
        'avg_cost', round(t.amount / nullif(t.quantity, 0))::bigint,
        'latest_cost', (
          select round(z.amount / z.quantity)::bigint
          from l z
          where z.ingredient_id = t.ingredient_id and z.unit = t.unit
          order by z.day desc, z.p_created_at desc, z.sort desc
          limit 1
        ),
        'latest_day', (
          select max(z.day) from l z where z.ingredient_id = t.ingredient_id and z.unit = t.unit
        ),
        'usual_price', case when i.unit = t.unit then i.usual_price end
      ) order by t.amount desc, t.ingredient_id), '[]'::jsonb)
      from top t
      join public.ingredients i on i.id = t.ingredient_id
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.purchases_analytics(date, date) from public, anon;
grant execute on function public.purchases_analytics(date, date) to authenticated;

-- ---------- 5f. purchase_grid ----------
-- The Sheet tab: what was bought of each ingredient on each day of p_from .. p_to (at most 62 days).
--   [{ ingredient_id, name_ru, name_uz, name_uzc, category_id, unit, usual_price (current, null when the unit
--      changed since), quantity, amount, cells: [{ day, quantity, amount, receipts, buyers: [name] }] }]
-- One row per ingredient and line unit, ordered by category, then the Russian name.
create or replace function public.purchase_grid(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 61 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  with l as materialized (
    select ln.ingredient_id, ln.unit, ln.quantity, ln.amount, p.day, btrim(p.buyer_name) as buyer, p.id as purchase_id
    from public.purchase_lines ln
    join public.purchases p on p.id = ln.purchase_id
    where p.day between p_from and p_to
  ),
  cells as (
    select
      l.ingredient_id,
      l.unit,
      l.day,
      sum(l.quantity) as quantity,
      sum(l.amount)::bigint as amount,
      count(distinct l.purchase_id)::int as receipts,
      coalesce(jsonb_agg(distinct l.buyer) filter (where l.buyer <> ''), '[]'::jsonb) as buyers
    from l
    group by l.ingredient_id, l.unit, l.day
  ),
  grid_rows as (
    select
      c.ingredient_id,
      c.unit,
      sum(c.quantity) as quantity,
      sum(c.amount)::bigint as amount,
      jsonb_agg(jsonb_build_object(
        'day', c.day, 'quantity', c.quantity, 'amount', c.amount, 'receipts', c.receipts, 'buyers', c.buyers
      ) order by c.day) as cells
    from cells c
    group by c.ingredient_id, c.unit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'ingredient_id', r.ingredient_id,
    'name_ru', i.name_ru,
    'name_uz', i.name_uz,
    'name_uzc', i.name_uzc,
    'category_id', i.category_id,
    'unit', r.unit,
    'usual_price', case when i.unit = r.unit then i.usual_price end,
    'quantity', r.quantity,
    'amount', r.amount,
    'cells', r.cells
  ) order by cat.sort, cat.id, lower(i.name_ru), r.unit), '[]'::jsonb)
  into v_result
  from grid_rows r
  join public.ingredients i on i.id = r.ingredient_id
  join public.ingredient_categories cat on cat.id = i.category_id;

  return v_result;
end;
$$;

revoke all on function public.purchase_grid(date, date) from public, anon;
grant execute on function public.purchase_grid(date, date) to authenticated;

-- ---------- 6. audit_feed with purchases ----------
-- The body of 0019 with additions marked "0022": the 'purchases' area, the pe source (purchase_events, item keys
-- 'p' + id; also under the 'finance' filter, and found by its ledger entry's uuid) and the finance rows of a
-- purchase's ledger entry left out of the log source (the purchase's own event names the same change). target_exists
-- knows purchases.
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

  -- 0022: 'purchases'.
  if p_area is not null and p_area not in ('finance', 'payroll', 'team', 'settings', 'catalog', 'orders', 'purchases') then
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
    u as (
      select * from lg
      union all
      select * from cl
      union all
      select * from oe
      union all
      select * from pe
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
        else false
      end
    from u
    order by u.t_at desc, u.k desc
    limit v_limit;
end;
$$;

revoke all on function public.audit_feed(text, text, timestamptz, text, int) from public, anon;
grant execute on function public.audit_feed(text, text, timestamptz, text, int) to authenticated;
