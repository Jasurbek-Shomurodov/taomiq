-- Move the staff check out of the public API schema so it cannot be called as an RPC.
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()));
$$;

revoke all on function private.is_staff() from public;
grant execute on function private.is_staff() to anon, authenticated;

alter policy "public read programs" on public.programs using (active or private.is_staff());
alter policy "staff write programs" on public.programs using (private.is_staff()) with check (private.is_staff());
alter policy "public read variants" on public.program_variants using (active or private.is_staff());
alter policy "staff write variants" on public.program_variants using (private.is_staff()) with check (private.is_staff());
alter policy "staff write durations" on public.durations using (private.is_staff()) with check (private.is_staff());
alter policy "public read dishes" on public.dishes using (active or private.is_staff());
alter policy "staff write dishes" on public.dishes using (private.is_staff()) with check (private.is_staff());
alter policy "staff write menu" on public.menu_items using (private.is_staff()) with check (private.is_staff());
alter policy "staff write settings" on public.settings using (private.is_staff()) with check (private.is_staff());

alter policy "staff upload dish photos" on storage.objects with check (bucket_id = 'dish-photos' and private.is_staff());
alter policy "staff update dish photos" on storage.objects using (bucket_id = 'dish-photos' and private.is_staff());
alter policy "staff delete dish photos" on storage.objects using (bucket_id = 'dish-photos' and private.is_staff());

drop function public.is_staff();
