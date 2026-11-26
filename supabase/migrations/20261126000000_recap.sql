-- Recap: tables, ingestion function and access rules.
-- Runs on any Supabase project (free tier is fine). Apply with `supabase db push`,
-- or paste this whole file into the Supabase SQL editor and press Run.
--
-- Security model
--   * The app ships the public anon key. With it, the app can call recap_ingest() and nothing else.
--     It cannot read, update or delete any Recap data.
--   * The dashboard signs in with Supabase Auth. Only emails listed in recap_members can read data.
--   * Admins (role = 'admin') can add and remove members from the dashboard.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ tables

create table if not exists public.recap_sessions (
  id            uuid primary key,
  app_id        text not null,
  started_at    timestamptz not null,
  last_seen_at  timestamptz not null,
  user_id       text,
  platform      text,
  os_version    text,
  device_model  text,
  app_version   text,
  locale        text,
  screen_width  integer,
  screen_height integer,
  sdk_version   text,
  event_count   integer not null default 0,
  tap_count     integer not null default 0,
  screen_count  integer not null default 0,
  first_screen  text,
  last_screen   text,
  created_at    timestamptz not null default now()
);

create index if not exists recap_sessions_app_started_idx on public.recap_sessions (app_id, started_at desc);
create index if not exists recap_sessions_user_idx on public.recap_sessions (user_id) where user_id is not null;

create table if not exists public.recap_events (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.recap_sessions (id) on delete cascade,
  app_id      text not null,
  type        text not null check (type in ('screen', 'tap', 'scroll', 'app_state', 'custom')),
  t_ms        integer not null,
  at          timestamptz not null,
  screen      text,
  data        jsonb not null default '{}'::jsonb
);

create index if not exists recap_events_session_idx on public.recap_events (session_id, t_ms);
create index if not exists recap_events_screen_idx on public.recap_events (app_id, screen, type);

