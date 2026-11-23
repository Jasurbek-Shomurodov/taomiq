-- Customer accounts on taomiq.uz (sign-in with Telegram, Google or an email code).
-- Plan: docs/plans/customer-login-and-protection.md, slice 1.
--
-- Additive only: one new table (public.profiles) with RLS and explicit policies, a column-level update
-- grant on that new table, an updated_at trigger on it, and an AFTER INSERT trigger on auth.users that
-- creates the profile row. No existing table, policy, grant or row is changed. The orders changes
-- (orders.user_id, customer read access, submit_order) are slice 2 (migration 0007).

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 80),
  -- Written only by the server with the secret key, from the custom:telegram identity (never from the
  -- user-editable user_metadata). Optional: Telegram may not share a number.
  phone text check (phone ~ '^\+998[0-9]{9}$'),
  -- True only when the number came from the Telegram identity.
  phone_verified boolean not null default false,
  telegram_id bigint unique,
  locale text not null default 'uz' check (locale in ('uz', 'uzc', 'ru')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- private.set_updated_at() is defined in 0004_orders.sql.
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;

-- A signed-in customer reads their own row and may change only their name and site language. The column
-- grant limits what can be written; the policy limits whose row. No insert or delete from the client:
-- the row is created by the trigger below and removed with the auth user (on delete cascade).
-- phone, phone_verified and telegram_id are written by the server with the secret key (service_role),
-- which bypasses RLS and these grants.
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (name, locale) on table public.profiles to authenticated;

create policy "customer reads own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "customer updates own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- The owner sees every customer's profile (the back office). Staff admins do not.
create policy "owner reads profiles" on public.profiles
  for select to authenticated
  using (private.is_owner());

-- ---------- profile row on sign-up ----------
-- Runs for every new auth user (customers and, harmlessly, staff). The starting name comes from the
-- provider's metadata (Google: full_name/name; Telegram: name). It must never fail a sign-up, so any
-- error is turned into a warning; the sign-in callback creates the row if it is still missing.
create or replace function private.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.profiles (id, name)
    values (
      new.id,
      left(
        coalesce(
          nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
          ''
        ),
        80
      )
    )
    on conflict (id) do nothing;
  exception when others then
    raise warning 'create_profile_for_new_user failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function private.create_profile_for_new_user() from public, anon, authenticated;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function private.create_profile_for_new_user();
