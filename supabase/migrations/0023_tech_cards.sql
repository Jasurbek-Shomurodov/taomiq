-- Tech cards, dish cost and the shopping list: a recipe per dish (ingredients from the catalogue of 0022 with a quantity
-- for one batch, the batch's cooked weight, the method and notes), the cost of a dish from the ingredients' usual
-- prices, the cost of a day's ration per calorie level, the kitchen's shopping list for a day, and purchases against
-- theoretical use. Dishes are archived instead of deleted.
-- Plan: docs/plans/zarkebab-feature-port.md, slice 7.
--
-- Additive only. No existing row is changed or removed; no existing policy, grant or function is altered:
--   1. public.dishes gains archived_at (null = in use) and the check dishes_archived_not_active (an archived dish is
--      never active). Every existing row has archived_at null, so the check holds for all of them. Because an archived
--      dish is always inactive, the existing "public read dishes" policy (active or staff, 0001/0002) already hides it
--      from the public site, and every reader that filters on active (the menu editor's picker, the site's menu)
--      treats it the same: no policy needed changing. Two new triggers:
--        dishes_check_archive      archiving a dish that is on the 30-day menu is refused (dish_on_menu, 55000,
--                                  detail: the number of menu places); archiving switches the dish off (active false)
--        menu_items_check_dish     an archived dish cannot be put on the menu (dish_archived, 55000)
--   2. New tables, RLS on, readable by every staff member (cooks need the recipe), written only by tech_card_save:
--        tech_cards        one per dish: batch output (cooked grams the recipe yields), method, notes
--        tech_card_lines   ingredient, quantity, unit (g, ml or pcs), order; one line per ingredient and dish
--      Neither holds a price, so a cook reading them never sees money. A line's unit must fit the ingredient's
--      purchase unit (kg ↔ g, l ↔ ml, pcs ↔ pcs, pack ↔ pcs), checked by a trigger (unit_mismatch, 22023).
--   3. The cost rule, once (private.to_purchase_qty, private.line_cost, private.tech_card_rows): a line's quantity in
--      the ingredient's purchase unit (g → kg ÷ 1000, ml → l ÷ 1000, pcs → pcs, pcs → pack ÷ pieces_per_unit) × its
--      usual price; a card's cost per gram = Σ line costs ÷ batch output. A missing card, a card without lines, a line
--      that cannot be converted or an ingredient without a usual price makes the cost unknown (null), never zero.
--      numeric throughout; rounded to whole UZS only in what the functions return.
--   4. New functions (security definer; each checks the role first: not_allowed, 42501):
--        tech_card_overview()            all staff: per dish, whether it has a recipe (no money)
--        tech_card_recipes(ids)          all staff: recipes with ingredient names and quantities (no money)
--        dish_costs()                    owners and managers: per dish, cost of a batch, per 100 g and per portion
--        tech_card_cost_preview(...)     owners and managers: the same rule for a recipe being edited
--        tech_card_save(...)             owners and managers: creates or replaces a dish's card and its lines
--        ration_costs(cycle_day)         owner: per calorie level and cycle day, the ration's cost against its price
--        shopping_list(from, days)       all staff: what to buy for the firm rations of 1–7 days, quantities only
--        shopping_list_costed(from, days) owners and managers: the same with the usual price and amount
--        ingredient_usage(from, to)      owners and managers: bought (0022) against theoretical use, an estimate
--
-- Which rations count: shopping_list counts the firm rations (paid or active orders, the rule of kitchen_orders in
-- 0009); ingredient_usage counts the rations of paid, active and completed orders on days up to today (delivered),
-- and of an order cancelled after payment the days before its cancellation day.
-- The cycle day of a date follows the cycle_anchor setting with the same fallback as the site (2026-12-01).
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0008, 0013, 0015, 0018, 0019 and 0022: the role check is the first statement of each public function.

-- ---------- 1. dishes: archive instead of delete ----------
alter table public.dishes add column archived_at timestamptz;

alter table public.dishes
  add constraint dishes_archived_not_active check (archived_at is null or not active);

create index dishes_archived_idx on public.dishes (archived_at) where archived_at is not null;

-- Archiving: refused while the dish is on the menu (replace it there first); otherwise the dish is switched off too.
create or replace function private.check_dish_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_places int;
begin
  if new.archived_at is not null and old.archived_at is null then
    select count(*)::int into v_places from public.menu_items m where m.dish_id = new.id;
    if v_places > 0 then
      raise exception 'dish_on_menu' using errcode = '55000', detail = v_places::text;
    end if;
    new.active := false;
  end if;
  return new;
end;
$$;

revoke all on function private.check_dish_archive() from public;

create trigger dishes_check_archive
  before update of archived_at on public.dishes
  for each row execute function private.check_dish_archive();

-- The menu never gets an archived dish. The dish row is locked (for share) before the check, so an archive and a menu
-- write of the same dish at the same moment cannot both pass: whichever comes second waits for the first, then sees it
-- (the archiver's count of menu places runs after the wait; this check reads the archived row after the archive).
create or replace function private.check_menu_dish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived timestamptz;
begin
  select d.archived_at into v_archived from public.dishes d where d.id = new.dish_id for share;
  if v_archived is not null then
    raise exception 'dish_archived' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.check_menu_dish() from public;

create trigger menu_items_check_dish
  before insert or update of dish_id on public.menu_items
  for each row execute function private.check_menu_dish();

-- ---------- 2a. tech_cards ----------
-- batch_output_g is the cooked weight one batch of the recipe yields; the lines are the quantities for that batch.
create table public.tech_cards (
  dish_id uuid primary key references public.dishes (id) on delete cascade,
  batch_output_g int not null check (batch_output_g between 1 and 1000000),
  method text not null default '' check (char_length(method) <= 4000),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create index tech_cards_updated_by_idx on public.tech_cards (updated_by);

alter table public.tech_cards enable row level security;

revoke all on table public.tech_cards from anon, authenticated;
grant select on table public.tech_cards to authenticated;

create policy "staff read tech cards" on public.tech_cards
  for select to authenticated
  using ((select private.is_staff()));

-- ---------- 2b. tech_card_lines ----------
create table public.tech_card_lines (
  id uuid primary key default gen_random_uuid(),
  dish_id uuid not null references public.tech_cards (dish_id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  quantity numeric(12, 3) not null check (quantity > 0 and quantity <= 1000000),
  unit text not null check (unit in ('g', 'ml', 'pcs')),
  sort int not null default 0,
  unique (dish_id, ingredient_id)
);

create index tech_card_lines_ingredient_idx on public.tech_card_lines (ingredient_id);

alter table public.tech_card_lines enable row level security;

revoke all on table public.tech_card_lines from anon, authenticated;
grant select on table public.tech_card_lines to authenticated;

create policy "staff read tech card lines" on public.tech_card_lines
  for select to authenticated
  using ((select private.is_staff()));

-- Which line unit fits which purchase unit (TECH_UNIT_FOR in src/lib/admin/tech-cards.ts).
create or replace function private.line_unit_fits(p_line_unit text, p_ingredient_unit text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_ingredient_unit = 'kg' and p_line_unit = 'g')
      or (p_ingredient_unit = 'l' and p_line_unit = 'ml')
      or (p_ingredient_unit in ('pcs', 'pack') and p_line_unit = 'pcs');
$$;

revoke all on function private.line_unit_fits(text, text) from public;

create or replace function private.check_tech_card_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit text;
begin
  select i.unit into v_unit from public.ingredients i where i.id = new.ingredient_id;
  if v_unit is null or not private.line_unit_fits(new.unit, v_unit) then
    raise exception 'unit_mismatch' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.check_tech_card_line() from public;

create trigger tech_card_lines_check_unit
  before insert or update of ingredient_id, unit on public.tech_card_lines
  for each row execute function private.check_tech_card_line();

-- ---------- 3. the cost rule ----------
-- A recipe quantity in the ingredient's purchase unit; null when it cannot be converted (the units do not fit, or a
-- pack without its number of pieces).
create or replace function private.to_purchase_qty(p_qty numeric, p_line_unit text, p_ing_unit text, p_pieces int)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_qty is null then null
    when p_ing_unit = 'kg' and p_line_unit = 'g' then p_qty / 1000
    when p_ing_unit = 'l' and p_line_unit = 'ml' then p_qty / 1000
    when p_ing_unit = 'pcs' and p_line_unit = 'pcs' then p_qty
    when p_ing_unit = 'pack' and p_line_unit = 'pcs' and p_pieces > 0 then p_qty / p_pieces
    else null
  end;
$$;

revoke all on function private.to_purchase_qty(numeric, text, text, int) from public;

-- One line's cost in UZS (unrounded); null when the quantity cannot be converted or the price is unknown.
create or replace function private.line_cost(p_qty numeric, p_line_unit text, p_ing_unit text, p_pieces int, p_price bigint)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select private.to_purchase_qty(p_qty, p_line_unit, p_ing_unit, p_pieces) * p_price;
$$;

revoke all on function private.line_cost(numeric, text, text, int, bigint) from public;

-- The cost of p_grams of a dish whose batch of p_batch_g grams costs p_batch_cost (unrounded); null when unknown.
create or replace function private.cost_of_grams(p_batch_cost numeric, p_batch_g int, p_grams numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_batch_cost is null or p_batch_g is null or p_batch_g <= 0 or p_grams is null then null
              else p_batch_cost * p_grams / p_batch_g end;
$$;

revoke all on function private.cost_of_grams(numeric, int, numeric) from public;

-- Money as returned by the functions: whole UZS, or null for an amount no kitchen could reach (a recipe of a million
-- pieces at the largest price), so an absurd input never fails a whole list on the bigint cast.
create or replace function private.uzs(p_value numeric)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_value is not null and abs(p_value) < 1e15 then round(p_value)::bigint end;
$$;

revoke all on function private.uzs(numeric) from public;

-- Every tech card with its state and cost:
--   state  'empty' (no lines) · 'unit' (a line cannot be converted) · 'price' (an ingredient has no usual price) ·
--          'ok' (the cost is known)
--   batch_cost  Σ line costs, only when the state is 'ok'
create or replace function private.tech_card_rows()
returns table (
  dish_id uuid,
  state text,
  lines int,
  batch_output_g int,
  batch_cost numeric,
  missing_prices int,
  bad_units int,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.dish_id,
    case
      when count(l.id) = 0 then 'empty'
      when count(l.id) filter (where x.qty is null) > 0 then 'unit'
      when count(l.id) filter (where i.usual_price is null) > 0 then 'price'
      else 'ok'
    end,
    count(l.id)::int,
    c.batch_output_g,
    case
      when count(l.id) > 0 and count(l.id) filter (where x.cost is null) = 0 then sum(x.cost)
    end,
    count(l.id) filter (where x.qty is not null and i.usual_price is null)::int,
    count(l.id) filter (where x.qty is null)::int,
    c.updated_at
  from public.tech_cards c
  left join public.tech_card_lines l on l.dish_id = c.dish_id
  left join public.ingredients i on i.id = l.ingredient_id
  left join lateral (
    select
      private.to_purchase_qty(l.quantity, l.unit, i.unit, i.pieces_per_unit) as qty,
      private.line_cost(l.quantity, l.unit, i.unit, i.pieces_per_unit, i.usual_price) as cost
  ) x on true
  group by c.dish_id, c.batch_output_g, c.updated_at;
$$;

revoke all on function private.tech_card_rows() from public, anon, authenticated;

-- The day of the 30-day cycle on which the menu starts (setting cycle_anchor, a "YYYY-MM-DD" string), with the
-- site's fallback (DEMO_ANCHOR in src/lib/data/demo.ts).
create or replace function private.cycle_anchor()
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value jsonb;
begin
  select s.value into v_value from public.settings s where s.key = 'cycle_anchor';
  if v_value is not null and jsonb_typeof(v_value) = 'string' and (v_value #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      return (v_value #>> '{}')::date;
    exception
      when datetime_field_overflow or invalid_datetime_format then
        return date '2026-12-01';
    end;
  end if;
  return date '2026-12-01';
end;
$$;

revoke all on function private.cycle_anchor() from public, anon, authenticated;

-- Which day of the 30-day cycle a date is (cycleDayFor in src/lib/data/types.ts).
create or replace function private.cycle_day(p_date date, p_anchor date)
returns int
language sql
immutable
set search_path = ''
as $$
  select (((p_date - p_anchor) % 30) + 30) % 30 + 1;
$$;

revoke all on function private.cycle_day(date, date) from public;

-- Rations per calorie level and day, p_from .. p_to, of orders in p_statuses, by the delivery rule of kitchen_orders
-- (0009): on or after the start date, a weekday for a weekdays-only order, day index at most `days`. No personal data.
-- p_cancelled adds the days an order cancelled mid-plan was delivered: an order cancelled from paid or active (the
-- cancellation's from_status in order_events, 0018) counts its delivery days before (not including) the day it was
-- cancelled (Tashkent). An order cancelled before that history existed counts when it had been paid (paid_at, 0013),
-- up to the day of its last change (updated_at). An order cancelled before payment counts no day.
create or replace function private.ration_counts(p_from date, p_to date, p_statuses text[], p_cancelled boolean default false)
returns table (variant_id uuid, day date, rations int)
language sql
stable
security definer
set search_path = ''
as $$
  select o.variant_id, g.d::date, count(*)::int
  from public.orders o
  left join lateral (
    select e.at, e.from_status
    from public.order_events e
    where e.order_id = o.id and e.kind = 'status' and e.to_status = 'cancelled'
    order by e.at desc, e.id desc
    limit 1
  ) ce on o.status = 'cancelled'
  cross join lateral (
    select case
      when o.status <> 'cancelled' then null
      when ce.at is not null then
        case when ce.from_status in ('paid', 'active') then (ce.at at time zone 'Asia/Tashkent')::date end
      when o.paid_at is not null then (o.updated_at at time zone 'Asia/Tashkent')::date
    end as cancel_day
  ) cx
  cross join lateral generate_series(
    greatest(o.start_date, p_from)::timestamp,
    least(p_to, o.start_date + (o.days * 2 + 6), coalesce(cx.cancel_day - 1, p_to))::timestamp,
    interval '1 day'
  ) as g(d)
  where (o.status = any (p_statuses) or (p_cancelled and o.status = 'cancelled' and cx.cancel_day is not null))
    and o.start_date <= p_to
    and o.start_date + (o.days * 2 + 6) >= p_from
    and private.order_day_index(o.start_date, o.weekdays_only, g.d::date) between 1 and o.days
  group by o.variant_id, g.d::date;
$$;

revoke all on function private.ration_counts(date, date, text[], boolean) from public, anon, authenticated;

-- What a set of days needs: per dish, the portions and grams of the rations of p_statuses (rations of a level with no
-- menu that cycle day are counted apart as no_menu), each dish's tech-card state, and per ingredient the quantity in
-- its purchase unit for the dishes whose card can be counted (state 'ok' or 'price': quantities need no price).
-- Shared by shopping_list and ingredient_usage, as jsonb:
--   { rations, no_menu_rations, dishes, counted_dishes,
--     needs: [{ ingredient_id, quantity }],
--     uncounted: [{ dish_id, name_ru, name_uz, name_uzc, state ('none' | 'empty' | 'unit'), portions, grams }] }
create or replace function private.ration_needs(p_from date, p_to date, p_statuses text[], p_cancelled boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_anchor date := private.cycle_anchor();
  v_result jsonb;
begin
  with rc as materialized (
    select r.variant_id, r.day, r.rations, private.cycle_day(r.day, v_anchor) as cycle_day
    from private.ration_counts(p_from, p_to, p_statuses, p_cancelled) r
  ),
  menu as materialized (
    select rc.rations, mi.dish_id, mi.weight_g
    from rc
    join public.menu_items mi on mi.variant_id = rc.variant_id and mi.cycle_day = rc.cycle_day
  ),
  demand as (
    select m.dish_id, sum(m.rations)::bigint as portions, sum(m.rations::bigint * m.weight_g)::bigint as grams
    from menu m
    group by m.dish_id
  ),
  states as materialized (
    select * from private.tech_card_rows()
  ),
  dd as materialized (
    select dm.dish_id, dm.portions, dm.grams, coalesce(s.state, 'none') as state
    from demand dm
    left join states s on s.dish_id = dm.dish_id
  ),
  needs as (
    select l.ingredient_id, sum(dd.grams * x.qty / c.batch_output_g) as quantity
    from dd
    join public.tech_cards c on c.dish_id = dd.dish_id
    join public.tech_card_lines l on l.dish_id = dd.dish_id
    join public.ingredients i on i.id = l.ingredient_id
    cross join lateral (select private.to_purchase_qty(l.quantity, l.unit, i.unit, i.pieces_per_unit) as qty) x
    where dd.state in ('ok', 'price')
    group by l.ingredient_id
  )
  select jsonb_build_object(
    'rations', (select coalesce(sum(rc.rations), 0)::int from rc),
    'no_menu_rations', (
      select coalesce(sum(rc.rations), 0)::int
      from rc
      where not exists (
        select 1 from public.menu_items mi where mi.variant_id = rc.variant_id and mi.cycle_day = rc.cycle_day
      )
    ),
    'dishes', (select count(*)::int from dd),
    'counted_dishes', (select count(*)::int from dd where dd.state in ('ok', 'price')),
    'needs', (
      select coalesce(jsonb_agg(jsonb_build_object('ingredient_id', n.ingredient_id, 'quantity', n.quantity)), '[]'::jsonb)
      from needs n
    ),
    'uncounted', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'dish_id', dd.dish_id,
        'name_ru', d.name_ru,
        'name_uz', d.name_uz,
        'name_uzc', d.name_uzc,
        'state', dd.state,
        'portions', dd.portions,
        'grams', dd.grams
      ) order by dd.grams desc, dd.dish_id), '[]'::jsonb)
      from dd
      left join public.dishes d on d.id = dd.dish_id
      where dd.state not in ('ok', 'price')
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function private.ration_needs(date, date, text[], boolean) from public, anon, authenticated;

-- ---------- 4a. tech_card_overview ----------
-- Every dish (archived ones included, with archived) and whether it has a recipe: 'none' (no card), 'empty' (a card
-- without lines) or 'ready'. No money: the cost states are dish_costs's.
create or replace function public.tech_card_overview()
returns table (dish_id uuid, state text, lines int, batch_output_g int, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
    select c.dish_id,
           case when count(l.id) = 0 then 'empty' else 'ready' end,
           count(l.id)::int,
           c.batch_output_g,
           c.updated_at
    from public.tech_cards c
    left join public.tech_card_lines l on l.dish_id = c.dish_id
    group by c.dish_id, c.batch_output_g, c.updated_at;
end;
$$;

revoke all on function public.tech_card_overview() from public, anon;
grant execute on function public.tech_card_overview() to authenticated;

-- ---------- 4b. tech_card_recipes ----------
-- The recipes of up to 300 dishes, for the card page and the print view, readable by every staff member:
--   [{ dish_id, batch_output_g, method, notes, updated_at, updated_by_name,
--      lines: [{ ingredient_id, name_ru, name_uz, name_uzc, ingredient_unit, quantity, unit, unit_ok, sort }] }]
-- Only dishes that have a card. Never a price.
create or replace function public.tech_card_recipes(p_dish_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_staff() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_dish_ids is null or cardinality(p_dish_ids) > 300 then
    raise exception 'bad_request' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'dish_id', c.dish_id,
    'batch_output_g', c.batch_output_g,
    'method', c.method,
    'notes', c.notes,
    'updated_at', c.updated_at,
    'updated_by_name', (
      select coalesce(nullif(btrim(s.name), ''), '') from public.staff s where s.user_id = c.updated_by
    ),
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ingredient_id', l.ingredient_id,
        'name_ru', i.name_ru,
        'name_uz', i.name_uz,
        'name_uzc', i.name_uzc,
        'ingredient_unit', i.unit,
        'quantity', l.quantity,
        'unit', l.unit,
        'unit_ok', private.to_purchase_qty(l.quantity, l.unit, i.unit, i.pieces_per_unit) is not null,
        'sort', l.sort
      ) order by l.sort, l.id), '[]'::jsonb)
      from public.tech_card_lines l
      join public.ingredients i on i.id = l.ingredient_id
      where l.dish_id = c.dish_id
    )
  ) order by c.dish_id), '[]'::jsonb)
  into v_result
  from public.tech_cards c
  where c.dish_id = any (p_dish_ids);

  return v_result;
end;
$$;

revoke all on function public.tech_card_recipes(uuid[]) from public, anon;
grant execute on function public.tech_card_recipes(uuid[]) to authenticated;

-- ---------- 4c. dish_costs ----------
-- Every dish with its card's state and cost, whole UZS: batch_cost, cost_100 (per 100 g), cost_portion (per the dish's
-- default portion weight). state 'none' when the dish has no card. The costs are null unless the state is 'ok'.
create or replace function public.dish_costs()
returns table (
  dish_id uuid,
  state text,
  lines int,
  batch_output_g int,
  batch_cost bigint,
  cost_100 bigint,
  cost_portion bigint,
  missing_prices int,
  bad_units int
)
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
    select
      d.id,
      coalesce(r.state, 'none'),
      coalesce(r.lines, 0),
      r.batch_output_g,
      private.uzs(r.batch_cost),
      private.uzs(private.cost_of_grams(r.batch_cost, r.batch_output_g, 100)),
      private.uzs(private.cost_of_grams(r.batch_cost, r.batch_output_g, d.default_weight_g)),
      coalesce(r.missing_prices, 0),
      coalesce(r.bad_units, 0)
    from public.dishes d
    left join private.tech_card_rows() r on r.dish_id = d.id;
