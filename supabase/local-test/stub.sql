-- The parts of a Supabase database that the migrations expect to exist already: the three API roles, auth.users,
-- auth.uid() and the storage tables. Only for scripts/test-migrations.sh (a throwaway local Postgres); never
-- applied to a real project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema storage;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  phone text,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{}'
);

-- Act as a signed-in user in a test: set role authenticated; select set_config('request.jwt.claim.sub', '<uuid>', false);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;

-- Supabase's defaults: the API roles can use these schemas and get every new public table and function.
grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
