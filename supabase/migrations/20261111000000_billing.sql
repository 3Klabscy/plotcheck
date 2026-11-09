-- Phase 5: paid access. Basic checks stay free; the full analysis of a plot (relaxations in detail,
-- finance, option comparison, PDF report, saving) needs either an active subscription or a one-off
-- purchase of that plot ("report"), which unlocks it for good.
-- Payment providers (Stripe, JCC) report through the API's webhooks; only the service role writes here.

create table if not exists public.plans (
  id text primary key,                                  -- e.g. 'pro-monthly', 'report'
  kind text not null check (kind in ('subscription', 'report')),
  name jsonb not null,                                  -- { "el": "...", "en": "..." }
  description jsonb not null default '{}'::jsonb,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'EUR',
  interval text check (interval in ('month', 'year')),  -- subscriptions only
  stripe_price_id text,                                 -- Stripe Price for subscriptions (optional for reports)
  active boolean not null default true,
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  check ((kind = 'subscription') = (interval is not null))
);

-- PLACEHOLDER prices until the client sets them (edit here or in the admin panel later).
insert into public.plans (id, kind, name, description, price_cents, interval, sort) values
  ('report', 'report', '{"el":"Πλήρης αναφορά τεμαχίου","en":"Full plot report"}',
   '{"el":"Όλη η ανάλυση και η αναφορά PDF για ένα τεμάχιο, για πάντα.","en":"The full analysis and PDF report for one plot, for good."}', 1900, null, 10),
  ('pro-monthly', 'subscription', '{"el":"Pro — μηνιαία","en":"Pro — monthly"}',
   '{"el":"Πλήρης ανάλυση για όλα τα τεμάχια.","en":"Full analysis for every plot."}', 4900, 'month', 20),
  ('pro-yearly', 'subscription', '{"el":"Pro — ετήσια","en":"Pro — yearly"}',
   '{"el":"Πλήρης ανάλυση για όλα τα τεμάχια, 2 μήνες δώρο.","en":"Full analysis for every plot, 2 months free."}', 49000, 'year', 30)
on conflict (id) do nothing;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  provider text not null check (provider in ('stripe', 'jcc', 'manual')),
  provider_customer_id text,
  provider_subscription_id text unique,
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id, status);

-- One-off purchases: a paid report unlocks one plot for its owner.
create table if not exists public.unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  country_code text not null,
  national_ref text not null,
  provider text not null check (provider in ('stripe', 'jcc', 'manual')),
  provider_payment_id text unique,
  amount_cents integer,
  currency text,
  created_at timestamptz not null default now(),
  unique (user_id, country_code, national_ref)
);

-- Pending provider orders (JCC needs a server-side order to check the result against).
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  provider text not null check (provider in ('stripe', 'jcc')),
  provider_order_id text unique,
  country_code text,
  national_ref text,
  amount_cents integer not null,
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every webhook once (providers retry).
create table if not exists public.payment_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();
drop trigger if exists payment_orders_touch on public.payment_orders;
create trigger payment_orders_touch before update on public.payment_orders for each row execute function public.touch_updated_at();

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.unlocks enable row level security;
alter table public.payment_orders enable row level security;
alter table public.payment_events enable row level security;

-- Plans are public; users read only their own subscriptions, unlocks and orders. Nobody but the
-- service role writes (no insert/update/delete policies for users).
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select using (active);
drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_own on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists unlocks_own on public.unlocks;
create policy unlocks_own on public.unlocks for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists orders_own on public.payment_orders;
create policy orders_own on public.payment_orders for select to authenticated using (user_id = (select auth.uid()));

grant select on public.plans to anon, authenticated;
grant select on public.subscriptions, public.unlocks, public.payment_orders to authenticated;

-- Full access to a plot: an active subscription or an unlock of that plot.
create or replace function public.has_full_access(p_user uuid, p_country text, p_ref text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user and s.status in ('active', 'trialing', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now() - interval '3 days')
  ) or exists (
    select 1 from public.unlocks u where u.user_id = p_user and u.country_code = p_country and u.national_ref = p_ref
  );
$$;
revoke all on function public.has_full_access(uuid, text, text) from public, anon, authenticated;

-- The signed-in user's own access (used by policies and the app; cannot ask about other users).
create or replace function public.my_full_access(p_country text, p_ref text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_full_access((select auth.uid()), p_country, p_ref);
$$;
revoke all on function public.my_full_access(text, text) from public, anon;
grant execute on function public.my_full_access(text, text) to authenticated;

-- Saving plots is part of the paid access: only users with a subscription or an unlock of that plot.
drop policy if exists saved_plots_own on public.saved_plots;
create policy saved_plots_read on public.saved_plots for select to authenticated using (user_id = (select auth.uid()));
create policy saved_plots_delete on public.saved_plots for delete to authenticated using (user_id = (select auth.uid()));
create policy saved_plots_write on public.saved_plots for insert to authenticated
  with check (user_id = (select auth.uid()) and public.my_full_access(country_code, national_ref));
create policy saved_plots_update on public.saved_plots for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.my_full_access(country_code, national_ref));
