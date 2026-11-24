-- Staff access requests: signing in to the back office without a staff row records a request, and the owner
-- approves or declines it (the Team screen, slice 2). Plan: docs/plans/staff-access-requests.md, slice 1.
--
-- Additive only. No existing table, column, grant, policy or row is changed:
--   * new table public.staff_requests with RLS, an owner-only select policy and an updated_at trigger;
--   * new functions public.approve_staff_request, public.decline_staff_request, public.remove_staff and
--     public.list_staff, owner only, executable by authenticated.
-- (remove_staff deletes a staff row when the owner calls it later; the migration itself deletes nothing.)
--
-- Who writes what:
--   * A request row is inserted by the server with the secret key (service_role, which bypasses RLS and these
--     grants) from the verified session user, in src/lib/admin/access.ts. No client can insert, update or
--     delete rows here.
--   * Approve, decline and remove go through the security definer functions below, each of which checks
--     private.is_owner() first. The Supabase advisor flags security definer functions callable by
--     authenticated (a warning); that is intended here: the owner check is inside each function, and staff and
--     auth.users stay closed to direct writes.

-- ---------- staff_requests ----------
create table public.staff_requests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null check (char_length(email) <= 320),
  name text not null default '' check (char_length(name) <= 80),
  status text not null default 'pending' check (status in ('pending', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index staff_requests_status_created on public.staff_requests (status, created_at);

-- private.set_updated_at() is defined in 0004_orders.sql.
create trigger staff_requests_set_updated_at
  before update on public.staff_requests
  for each row execute function private.set_updated_at();

alter table public.staff_requests enable row level security;

-- The owner reads the list (who is waiting, who was declined). Nobody else, and nobody writes from the client.
revoke all on table public.staff_requests from anon, authenticated;
grant select on table public.staff_requests to authenticated;

create policy "owner reads staff requests" on public.staff_requests
  for select to authenticated
  using (private.is_owner());

-- ---------- approve_staff_request ----------
-- Lets a waiting (or declined) account in as an admin. The role is fixed here: this path can never create an
-- owner. The request is removed and the staff row added in the same transaction; an existing staff row is left
-- as it is.
create or replace function public.approve_staff_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  delete from public.staff_requests r
  where r.user_id = p_user_id
  returning r.name into v_name;
  if not found then
    raise exception 'no_request' using errcode = 'P0002';
  end if;

  insert into public.staff (user_id, name, role)
  values (p_user_id, v_name, 'admin')
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.approve_staff_request(uuid) from public, anon;
grant execute on function public.approve_staff_request(uuid) to authenticated;

-- ---------- decline_staff_request ----------
-- The row stays (status 'declined'), so the same account signing in again is not re-opened as a new request.
create or replace function public.decline_staff_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update public.staff_requests r
  set status = 'declined'
  where r.user_id = p_user_id;
  if not found then
    raise exception 'no_request' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.decline_staff_request(uuid) from public, anon;
grant execute on function public.decline_staff_request(uuid) to authenticated;

-- ---------- remove_staff ----------
-- Removes an admin. Owners cannot be removed this way (including the caller).
create or replace function public.remove_staff(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  delete from public.staff s
  where s.user_id = p_user_id
    and s.role <> 'owner';
  if not found then
    raise exception 'not_removable' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.remove_staff(uuid) from public, anon;
grant execute on function public.remove_staff(uuid) to authenticated;

-- ---------- list_staff ----------
-- The staff list with each member's email (staff has no email column; it lives in auth.users, which the API
-- cannot read). Owner only.
create or replace function public.list_staff()
returns table (
  user_id uuid,
  name text,
  role text,
  email text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  return query
    select s.user_id, s.name, s.role, coalesce(u.email, '')::text, s.created_at
    from public.staff s
    left join auth.users u on u.id = s.user_id
    order by s.created_at;
end;
$$;

revoke all on function public.list_staff() from public, anon;
grant execute on function public.list_staff() to authenticated;
