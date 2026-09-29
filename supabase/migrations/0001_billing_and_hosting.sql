-- mobile.do: accounts, subscriptions (Cashfree) and hosted apps.
-- Run once in the Supabase SQL editor (or `supabase db push`).

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user, holds the current plan entitlement.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text,
  full_name           text,
  avatar_url          text,
  plan                text not null default 'free' check (plan in ('free', 'pro')),
  subscription_id     text,
  subscription_status text,
  -- Paid access continues until this time after a cancel (end of paid period).
  period_end          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Subscriptions: mirror of Cashfree subscriptions we created.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                 text primary key,           -- subscription_id we sent to Cashfree
  user_id            uuid not null references public.profiles (id) on delete cascade,
  plan               text not null check (plan = 'pro'),
  status             text not null default 'INITIALIZED',
  cf_subscription_id text,
  next_charge_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Hosted apps.
-- ---------------------------------------------------------------------------
create table if not exists public.apps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  slug          text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name          text not null check (char_length(name) between 1 and 80),
  html          text not null check (octet_length(html) <= 1000000),
  theme_color   text,
  icon_192      text,   -- base64 PNG
  icon_512      text,   -- base64 PNG
  source        text,
  brief         text,
  custom_domain text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists apps_user_idx on public.apps (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Entitlements. Single source of truth for plan limits.
-- ---------------------------------------------------------------------------
create or replace function public.plan_app_limit(p text)
returns int
language sql
immutable
as $$
  -- free: 0 hosted apps (generate + preview only); pro: unlimited.
  select case p when 'pro' then 2147483647 else 0 end;
$$;

-- Effective plan: paid plans count while ACTIVE, or until period_end after a cancel.
create or replace function public.effective_plan(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when p.plan = 'free' then 'free'
      when p.subscription_status = 'ACTIVE' then p.plan
      when p.period_end is not null and p.period_end > now() then p.plan
      else 'free'
    end
    from public.profiles p where p.id = uid
  ), 'free');
$$;

create or replace function public.app_limit(uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select public.plan_app_limit(public.effective_plan(uid));
$$;

-- Enforce the hosted-app quota atomically on insert.
create or replace function public.enforce_app_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  used int;
  lim  int;
begin
  perform pg_advisory_xact_lock(hashtext('apps:' || new.user_id::text));
  select count(*) into used from public.apps where user_id = new.user_id;
  lim := public.app_limit(new.user_id);
  if used >= lim then
    raise exception 'APP_LIMIT_REACHED: %', case when lim = 0 then 'Publishing apps needs Pro' else format('your plan allows %s hosted apps', lim) end using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists apps_enforce_quota on public.apps;
create trigger apps_enforce_quota
  before insert on public.apps
  for each row execute function public.enforce_app_quota();

-- Is this app within its owner's plan (oldest N apps run)?
create or replace function public.app_is_running(app uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target as (select id, user_id from public.apps where id = app),
  ranked as (
    select a.id, row_number() over (order by a.created_at, a.id) as rn
    from public.apps a join target t on a.user_id = t.user_id
  )
  select coalesce((select r.rn <= public.app_limit(t.user_id) from ranked r join target t on r.id = t.id), false);
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();
drop trigger if exists apps_touch on public.apps;
create trigger apps_touch before update on public.apps for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: users read their own rows. All writes go through the
-- server with the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.subscriptions enable row level security;
alter table public.apps          enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "own subscriptions" on public.subscriptions;
create policy "own subscriptions" on public.subscriptions for select using (auth.uid() = user_id);
drop policy if exists "own apps" on public.apps;
create policy "own apps" on public.apps for select using (auth.uid() = user_id);

-- Entitlement helpers are for the server (service role) only.
revoke execute on function public.app_is_running(uuid) from public, anon, authenticated;
revoke execute on function public.effective_plan(uuid) from public, anon, authenticated;
revoke execute on function public.app_limit(uuid) from public, anon, authenticated;
