-- Saved delivery details and "Repeat last order" for signed-in customers. Plan: docs/plans/saved-address-repeat-order.md.
--
-- ADDITIVE ONLY. Three new nullable columns on public.profiles (no existing row changes: every new value starts null)
-- and two new functions. No table, column, row, constraint, policy, grant or function is dropped or changed; no DROP,
-- TRUNCATE, DELETE or UPDATE of existing rows. public.submit_order is not touched: the order action saves the details
-- with save_my_delivery after a successful order, in the customer's own session (the plan's p_save_delivery parameter
-- would have needed a DROP of submit_order). Does not depend on 0027.
--
--   1. profiles.address, delivery_window, courier_note  the customer's saved delivery details, all optional, with the
--      limits of submit_order: address 5..300 characters, courier note at most 500. The window is checked against the
--      delivery_windows setting when it is saved (a later change of the setting leaves an old saved window as it is;
--      the order form then simply does not preselect it). Readable by the customer through the existing table-level
--      select grant and "customer reads own profile" policy (0006), and by the owner ("owner reads profiles"). Not
--      added to the column update grant: customers write them only through save_my_delivery, which validates.
--   2. public.save_my_delivery(address, window, note)  (authenticated) saves the three fields on the caller's own
--      profile, creating the row when it is missing (as the sign-up trigger of 0006 does: id and an empty name). Blank
--      text counts as null; all three null clears them. Errors: not_allowed (42501: no signed-in user), invalid_address
--      (22023: not 5..300 characters), invalid_window (22023: not one of delivery_windows), too_long (22001: a note
--      over 500 characters).
--   3. public.my_order_for_repeat(number)  (authenticated) one order of the caller's own (orders.user_id = auth.uid();
--      anyone else's order, or no order, returns no row): variant_id, program_slug and kcal (to find the same program's
--      nearest level when the variant is no longer offered), days, weekdays_only, address, delivery_window, comment and
--      exclusions. Never the name, phone, price, status or staff fields.
--
-- The Supabase advisor flags security definer functions callable by authenticated (a warning); that is intended here,
-- as in 0007, 0028 and 0029: each function reads or writes only the caller's own rows.

-- ---------- 1. profiles: saved delivery details ----------
alter table public.profiles
  add column address text check (address is null or char_length(address) between 5 and 300),
  add column delivery_window text check (delivery_window is null or char_length(delivery_window) between 1 and 40),
  add column courier_note text check (courier_note is null or char_length(courier_note) <= 500);

-- ---------- 2. save_my_delivery ----------
create or replace function public.save_my_delivery(p_address text, p_window text, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_window text := nullif(btrim(coalesce(p_window, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_windows jsonb;
begin
  if v_uid is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if v_address is not null and char_length(v_address) not between 5 and 300 then
    raise exception 'invalid_address' using errcode = '22023';
  end if;
  if v_window is not null then
    select s.value into v_windows from public.settings s where s.key = 'delivery_windows';
    if v_windows is null or jsonb_typeof(v_windows) <> 'array' or not (v_windows ? v_window) then
      raise exception 'invalid_window' using errcode = '22023';
    end if;
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'too_long' using errcode = '22001';
  end if;

  -- The caller's own row only. A missing row (the sign-up trigger never fails a sign-up, so it may be absent) is made
  -- here as the trigger would make it.
  insert into public.profiles (id, name, address, delivery_window, courier_note)
  values (v_uid, '', v_address, v_window, v_note)
  on conflict (id) do update
    set address = excluded.address,
        delivery_window = excluded.delivery_window,
        courier_note = excluded.courier_note;
end;
$$;

revoke all on function public.save_my_delivery(text, text, text) from public, anon;
grant execute on function public.save_my_delivery(text, text, text) to authenticated;

-- ---------- 3. my_order_for_repeat ----------
create or replace function public.my_order_for_repeat(p_number bigint)
returns table (
  variant_id uuid,
  program_slug text,
  kcal int,
  days int,
  weekdays_only boolean,
  address text,
  delivery_window text,
  comment text,
  exclusions text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.variant_id, p.slug, o.kcal, o.days, o.weekdays_only, o.address, o.delivery_window, o.comment, o.exclusions
  from public.orders o
  left join public.program_variants v on v.id = o.variant_id
  left join public.programs p on p.id = v.program_id
  where o.number = p_number
    and o.user_id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.my_order_for_repeat(bigint) from public, anon;
grant execute on function public.my_order_for_repeat(bigint) to authenticated;