end;
$$;

revoke all on function public.dish_costs() from public, anon;
grant execute on function public.dish_costs() to authenticated;

-- ---------- 4d. tech_card_cost_preview ----------
-- The cost rule over a recipe that is being edited (not saved): p_lines [{ ingredient_id, quantity, unit }] in order.
--   { lines: [{ cost (whole UZS or null), problem (null | 'ingredient' | 'quantity' | 'unit' | 'price') }],
--     batch_cost, cost_100, cost_portion (per p_portion_g), complete }
-- A quantity is checked as tech_card_save checks it (above 0, at most 1 000 000, three decimals; NaN and infinity
-- refused): anything else is a 'quantity' problem, never an error. A batch output outside 1..1 000 000 g leaves the
-- totals null; a portion outside 1..100 000 g leaves cost_portion null. The totals are null unless every line has a
-- cost.
create or replace function public.tech_card_cost_preview(p_batch_output_g int, p_portion_g int, p_lines jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_ing public.ingredients;
  v_ing_id uuid;
  v_qty numeric;
  v_cost numeric;
  v_problem text;
  v_out jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_complete boolean := true;
  v_batch int := case when p_batch_output_g between 1 and 1000000 then p_batch_output_g end;
  v_portion int := case when p_portion_g between 1 and 100000 then p_portion_g end;
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 100 then
    raise exception 'bad_request' using errcode = '22023';
  end if;

  for v_item in select l.value from jsonb_array_elements(p_lines) with ordinality as l(value, ord) order by l.ord loop
    v_problem := null;
    v_cost := null;
    v_ing := null;
    v_ing_id := null;
    v_qty := null;
    if jsonb_typeof(v_item.value) = 'object' then
      begin
        v_ing_id := (v_item.value ->> 'ingredient_id')::uuid;
      exception
        when invalid_text_representation then
          v_ing_id := null;
      end;
      begin
        v_qty := (v_item.value ->> 'quantity')::numeric;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          v_qty := null;
      end;
    end if;
    if v_ing_id is not null then
      select * into v_ing from public.ingredients i where i.id = v_ing_id;
    end if;

    if v_ing.id is null then
      v_problem := 'ingredient';
    -- 'NaN' and 'Infinity' sort above every number, so the upper bound refuses them too.
    elsif v_qty is null or v_qty <= 0 or v_qty > 1000000 or v_qty <> round(v_qty, 3) then
      v_problem := 'quantity';
    elsif private.to_purchase_qty(v_qty, v_item.value ->> 'unit', v_ing.unit, v_ing.pieces_per_unit) is null then
      v_problem := 'unit';
    elsif v_ing.usual_price is null then
      v_problem := 'price';
    else
      v_cost := private.line_cost(v_qty, v_item.value ->> 'unit', v_ing.unit, v_ing.pieces_per_unit, v_ing.usual_price);
      if private.uzs(v_cost) is null then
        -- Beyond any real cost (a million pieces at the largest price): a quantity to check, not a figure.
        v_problem := 'quantity';
        v_cost := null;
      else
        v_total := v_total + v_cost;
      end if;
    end if;

    if v_cost is null then
      v_complete := false;
    end if;
    v_out := v_out || jsonb_build_object('cost', private.uzs(v_cost), 'problem', v_problem);
  end loop;

  if jsonb_array_length(v_out) = 0 or v_batch is null or private.uzs(v_total) is null then
    v_complete := false;
  end if;

  return jsonb_build_object(
    'lines', v_out,
    'batch_cost', case when v_complete then private.uzs(v_total) end,
    'cost_100', case when v_complete then private.uzs(private.cost_of_grams(v_total, v_batch, 100)) end,
    'cost_portion', case when v_complete and v_portion is not null
      then private.uzs(private.cost_of_grams(v_total, v_batch, v_portion)) end,
    'complete', v_complete
  );
end;
$$;

revoke all on function public.tech_card_cost_preview(int, int, jsonb) from public, anon;
grant execute on function public.tech_card_cost_preview(int, int, jsonb) to authenticated;

-- ---------- 4e. tech_card_save ----------
-- Creates or replaces a dish's card: batch output, method, notes and p_lines [{ ingredient_id, quantity (a decimal
-- string or number, up to 3 decimals), unit }], 1..100 lines, one per ingredient. p_loaded_at is the updated_at the form
-- was loaded with (null for a dish that had no card): a card changed since is not overwritten (stale).
-- Returns { updated_at }. Errors (message, code):
--   not_allowed 42501 · not_found P0002 (no such dish) · stale 55000 · bad_batch 22023 · method_too_long 22023 ·
--   notes_too_long 22023 · no_lines 22023 · too_many_lines 22023 · invalid_line / invalid_ingredient /
--   invalid_quantity / unit_mismatch / duplicate_ingredient / ingredient_archived 22023 (detail: the line's position,
--   from 1)
create or replace function public.tech_card_save(
  p_dish_id uuid,
  p_batch_output_g int,
  p_method text,
  p_notes text,
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
  v_method text := btrim(coalesce(p_method, ''));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_card public.tech_cards;
  v_item record;
  v_ing_id uuid;
  v_qty numeric;
  v_unit text;
  v_ing public.ingredients;
  v_seen uuid[] := '{}';
  v_lines jsonb := '[]'::jsonb;
  v_had boolean;
  v_at timestamptz;
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_dish_id is null or not exists (select 1 from public.dishes d where d.id = p_dish_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select * into v_card from public.tech_cards c where c.dish_id = p_dish_id for update;
  if found then
    if p_loaded_at is null or v_card.updated_at is distinct from p_loaded_at then
      raise exception 'stale' using errcode = '55000';
    end if;
  elsif p_loaded_at is not null then
    raise exception 'stale' using errcode = '55000';
  end if;

  if p_batch_output_g is null or p_batch_output_g < 1 or p_batch_output_g > 1000000 then
    raise exception 'bad_batch' using errcode = '22023';
  end if;
  if char_length(v_method) > 4000 then
    raise exception 'method_too_long' using errcode = '22023';
  end if;
  if char_length(v_notes) > 2000 then
    raise exception 'notes_too_long' using errcode = '22023';
  end if;
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
      v_ing_id := (v_item.value ->> 'ingredient_id')::uuid;
      v_qty := (v_item.value ->> 'quantity')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'invalid_line' using errcode = '22023', detail = v_item.ord::text;
    end;
    v_unit := v_item.value ->> 'unit';

    select * into v_ing from public.ingredients i where i.id = v_ing_id;
    if v_ing_id is null or not found then
      raise exception 'invalid_ingredient' using errcode = '22023', detail = v_item.ord::text;
    end if;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 or v_qty <> round(v_qty, 3) then
      raise exception 'invalid_quantity' using errcode = '22023', detail = v_item.ord::text;
    end if;
    if v_unit is null or not private.line_unit_fits(v_unit, v_ing.unit) then
      raise exception 'unit_mismatch' using errcode = '22023', detail = v_item.ord::text;
    end if;
    if v_ing_id = any (v_seen) then
      raise exception 'duplicate_ingredient' using errcode = '22023', detail = v_item.ord::text;
    end if;
    -- An archived ingredient stays on a card that already has it; it is not added to a new line.
    if v_ing.archived_at is not null and not exists (
      select 1 from public.tech_card_lines l where l.dish_id = p_dish_id and l.ingredient_id = v_ing_id
    ) then
      raise exception 'ingredient_archived' using errcode = '22023', detail = v_item.ord::text;
    end if;

    v_seen := v_seen || v_ing_id;
    v_lines := v_lines || jsonb_build_object('ingredient_id', v_ing_id, 'quantity', v_qty, 'unit', v_unit, 'sort', v_item.ord);
  end loop;

  v_had := v_card.dish_id is not null;
  v_at := clock_timestamp();
  if v_had then
    update public.tech_cards c
    set batch_output_g = p_batch_output_g,
        method = v_method,
        notes = v_notes,
        updated_at = v_at,
        updated_by = v_uid
    where c.dish_id = p_dish_id;
    delete from public.tech_card_lines l where l.dish_id = p_dish_id;
  else
    -- Two first saves at once: the second finds the row the first made and is refused as stale.
    insert into public.tech_cards (dish_id, batch_output_g, method, notes, created_at, updated_at, updated_by)
    values (p_dish_id, p_batch_output_g, v_method, v_notes, v_at, v_at, v_uid)
    on conflict (dish_id) do nothing;
    if not found then
      raise exception 'stale' using errcode = '55000';
    end if;
  end if;

  insert into public.tech_card_lines (dish_id, ingredient_id, quantity, unit, sort)
  select p_dish_id, (x ->> 'ingredient_id')::uuid, (x ->> 'quantity')::numeric, x ->> 'unit', (x ->> 'sort')::int
  from jsonb_array_elements(v_lines) as x;

  return jsonb_build_object('updated_at', v_at);
end;
$$;

revoke all on function public.tech_card_save(uuid, int, text, text, jsonb, timestamptz) from public, anon;
grant execute on function public.tech_card_save(uuid, int, text, text, jsonb, timestamptz) to authenticated;

-- ---------- 4f. ration_costs ----------
-- The owner's view of what a ration costs against what it sells for, at today's usual prices and the 30-day menu:
-- per calorie level (in catalogue order, inactive ones too) and cycle day (all 30, or only p_cycle_day),
--   { levels: [{ variant_id, program_name, kcal, price_per_day, meals_per_day, active,
--                days_with_menu, days_complete, days_not_full, days_no_cost, avg_cost, avg_margin, avg_margin_pct,
--                days: [{ cycle_day, items, missing, full, cost, margin, margin_pct }] }] }
-- A day counts (complete) only when its menu is full, by the menu editor's rule (at least meals_per_day dishes, as
-- MenuWorkspace marks a day complete), and every one of its dishes has a known cost; its cost is then Σ (menu grams ×
-- the dish's cost per gram). Any other day has cost null and stays out of the averages:
--   days_not_full  days of the period (30, or 1) whose menu is empty or not full
--   days_no_cost   full days with a dish whose cost is not known (missing counts them)
-- price_per_day is the level's base price (the longest plan; shorter plans add a markup). Money in whole UZS,
-- margin_pct to one decimal.
create or replace function public.ration_costs(p_cycle_day int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days int := case when p_cycle_day is null then 30 else 1 end;
  v_result jsonb;
begin
  if not private.is_owner() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_cycle_day is not null and (p_cycle_day < 1 or p_cycle_day > 30) then
    raise exception 'bad_request' using errcode = '22023';
  end if;

  with costs as materialized (
    select r.dish_id, case when r.state = 'ok' then r.batch_cost end as batch_cost, r.batch_output_g
    from private.tech_card_rows() r
  ),
  items as (
    select
      mi.variant_id,
      mi.cycle_day,
      count(*)::int as items,
      count(*) filter (where c.batch_cost is null)::int as missing,
      sum(private.cost_of_grams(c.batch_cost, c.batch_output_g, mi.weight_g)) as cost
    from public.menu_items mi
    left join costs c on c.dish_id = mi.dish_id
    where p_cycle_day is null or mi.cycle_day = p_cycle_day
    group by mi.variant_id, mi.cycle_day
  ),
  days as (
    select
      it.*,
      it.items >= v.meals_per_day as full,
      case when it.items >= v.meals_per_day and it.missing = 0 then it.cost end as day_cost
    from items it
    join public.program_variants v on v.id = it.variant_id
  ),
  lv as (
    select
      v.id, v.kcal, v.price_per_day, v.meals_per_day, (v.active and p.active) as active, v.sort,
      p.sort as program_sort, p.name,
      (select count(*)::int from days d where d.variant_id = v.id) as days_with_menu,
      (select count(*)::int from days d where d.variant_id = v.id and d.day_cost is not null) as days_complete,
      v_days - (select count(*)::int from days d where d.variant_id = v.id and d.full) as days_not_full,
      (select count(*)::int from days d where d.variant_id = v.id and d.full and d.day_cost is null) as days_no_cost,
      (select avg(d.day_cost) from days d where d.variant_id = v.id and d.day_cost is not null) as avg_cost
    from public.program_variants v
    join public.programs p on p.id = v.program_id
  )
  select jsonb_build_object('levels', coalesce(jsonb_agg(jsonb_build_object(
    'variant_id', lv.id,
    'program_name', lv.name,
    'kcal', lv.kcal,
    'price_per_day', lv.price_per_day,
    'meals_per_day', lv.meals_per_day,
    'active', lv.active,
    'days_with_menu', lv.days_with_menu,
    'days_complete', lv.days_complete,
    'days_not_full', lv.days_not_full,
    'days_no_cost', lv.days_no_cost,
    'avg_cost', private.uzs(lv.avg_cost),
    'avg_margin', private.uzs(lv.price_per_day - lv.avg_cost),
    'avg_margin_pct', case when lv.price_per_day > 0 and lv.avg_cost is not null
      then round((lv.price_per_day - lv.avg_cost) * 100 / lv.price_per_day, 1) end,
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cycle_day', d.cycle_day,
        'items', d.items,
        'missing', d.missing,
        'full', d.full,
        'cost', private.uzs(d.day_cost),
        'margin', private.uzs(lv.price_per_day - d.day_cost),
        'margin_pct', case when lv.price_per_day > 0 and d.day_cost is not null
          then round((lv.price_per_day - d.day_cost) * 100 / lv.price_per_day, 1) end
      ) order by d.cycle_day), '[]'::jsonb)
      from days d
      where d.variant_id = lv.id
    )
  ) order by lv.program_sort, lv.sort, lv.kcal, lv.id), '[]'::jsonb))
  into v_result
  from lv;

  return v_result;
