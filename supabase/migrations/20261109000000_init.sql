-- Phase 1 schema. Supabase project must be created in an EU region (data residency).
-- Later phases ADD tables; these stay stable.

create extension if not exists postgis;
create extension if not exists ltree;

-- Key/value cache for upstream data sources (DLS etc.). Written only by Edge Functions (service role).
create table if not exists public.source_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists source_cache_expires_idx on public.source_cache (expires_at);

-- Country → region → municipality (→ plan) hierarchy.
create table if not exists public.jurisdictions (
  id bigint generated always as identity primary key,
  country_code text not null,
  path ltree not null unique,            -- e.g. CY.4.4000
  level text not null check (level in ('country','region','municipality','plan')),
  names jsonb not null default '{}',     -- { "el": "...", "en": "..." }
  geom geometry(MultiPolygon, 4326)
);
create index if not exists jurisdictions_path_idx on public.jurisdictions using gist (path);
create index if not exists jurisdictions_geom_idx on public.jurisdictions using gist (geom);

-- Rule layers (OZFS-EU). Overrides the layers shipped in country modules; editable in the admin panel (phase 3).
create table if not exists public.rule_layers (
  id bigint generated always as identity primary key,
  country_code text not null,
  level text not null check (level in ('country','region','municipality','plan','source','zone')),
  match jsonb not null,                  -- { path, plan, dist_abbr, dist_prefix }
  body jsonb not null,                   -- RuleLayer minus level/match (constraints, uses, provisions…)
  status text not null default 'needs_review' check (status in ('verified','needs_review')),
  verified_by uuid,                      -- registered architect/engineer (accounts, phase 4)
  source_document text,
  source_page text,
  updated_at timestamptz not null default now()
);
create index if not exists rule_layers_country_idx on public.rule_layers (country_code, level);

-- Every check a user runs (analytics, history, alerts later).
create table if not exists public.checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                          -- null until accounts exist (phase 4)
  country_code text not null,
  national_ref text not null,
  zone_code text,
  use_type text not null,
  result jsonb not null,
  engine_version text not null,
  created_at timestamptz not null default now()
);

-- User error reports → admin review queue (phase 3 UI).
create table if not exists public.error_reports (
  id uuid primary key default gen_random_uuid(),
  check_id uuid references public.checks(id) on delete set null,
  country_code text not null,
  national_ref text,
  message text not null check (char_length(message) <= 4000),
  status text not null default 'open' check (status in ('open','accepted','rejected')),
  created_at timestamptz not null default now()
);

-- Row-level security on from day one. Nothing is readable with the anon key yet;
-- the Edge Function uses the service role. Policies are added with accounts (phase 4).
alter table public.source_cache enable row level security;
alter table public.jurisdictions enable row level security;
alter table public.rule_layers enable row level security;
alter table public.checks enable row level security;
alter table public.error_reports enable row level security;

-- Public read of jurisdictions (needed for SEO pages and dropdowns later).
create policy jurisdictions_read on public.jurisdictions for select using (true);