create table if not exists public.recap_members (
  email      text primary key,
  role       text not null default 'viewer' check (role in ('viewer', 'admin')),
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ access helpers

create or replace function public.recap_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.recap_members
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.recap_is_member()
returns boolean
language sql
stable
as $$ select public.recap_role() is not null $$;

-- ------------------------------------------------------------------ row level security

alter table public.recap_sessions enable row level security;
alter table public.recap_events   enable row level security;
alter table public.recap_members  enable row level security;

-- No policies for anon at all: the app can only write through recap_ingest().
drop policy if exists recap_sessions_read on public.recap_sessions;
create policy recap_sessions_read on public.recap_sessions
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_sessions_delete on public.recap_sessions;
create policy recap_sessions_delete on public.recap_sessions
  for delete to authenticated using (public.recap_role() = 'admin');

drop policy if exists recap_events_read on public.recap_events;
create policy recap_events_read on public.recap_events
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_members_read on public.recap_members;
create policy recap_members_read on public.recap_members
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_members_admin on public.recap_members;
create policy recap_members_admin on public.recap_members
  for all to authenticated
  using (public.recap_role() = 'admin')
  with check (public.recap_role() = 'admin');

revoke all on public.recap_sessions, public.recap_events, public.recap_members from anon;

-- ------------------------------------------------------------------ ingestion

-- Called by the SDK with one batch: { appId, sdkVersion, session: {...}, events: [...] }.
create or replace function public.recap_ingest(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s          jsonb := payload -> 'session';
  d          jsonb := coalesce(payload -> 'session' -> 'device', '{}'::jsonb);
  v_app      text  := left(payload ->> 'appId', 100);
  v_session  uuid;
  v_events   jsonb := coalesce(payload -> 'events', '[]'::jsonb);
  v_count    integer;
  v_taps     integer;
  v_screens  integer;
  v_last_at  timestamptz;
  v_first    text;
  v_last     text;
begin
  if v_app is null or v_app = '' then
    raise exception 'recap: appId is required';
  end if;
  if jsonb_typeof(v_events) <> 'array' then
    raise exception 'recap: events must be an array';
  end if;
  v_count := jsonb_array_length(v_events);
  if v_count = 0 then
    return 0;
  end if;
  if v_count > 500 then
    raise exception 'recap: at most 500 events per batch';
  end if;
  if octet_length(payload::text) > 512000 then
    raise exception 'recap: batch too large';
  end if;

  begin
    v_session := (s ->> 'id')::uuid;
  exception when others then
    raise exception 'recap: session.id must be a uuid';
  end;

  select
    count(*) filter (where e ->> 'type' = 'tap'),
    count(*) filter (where e ->> 'type' = 'screen'),
    max((e ->> 'at')::timestamptz)
  into v_taps, v_screens, v_last_at
  from jsonb_array_elements(v_events) e;

  select left(e ->> 'screen', 200) into v_first
  from jsonb_array_elements(v_events) with ordinality as x(e, i)
  where e ->> 'screen' is not null order by i limit 1;

  select left(e ->> 'screen', 200) into v_last
  from jsonb_array_elements(v_events) with ordinality as x(e, i)
  where e ->> 'screen' is not null order by i desc limit 1;

  insert into public.recap_sessions as rs (
    id, app_id, started_at, last_seen_at, user_id, platform, os_version, device_model,
    app_version, locale, screen_width, screen_height, sdk_version,
    event_count, tap_count, screen_count, first_screen, last_screen
  ) values (
    v_session,
    v_app,
    coalesce((s ->> 'startedAt')::timestamptz, now()),
    coalesce(v_last_at, now()),
    left(s ->> 'userId', 200),
    left(d ->> 'platform', 20),
    left(d ->> 'osVersion', 50),
    left(d ->> 'model', 100),
    left(d ->> 'appVersion', 50),
    left(d ->> 'locale', 20),
    nullif(d ->> 'screenWidth', '')::integer,
    nullif(d ->> 'screenHeight', '')::integer,
    left(payload ->> 'sdkVersion', 20),
    v_count, v_taps, v_screens, v_first, v_last
  )
  on conflict (id) do update set
    last_seen_at = greatest(rs.last_seen_at, excluded.last_seen_at),
    user_id      = coalesce(excluded.user_id, rs.user_id),
    event_count  = rs.event_count + excluded.event_count,
    tap_count    = rs.tap_count + excluded.tap_count,
    screen_count = rs.screen_count + excluded.screen_count,
    first_screen = coalesce(rs.first_screen, excluded.first_screen),
    last_screen  = coalesce(excluded.last_screen, rs.last_screen)
  where rs.app_id = excluded.app_id;

  if not exists (select 1 from public.recap_sessions where id = v_session and app_id = v_app) then
    raise exception 'recap: session belongs to a different app';
  end if;

  insert into public.recap_events (session_id, app_id, type, t_ms, at, screen, data)
  select
    v_session,
    v_app,
    e ->> 'type',
    greatest(0, least(2147483647, coalesce((e ->> 't')::bigint, 0)))::integer,
    coalesce((e ->> 'at')::timestamptz, now()),
    left(e ->> 'screen', 200),
    coalesce(e -> 'data', '{}'::jsonb)
  from jsonb_array_elements(v_events) e
  where e ->> 'type' in ('screen', 'tap', 'scroll', 'app_state', 'custom');

  return v_count;
end;
$$;

revoke all on function public.recap_ingest(jsonb) from public;
grant execute on function public.recap_ingest(jsonb) to anon, authenticated;

-- ------------------------------------------------------------------ dashboard helpers

-- Per-screen totals for the overview page.
create or replace function public.recap_screen_stats(p_app text, p_since timestamptz)
returns table (screen text, views bigint, taps bigint, sessions bigint, exits bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with ev as (
    select e.screen, e.type, e.session_id
    from public.recap_events e
    where e.app_id = p_app and e.at >= p_since and e.screen is not null
  ),
  exits as (
    select s.last_screen as screen, count(*) as n
    from public.recap_sessions s
    where s.app_id = p_app and s.started_at >= p_since and s.last_screen is not null
    group by s.last_screen
  )
  select
    ev.screen,
    count(*) filter (where ev.type = 'screen') as views,
    count(*) filter (where ev.type = 'tap') as taps,
    count(distinct ev.session_id) as sessions,
    coalesce(max(exits.n), 0) as exits
  from ev
  left join exits on exits.screen = ev.screen
  group by ev.screen
  order by views desc, taps desc
$$;

grant execute on function public.recap_screen_stats(text, timestamptz) to authenticated;

-- Delete sessions older than N days. Schedule with pg_cron if you want automatic retention:
--   select cron.schedule('recap-retention', '0 3 * * *', $$select public.recap_purge(90)$$);
create or replace function public.recap_purge(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.recap_sessions where started_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.recap_purge(integer) from public, anon, authenticated;

-- Remove every session for one of your users (for data deletion requests). Admins only.
create or replace function public.recap_forget_user(p_user_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if public.recap_role() is distinct from 'admin' then
    raise exception 'recap: admins only';
  end if;
  delete from public.recap_sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.recap_forget_user(text) from public, anon;
grant execute on function public.recap_forget_user(text) to authenticated;

-- ------------------------------------------------------------------ first admin
-- After running this file, add yourself (use the email you'll sign in to the dashboard with):
--   insert into public.recap_members (email, role) values ('you@example.com', 'admin');