end;
$$;

revoke all on function public.ration_costs(int) from public, anon;
grant execute on function public.ration_costs(int) to authenticated;

-- ---------- 4g. shopping_list ----------
-- What to buy for the firm rations (paid or active orders) of p_days days from p_from (1..7), per ingredient in its
-- purchase unit, rounded up to the thousandth so nothing shows as 0:
--   { from, to, days, rations, no_menu_rations, dishes, counted_dishes,
--     lines: [{ ingredient_id, name_ru, name_uz, name_uzc, category_id, category_ru, category_uz, category_uzc, unit,
--               quantity [, usual_price, amount] }]   by category, then name
--     uncounted: [{ dish_id, name_ru, name_uz, name_uzc, state, portions, grams }]   dishes without a usable card
--     [, total_amount, unpriced] }
-- The bracketed keys only in shopping_list_costed. private.shopping_list_body is shared by the two.
create or replace function private.shopping_list_body(p_from date, p_days int, p_costed boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to date;
  v_needs jsonb;
  v_lines jsonb;
begin
  if p_from is null or p_days is null or p_days < 1 or p_days > 7 then
    raise exception 'bad_period' using errcode = '22023';
  end if;
  v_to := p_from + (p_days - 1);
  v_needs := private.ration_needs(p_from, v_to, array['paid', 'active']);

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'ingredient_id', i.id,
    'name_ru', i.name_ru,
    'name_uz', i.name_uz,
    'name_uzc', i.name_uzc,
    'category_id', i.category_id,
    'category_ru', cat.name_ru,
    'category_uz', cat.name_uz,
    'category_uzc', cat.name_uzc,
    'unit', i.unit,
    'quantity', x.quantity,
    'usual_price', case when p_costed then i.usual_price end,
    'amount', case when p_costed then private.uzs(x.quantity * i.usual_price) end
  )) order by cat.sort, cat.id, lower(i.name_ru), i.id), '[]'::jsonb)
  into v_lines
  from (
    select (n ->> 'ingredient_id')::uuid as ingredient_id,
           round(ceil((n ->> 'quantity')::numeric * 1000) / 1000, 3) as quantity
    from jsonb_array_elements(v_needs -> 'needs') as n
  ) x
  join public.ingredients i on i.id = x.ingredient_id
  join public.ingredient_categories cat on cat.id = i.category_id;

  return jsonb_build_object(
    'from', p_from,
    'to', v_to,
    'days', p_days,
    'rations', v_needs -> 'rations',
    'no_menu_rations', v_needs -> 'no_menu_rations',
    'dishes', v_needs -> 'dishes',
    'counted_dishes', v_needs -> 'counted_dishes',
    'lines', v_lines,
    'uncounted', v_needs -> 'uncounted'
  ) || case when p_costed then jsonb_build_object(
    'total_amount', (select coalesce(sum((l ->> 'amount')::bigint), 0) from jsonb_array_elements(v_lines) l),
    'unpriced', (select count(*)::int from jsonb_array_elements(v_lines) l where not (l ? 'amount'))
  ) else '{}'::jsonb end;
