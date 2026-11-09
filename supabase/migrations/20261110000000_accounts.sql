-- Phase 4: accounts. Sign-in by e-mail code (Supabase Auth). Every row belongs to one user and
-- Row Level Security lets a user see and change only their own rows.

-- Profile, created automatically on sign-up.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  company text check (char_length(company) <= 160),
  locale text not null default 'el' check (locale in ('el', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- "My plots": a plot the user keeps, with its workspace (chosen use, comparables, drawings, finance
-- assumptions). Workspace parts are JSON so the app can evolve them without migrations; sizes are capped.
create table if not exists public.saved_plots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  country_code text not null check (char_length(country_code) = 2),
  national_ref text not null check (char_length(national_ref) <= 60),
  label text check (char_length(label) <= 120),
  note text check (char_length(note) <= 4000),
  -- where to show it in the list / on the map without another lookup
  centroid_lng double precision,
  centroid_lat double precision,
  area_m2 double precision,
  zone_code text,
  use_type text,
  comparables jsonb not null default '[]'::jsonb check (pg_column_size(comparables) <= 500000),
  drawings jsonb not null default '{"type":"FeatureCollection","features":[]}'::jsonb check (pg_column_size(drawings) <= 2000000),
  finance jsonb check (pg_column_size(finance) <= 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, country_code, national_ref)
);
create index if not exists saved_plots_user_idx on public.saved_plots (user_id, updated_at desc);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists saved_plots_touch on public.saved_plots;
create trigger saved_plots_touch before update on public.saved_plots for each row execute function public.touch_updated_at();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.saved_plots enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists saved_plots_own on public.saved_plots;
create policy saved_plots_own on public.saved_plots for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Checks and error reports become the user's own once signed in.
drop policy if exists checks_own_read on public.checks;
create policy checks_own_read on public.checks for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists error_reports_insert on public.error_reports;
create policy error_reports_insert on public.error_reports for insert to authenticated with check (true);

grant select, insert, update, delete on public.saved_plots to authenticated;
grant select, insert, update on public.profiles to authenticated;
