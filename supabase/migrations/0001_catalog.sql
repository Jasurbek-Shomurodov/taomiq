-- TAOMIQ catalogue: programs, calorie levels, dishes, 30-day menu, staff.
-- Orders, payments and deliveries come in a later migration.

create extension if not exists pgcrypto;

-- ---------- staff ----------
create table public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  role text not null default 'cook' check (role in ('owner', 'manager', 'cook')),
  created_at timestamptz not null default now()
);

-- security definer so RLS policies can call it without recursing into staff's own policy
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff s where s.user_id = (select auth.uid()));
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;

-- ---------- programs ----------
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tag_color text not null default '#C7A86B',
  tagline_uz text not null default '',
  tagline_ru text not null default '',
  description_uz text not null default '',
  description_ru text not null default '',
  sort int not null default 0,
  active boolean not null default true
);

-- A calorie level inside a program, e.g. BALANCE / 1800
create table public.program_variants (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  kcal int not null check (kcal between 500 and 6000),
  meals_per_day int not null default 5 check (meals_per_day between 1 and 8),
  price_per_day int not null check (price_per_day >= 0), -- UZS, price on the longest duration
  sort int not null default 0,
  active boolean not null default true,
  unique (program_id, kcal)
);

-- Duration ladder: price_per_day * (1 + markup_pct / 100)
create table public.durations (
  days int primary key check (days > 0),
  markup_pct numeric(5, 2) not null default 0,
  is_trial boolean not null default false
);

-- ---------- dishes ----------
create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  name_uz text not null,
  name_ru text not null,
  photo_url text,
  default_weight_g int not null default 300 check (default_weight_g > 0),
  -- nutrition per 100 g of the finished dish, from the technological card
  kcal_100 numeric(6, 1) not null default 0,
  protein_100 numeric(5, 1) not null default 0,
  fat_100 numeric(5, 1) not null default 0,
  carbs_100 numeric(5, 1) not null default 0,
  ingredients_uz text not null default '',
  ingredients_ru text not null default '',
  allergens text[] not null default '{}',
  verified boolean not null default false, -- technological card checked
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- 30-day menu ----------
create type public.meal_slot as enum ('breakfast', 'snack1', 'lunch', 'snack2', 'dinner');

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.program_variants (id) on delete cascade,
  cycle_day int not null check (cycle_day between 1 and 30),
  slot public.meal_slot not null,
  dish_id uuid not null references public.dishes (id) on delete restrict,
  weight_g int not null check (weight_g > 0),
  unique (variant_id, cycle_day, slot)
);

create index menu_items_variant_day on public.menu_items (variant_id, cycle_day);

-- ---------- settings ----------
create table public.settings (
  key text primary key,
  value jsonb not null
);

-- ---------- row level security ----------
alter table public.staff enable row level security;
alter table public.programs enable row level security;
alter table public.program_variants enable row level security;
alter table public.durations enable row level security;
alter table public.dishes enable row level security;
alter table public.menu_items enable row level security;
alter table public.settings enable row level security;

create policy "staff read own row" on public.staff
  for select to authenticated using (user_id = (select auth.uid()));

create policy "public read programs" on public.programs
  for select to anon, authenticated using (active or public.is_staff());
create policy "staff write programs" on public.programs
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "public read variants" on public.program_variants
  for select to anon, authenticated using (active or public.is_staff());
create policy "staff write variants" on public.program_variants
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "public read durations" on public.durations
  for select to anon, authenticated using (true);
create policy "staff write durations" on public.durations
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "public read dishes" on public.dishes
  for select to anon, authenticated using (active or public.is_staff());
create policy "staff write dishes" on public.dishes
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "public read menu" on public.menu_items
  for select to anon, authenticated using (true);
create policy "staff write menu" on public.menu_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "public read settings" on public.settings
  for select to anon, authenticated using (true);
create policy "staff write settings" on public.settings
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------- dish photos ----------
insert into storage.buckets (id, name, public)
values ('dish-photos', 'dish-photos', true)
on conflict (id) do nothing;

create policy "public read dish photos" on storage.objects
  for select to anon, authenticated using (bucket_id = 'dish-photos');
create policy "staff upload dish photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'dish-photos' and public.is_staff());
create policy "staff update dish photos" on storage.objects
  for update to authenticated using (bucket_id = 'dish-photos' and public.is_staff());
create policy "staff delete dish photos" on storage.objects
  for delete to authenticated using (bucket_id = 'dish-photos' and public.is_staff());

-- ---------- launch catalogue (proposal from docs/03-product-strategy.md) ----------
insert into public.programs (slug, name, tag_color, tagline_uz, tagline_ru, description_uz, description_ru, sort) values
  ('light', 'LIGHT', '#A8B8A3', 'Kaloriya nazorati', 'Контроль калорий',
   'Vaznni xotirjam va ochlik hissisiz kamaytirish uchun yengil, toʻyimli ratsion.',
   'Лёгкий и сытный рацион, чтобы снижать вес спокойно и без чувства голода.', 1),
  ('balance', 'BALANCE', '#C7A86B', 'Kundalik muvozanat', 'Ежедневный баланс',
   'Har kungi hayot uchun muvozanatli ovqatlanish: bozor, oshxona va hisob-kitobsiz.',
   'Сбалансированное питание на каждый день — без покупок, готовки и подсчётов.', 2),
  ('protein', 'PROTEIN', '#B5714F', 'Yuqori oqsilli ratsion', 'Высокобелковый рацион',
   'Mashgʻulot qiluvchilar uchun: har bir mahalda koʻproq oqsil, aniq koʻrsatkichlar.',
   'Для тех, кто тренируется: больше белка в каждом приёме пищи и точные цифры.', 3);

insert into public.program_variants (program_id, kcal, meals_per_day, price_per_day, sort)
select p.id, v.kcal, v.meals, v.price, v.sort
from public.programs p
join (values
  ('light', 1200, 4, 215000, 1),
  ('light', 1500, 5, 235000, 2),
  ('balance', 1800, 5, 255000, 1),
  ('balance', 2200, 5, 285000, 2),
  ('protein', 2000, 5, 295000, 1),
  ('protein', 2500, 5, 340000, 2)
) as v (slug, kcal, meals, price, sort) on v.slug = p.slug;

insert into public.durations (days, markup_pct, is_trial) values
  (2, 10, true),
  (7, 10, false),
  (14, 5, false),
  (30, 0, false);

-- Day 1 of the 30-day cycle falls on this date; the cycle then repeats.
insert into public.settings (key, value) values ('cycle_anchor', '"2026-12-01"');
