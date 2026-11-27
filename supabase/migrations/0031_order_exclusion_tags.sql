-- Allergen chips at order: the allergens a customer ticks on the order form are kept on the order as fixed keys, beside
-- the free-text exclusions, so the kitchen sheet can group rations by them. Plan: docs/plans/allergen-exclusions.md.
--
-- ADDITIVE ONLY. One new column with a default (every existing order gets an empty list) and its check, and new
-- functions. No table, column, row, constraint, policy, grant or existing function is dropped or changed; no DROP,
-- TRUNCATE, DELETE or UPDATE of existing rows. public.submit_order, staff_create_order, staff_edit_order and
-- kitchen_orders are not touched (a new parameter or a new return column would need a DROP): the order action sets
-- the tags with set_order_exclusion_tags right after submit_order, and the kitchen reads kitchen_orders_v2.
-- Does not depend on 0027 (orders.request_id, the new submit_order): nothing here reads them.
--
-- The keys are the codes dishes.allergens already uses (the back office has written them since 0001), so dishes and
-- orders share one vocabulary and no dish row needs normalising: gluten, milk, egg, nuts, peanut, fish, seafood,
-- sesame, soy, plus the new mushrooms. The same list, with the names in every language, is src/lib/allergens.ts; keep
-- them in step. dishes.allergens itself stays unchecked (old codes such as honey stay readable).
--
--   1. private.exclusion_tags_valid(tags)  true when tags is a one-dimensional list (or empty) of distinct keys from
--      the list above, with no null. Immutable; used by the check below. Executable by every role (the default for a
--      new function, kept on purpose): a check constraint runs with the rights of whoever writes the row, and staff
--      update orders directly (status, staff_note, payment_method, cancel_reason). It reads nothing but its argument.
--   2. orders.exclusion_tags text[] not null default '{}', check orders_exclusion_tags_valid. Read like every other
--      column of orders (owners and managers, 0004/0012). Not added to any update grant: clients never write it.
--   3. public.set_order_exclusion_tags(number, tags)  (service_role only: revoked from public, anon and authenticated)
--      sets the tags of the order with that number, in the list's order. Called by the server's order action after a
--      new order is saved; a failure there is logged and never fails the order. Errors: invalid_tags (22023: not a
--      list of distinct known keys), not_found (P0002). The update changes no column that the history trigger
--      (0018, private.log_order_event) records, so it writes no order event and sends no Telegram message.
--      It lives in public, not private, because the server reaches functions through the API, which serves public only
--      (as telegram_claim and the other service_role functions of 0026).
--   4. public.kitchen_orders_v2(date)  public.kitchen_orders (0028) plus exclusion_tags: same rows, same rule, staff only,
--      no personal data. kitchen_orders keeps its return type (changing it needs a DROP); the sheet reads v2 and falls
--      back to kitchen_orders while this migration is not applied.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended for
-- kitchen_orders_v2, as for kitchen_orders (0009): the staff check is in its where clause.

-- ---------- 1. exclusion_tags_valid ----------
create or replace function private.exclusion_tags_valid(p_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_tags is not null
    and (cardinality(p_tags) = 0 or array_ndims(p_tags) = 1)
    and array_position(p_tags, null) is null
    and p_tags <@ array['gluten', 'milk', 'egg', 'nuts', 'peanut', 'fish', 'seafood', 'sesame', 'soy', 'mushrooms']::text[]
    and cardinality(p_tags) = (select count(distinct t.tag) from unnest(p_tags) as t(tag));
$$;

-- ---------- 2. orders.exclusion_tags ----------
alter table public.orders
  add column exclusion_tags text[] not null default '{}'
    constraint orders_exclusion_tags_valid check (private.exclusion_tags_valid(exclusion_tags));

-- ---------- 3. set_order_exclusion_tags ----------
create or replace function public.set_order_exclusion_tags(p_number bigint, p_tags text[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_keys constant text[] :=
    array['gluten', 'milk', 'egg', 'nuts', 'peanut', 'fish', 'seafood', 'sesame', 'soy', 'mushrooms'];
  v_tags text[];
begin
  if not private.exclusion_tags_valid(coalesce(p_tags, '{}')) then
    raise exception 'invalid_tags' using errcode = '22023';
  end if;

  -- The list's order, so the same choice is always the same list (the kitchen groups rations by it).
  select coalesce(array_agg(k.key order by k.place), '{}')
    into v_tags
  from unnest(v_keys) with ordinality as k(key, place)
  where k.key = any (coalesce(p_tags, '{}'));

  update public.orders o
  set exclusion_tags = v_tags
  where o.number = p_number;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_order_exclusion_tags(bigint, text[]) from public, anon, authenticated;
grant execute on function public.set_order_exclusion_tags(bigint, text[]) to service_role;

-- ---------- 4. kitchen_orders_v2 ----------
-- The body of public.kitchen_orders (0028, 5a) plus o.exclusion_tags.
create or replace function public.kitchen_orders_v2(p_date date)
returns table (
  number bigint,
  variant_id uuid,
  status text,
  day_index int,
  days int,
  exclusions text,
  exclusion_tags text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.number, o.variant_id, o.status, x.day_index, o.days, o.exclusions, o.exclusion_tags
  from public.orders o
  cross join lateral (
    select private.order_day_index_paused(o.id, o.start_date, o.weekdays_only, p_date) as day_index
  ) x
  where (select private.is_staff())
    and p_date is not null
    and o.status in ('confirmed', 'paid', 'active')
    and o.start_date <= p_date
    and p_date - o.start_date < (o.days + private.order_pause_span(o.id)) * 2 + 7
    and x.day_index between 1 and o.days
  order by o.number;
$$;

revoke all on function public.kitchen_orders_v2(date) from public, anon;
grant execute on function public.kitchen_orders_v2(date) to authenticated;
