-- Two access levels:
--   owner — everything: dishes, menu, programs, prices, settings, staff list
--   admin — dishes and the 30-day menu only
alter table public.staff drop constraint staff_role_check;
update public.staff set role = 'admin' where role not in ('owner', 'admin');
alter table public.staff alter column role set default 'admin';
alter table public.staff add constraint staff_role_check check (role in ('owner', 'admin'));

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff s where s.user_id = (select auth.uid()) and s.role = 'owner'
  );
$$;

revoke all on function private.is_owner() from public;
grant execute on function private.is_owner() to anon, authenticated;

-- Programs, calorie levels, prices and settings: owner only.
alter policy "staff write programs" on public.programs using (private.is_owner()) with check (private.is_owner());
alter policy "staff write variants" on public.program_variants using (private.is_owner()) with check (private.is_owner());
alter policy "staff write durations" on public.durations using (private.is_owner()) with check (private.is_owner());
alter policy "staff write settings" on public.settings using (private.is_owner()) with check (private.is_owner());

-- The owner can see the whole staff list; everyone else only their own row.
alter policy "staff read own row" on public.staff using (user_id = (select auth.uid()) or private.is_owner());
