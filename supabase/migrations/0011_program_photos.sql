-- One cover photo per program (LIGHT, BALANCE, PROTEIN), uploaded by the owner on "Programs and prices".
-- Plan: docs/plans/program-photos.md, slice 1.
--
-- Purely additive: one nullable column, one storage bucket and four storage policies. No existing row, grant or
-- policy changes. Null photo_url means "no photo": the site shows the text-only card, as before.
--
-- Writes are owner only, like the programs table itself (0003_owner_admin_roles.sql). The back office uploads
-- straight from the owner's browser session, and saveProgram (src/lib/admin/actions.ts) accepts only URLs in
-- this bucket and removes the replaced file with the owner's session.

-- ---------- column ----------
alter table public.programs add column photo_url text;

-- ---------- bucket ----------
insert into storage.buckets (id, name, public)
values ('program-photos', 'program-photos', true)
on conflict (id) do nothing;

-- ---------- policies (same shape as the dish-photo ones in 0001_catalog.sql) ----------
create policy "public read program photos" on storage.objects
  for select to anon, authenticated using (bucket_id = 'program-photos');
create policy "owner upload program photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'program-photos' and (select private.is_owner()));
create policy "owner update program photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'program-photos' and (select private.is_owner()))
  with check (bucket_id = 'program-photos' and (select private.is_owner()));
create policy "owner delete program photos" on storage.objects
  for delete to authenticated using (bucket_id = 'program-photos' and (select private.is_owner()));