end;
$$;

revoke all on function private.shopping_list_body(date, int, boolean) from public, anon, authenticated;

create or replace function public.shopping_list(p_from date, p_days int default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_staff() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return private.shopping_list_body(p_from, p_days, false);
end;
$$;

revoke all on function public.shopping_list(date, int) from public, anon;
grant execute on function public.shopping_list(date, int) to authenticated;

create or replace function public.shopping_list_costed(p_from date, p_days int default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return private.shopping_list_body(p_from, p_days, true);
end;
$$;

revoke all on function public.shopping_list_costed(date, int) from public, anon;
grant execute on function public.shopping_list_costed(date, int) to authenticated;

-- ---------- 4h. ingredient_usage ----------
-- Purchases against theoretical use for p_from .. p_to (at most 366 days). An estimate, never a stock balance: use is
-- what the tech cards say the delivered rations needed (paid, active and completed orders, and the days an order
-- cancelled after payment was delivered before its cancellation day, see private.ration_counts; on days up to today,
-- Tashkent), bought is what the receipts of the period hold.
--   { from, to, used_to (the last day counted for use: p_to or today), rations, no_menu_rations, dishes, counted_dishes,
--     uncounted: [...as ration_needs],
--     rows: [{ ingredient_id, name_ru, name_uz, name_uzc, category_id, unit (the ingredient's current unit),
--              usual_price, bought, bought_amount, other_units (lines bought in another unit, left out of bought),
--              used, diff (bought − used) }] }
-- Quantities in the ingredient's unit, to the thousandth; one row per ingredient bought or used.
create or replace function public.ingredient_usage(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Tashkent')::date;
  v_used_to date;
  v_needs jsonb;
  v_rows jsonb;
begin
  if not private.can_handle_stock() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'bad_period' using errcode = '22023';
  end if;

  v_used_to := least(p_to, v_today);
  if v_used_to >= p_from then
    v_needs := private.ration_needs(p_from, v_used_to, array['paid', 'active', 'completed'], true);
  else
    v_needs := jsonb_build_object(
      'rations', 0, 'no_menu_rations', 0, 'dishes', 0, 'counted_dishes', 0, 'needs', '[]'::jsonb, 'uncounted', '[]'::jsonb
    );
  end if;

  with used as (
    select (n ->> 'ingredient_id')::uuid as ingredient_id, (n ->> 'quantity')::numeric as quantity
    from jsonb_array_elements(v_needs -> 'needs') as n
  ),
  bought as (
    select
      ln.ingredient_id,
      sum(ln.quantity) filter (where ln.unit = i.unit) as quantity,
      coalesce(sum(ln.amount) filter (where ln.unit = i.unit), 0)::bigint as amount,
      bool_or(ln.unit <> i.unit) as other_units
    from public.purchase_lines ln
    join public.purchases p on p.id = ln.purchase_id
    join public.ingredients i on i.id = ln.ingredient_id
    where p.day between p_from and p_to
    group by ln.ingredient_id
  ),
  ids as (
    select u.ingredient_id from used u
    union
    select b.ingredient_id from bought b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'ingredient_id', i.id,
    'name_ru', i.name_ru,
    'name_uz', i.name_uz,
    'name_uzc', i.name_uzc,
    'category_id', i.category_id,
    'unit', i.unit,
    'usual_price', i.usual_price,
    'bought', round(coalesce(b.quantity, 0), 3),
    'bought_amount', coalesce(b.amount, 0),
    'other_units', coalesce(b.other_units, false),
    'used', round(coalesce(u.quantity, 0), 3),
    'diff', round(coalesce(b.quantity, 0) - coalesce(u.quantity, 0), 3)
  ) order by cat.sort, cat.id, lower(i.name_ru), i.id), '[]'::jsonb)
  into v_rows
  from ids
  join public.ingredients i on i.id = ids.ingredient_id
  join public.ingredient_categories cat on cat.id = i.category_id
  left join used u on u.ingredient_id = ids.ingredient_id
  left join bought b on b.ingredient_id = ids.ingredient_id;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'used_to', case when v_used_to >= p_from then v_used_to end,
    'rations', v_needs -> 'rations',
    'no_menu_rations', v_needs -> 'no_menu_rations',
    'dishes', v_needs -> 'dishes',
    'counted_dishes', v_needs -> 'counted_dishes',
    'uncounted', v_needs -> 'uncounted',
    'rows', v_rows
  );
end;
$$;

revoke all on function public.ingredient_usage(date, date) from public, anon;
grant execute on function public.ingredient_usage(date, date) to authenticated;
