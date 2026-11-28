-- Recap: the whole database setup in one file.
--
-- Paste all of this into your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query)
-- and press Run. It creates Recap's tables, functions and access rules. It is safe to run again,
-- for example after updating Recap. Supabase may warn that the query is "destructive": it only drops
-- and recreates Recap's own access rules, so press "Run this query".
--
-- Then make yourself the first dashboard admin (the email you will sign in with), in a new query:
--
--   insert into public.recap_members (email, role) values ('you@example.com', 'admin');
--
-- Generated from supabase/migrations/ by scripts/build-setup-sql.mjs. Don't edit this file by hand:
-- change a migration and run `node scripts/build-setup-sql.mjs`. With the Supabase CLI you can use
-- the migrations instead (supabase db push).
--
-- Contents:
--   1. 20261126000000_recap.sql
--   2. 20261127000000_recap_analytics.sql
--   3. 20261127010000_recap_screenshots.sql
--   4. 20261127020000_recap_recordings.sql
--   5. 20261127025000_recap_dom.sql
--   6. 20261127030000_recap_storage_limits.sql
--   7. 20261127040000_recap_dom_limits.sql
--   8. 20261128000000_recap_recording_limits.sql
--   9. 20261128010000_recap_hardening.sql

-- ================================================================================================
-- 20261126000000_recap.sql
-- ================================================================================================

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
  anonymous_id  text,
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
alter table public.recap_sessions add column if not exists anonymous_id text;  -- for databases set up before it existed
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
    id, app_id, started_at, last_seen_at, user_id, anonymous_id, platform, os_version, device_model,
    app_version, locale, screen_width, screen_height, sdk_version,
    event_count, tap_count, screen_count, first_screen, last_screen
  ) values (
    v_session,
    v_app,
    coalesce((s ->> 'startedAt')::timestamptz, now()),
    coalesce(v_last_at, now()),
    left(s ->> 'userId', 200),
    left(s ->> 'anonymousId', 100),
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
    anonymous_id = coalesce(rs.anonymous_id, excluded.anonymous_id),
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

-- ================================================================================================
-- 20261127000000_recap_analytics.sql
-- ================================================================================================

-- Recap analytics: trends, funnels, retention, breakdowns and custom events (Mixpanel-style).
-- Run after 20261126000000_recap.sql. Safe to run again.
--
-- Every function here runs as the signed-in dashboard user (security invoker), so the row level
-- security from the first migration still decides what they can see: team members get their data,
-- everyone else gets nothing. The app's public key cannot call any of them.
--
-- Event names
--   Recap records screens, taps, scrolls and custom events. Analytics turns them into named events:
--     Session started      one per session
--     Viewed <screen>      every screen view
--     Tapped <label>       taps on buttons wrapped with recapPress('label', ...)
--     <name>               anything sent with recap.track('name', props)
--   Unlabelled taps, scrolls and app state changes stay out of analytics (they power heatmaps).
--
-- Users
--   A user is your own user id when the app calls recap.setUserId(), otherwise the SDK's anonymous
--   install id, otherwise the session itself (older SDK versions that didn't send an install id).

-- ------------------------------------------------------------------ anonymous install id

alter table public.recap_sessions add column if not exists anonymous_id text;
create index if not exists recap_sessions_anon_idx on public.recap_sessions (anonymous_id) where anonymous_id is not null;
create index if not exists recap_events_app_at_idx on public.recap_events (app_id, at);

-- Same as the first migration, plus session.anonymousId.
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
    id, app_id, started_at, last_seen_at, user_id, anonymous_id, platform, os_version, device_model,
    app_version, locale, screen_width, screen_height, sdk_version,
    event_count, tap_count, screen_count, first_screen, last_screen
  ) values (
    v_session,
    v_app,
    coalesce((s ->> 'startedAt')::timestamptz, now()),
    coalesce(v_last_at, now()),
    left(s ->> 'userId', 200),
    left(s ->> 'anonymousId', 100),
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
    anonymous_id = coalesce(rs.anonymous_id, excluded.anonymous_id),
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

-- ------------------------------------------------------------------ named events

drop view if exists public.recap_analytics_events;
create view public.recap_analytics_events with (security_invoker = true) as
  select
    e.app_id,
    e.session_id,
    coalesce(s.user_id, s.anonymous_id, s.id::text) as distinct_id,
    case e.type
      when 'screen' then 'Viewed ' || e.screen
      when 'tap'    then 'Tapped ' || (e.data ->> 'label')
      else left(e.data ->> 'name', 200)
    end as name,
    e.type as kind,
    e.at,
    e.screen,
    s.platform, s.app_version, s.os_version, s.device_model, s.locale,
    e.data
  from public.recap_events e
  join public.recap_sessions s on s.id = e.session_id
  where (e.type = 'screen' and e.screen is not null)
     or (e.type = 'tap' and e.data ->> 'label' is not null)
     or (e.type = 'custom' and e.data ->> 'name' is not null)
  union all
  select
    s.app_id,
    s.id,
    coalesce(s.user_id, s.anonymous_id, s.id::text),
    'Session started',
    'session',
    s.started_at,
    s.first_screen,
    s.platform, s.app_version, s.os_version, s.device_model, s.locale,
    '{}'::jsonb
  from public.recap_sessions s;

revoke all on public.recap_analytics_events from public, anon;
grant select on public.recap_analytics_events to authenticated;

-- Filters: {"platform": "ios", "app_version": "2.4.0", ...}. Unknown keys are ignored.
create or replace function public.recap_filter_ok(
  f jsonb, platform text, app_version text, os_version text, device_model text, locale text
) returns boolean
language sql
immutable
as $$
  select f is null or (
        (f ->> 'platform'     is null or f ->> 'platform'     = platform)
    and (f ->> 'app_version'  is null or f ->> 'app_version'  = app_version)
    and (f ->> 'os_version'   is null or f ->> 'os_version'   = os_version)
    and (f ->> 'device_model' is null or f ->> 'device_model' = device_model)
    and (f ->> 'locale'       is null or f ->> 'locale'       = locale))
$$;

-- The value of a breakdown property for one event. Properties: platform, app_version, os_version,
-- device_model, locale, screen, or "prop:<key>" for a property sent with recap.track().
create or replace function public.recap_prop(
  p text, platform text, app_version text, os_version text, device_model text, locale text, screen text, data jsonb
) returns text
language sql
immutable
as $$
  select coalesce(
    case p
      when 'platform'     then platform
      when 'app_version'  then app_version
      when 'os_version'   then os_version
      when 'device_model' then device_model
      when 'locale'       then locale
      when 'screen'       then screen
      else case when p like 'prop:%' then data ->> substr(p, 6) end
    end,
    '(none)')
$$;

-- ------------------------------------------------------------------ events list

create or replace function public.recap_event_names(p_app text, p_since timestamptz, p_until timestamptz default now())
returns table (name text, kind text, events bigint, users bigint, last_seen timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select name, min(kind), count(*), count(distinct distinct_id), max(at)
  from public.recap_analytics_events
  where app_id = p_app and at >= p_since and at < p_until
  group by name
  order by count(*) desc, name collate "C"
$$;

-- Top values of each property sent with one custom event.
create or replace function public.recap_event_properties(
  p_app text, p_since timestamptz, p_until timestamptz, p_event text
) returns table (key text, value text, events bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with kv as (
    select p.key, p.value, count(*) as n
    from public.recap_analytics_events e
    cross join lateral jsonb_each_text(case when jsonb_typeof(e.data) = 'object' then e.data else '{}'::jsonb end) p
    where e.app_id = p_app and e.at >= p_since and e.at < p_until and e.name = p_event
      and p.key not in ('name', 'label', 'x', 'y', 'nx', 'ny', 'from')
    group by p.key, p.value
  ), ranked as (
    select kv.*, row_number() over (partition by kv.key order by kv.n desc, kv.value collate "C") as r from kv
  )
  select key, value, n from ranked where r <= 10 order by key collate "C", n desc, value collate "C"
$$;

-- ------------------------------------------------------------------ trends

-- Events (or unique users) per hour, day, week or month. With a breakdown, the six biggest
-- segments are kept and the rest are grouped as "Other".
create or replace function public.recap_trend(
  p_app text,
  p_since timestamptz,
  p_until timestamptz default now(),
  p_event text default 'Session started',
  p_measure text default 'total',
  p_interval text default 'day',
  p_breakdown text default null,
  p_filters jsonb default '{}'::jsonb,
  p_tz text default 'UTC'
) returns table (bucket timestamptz, segment text, value bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with ev as (
    select
      date_trunc(p_interval, e.at at time zone p_tz) at time zone p_tz as bucket,
      case when p_breakdown is null then 'All'
           else public.recap_prop(p_breakdown, e.platform, e.app_version, e.os_version, e.device_model, e.locale, e.screen, e.data)
      end as seg,
      e.distinct_id
    from public.recap_analytics_events e
    where e.app_id = p_app and e.at >= p_since and e.at < p_until
      and (p_event is null or e.name = p_event)
      and public.recap_filter_ok(p_filters, e.platform, e.app_version, e.os_version, e.device_model, e.locale)
  ), top as (
    select seg from ev group by seg order by count(*) desc, seg collate "C" limit 6
  )
  select bucket,
         case when seg in (select seg from top) then seg else 'Other' end as segment,
         case when p_measure = 'uniques' then count(distinct distinct_id) else count(*) end as value
  from ev
  group by 1, 2
  order by 1, (case when seg in (select seg from top) then seg else 'Other' end) collate "C"
$$;

-- ------------------------------------------------------------------ breakdowns

create or replace function public.recap_breakdown(
  p_app text,
  p_since timestamptz,
  p_until timestamptz,
  p_event text,
  p_property text,
  p_filters jsonb default '{}'::jsonb
) returns table (segment text, events bigint, users bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select public.recap_prop(p_property, e.platform, e.app_version, e.os_version, e.device_model, e.locale, e.screen, e.data),
         count(*),
         count(distinct e.distinct_id)
  from public.recap_analytics_events e
  where e.app_id = p_app and e.at >= p_since and e.at < p_until
    and (p_event is null or e.name = p_event)
    and public.recap_filter_ok(p_filters, e.platform, e.app_version, e.os_version, e.device_model, e.locale)
  group by 1
  order by 2 desc,
    public.recap_prop(p_property, e.platform, e.app_version, e.os_version, e.device_model, e.locale, e.screen, e.data) collate "C"
  limit 50
$$;

-- ------------------------------------------------------------------ funnels

-- Users who did each step in order, each step after the one before and all within the
-- conversion window of the first step. avg_seconds is the average time from the previous step.
create or replace function public.recap_funnel(
  p_app text,
  p_since timestamptz,
  p_until timestamptz,
  p_steps text[],
  p_window_minutes integer default 1440,
  p_breakdown text default null,
  p_filters jsonb default '{}'::jsonb
) returns table (step integer, segment text, users bigint, avg_seconds double precision)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive ev as (
    select e.distinct_id, e.name, e.at,
           case when p_breakdown is null then 'All'
                else public.recap_prop(p_breakdown, e.platform, e.app_version, e.os_version, e.device_model, e.locale, e.screen, e.data)
           end as seg
    from public.recap_analytics_events e
    where e.app_id = p_app and e.at >= p_since and e.at < p_until
      and e.name = any (p_steps)
      and public.recap_filter_ok(p_filters, e.platform, e.app_version, e.os_version, e.device_model, e.locale)
  ), first_step as (
    select distinct on (distinct_id) distinct_id, at, seg
    from ev where name = p_steps[1]
    order by distinct_id, at
  ), f (distinct_id, seg, step, t0, t, prev) as (
    select distinct_id, seg, 1, at, at, at from first_step
    union all
    select f.distinct_id, f.seg, f.step + 1, f.t0, n.at, f.t
    from f
    cross join lateral (
      select min(e.at) as at from ev e
      where e.distinct_id = f.distinct_id
        and e.name = p_steps[f.step + 1]
        and e.at >= f.t
        and (p_steps[f.step + 1] <> p_steps[f.step] or e.at > f.t)
        and e.at <= f.t0 + make_interval(mins => p_window_minutes)
    ) n
    where f.step < cardinality(p_steps) and n.at is not null
  ), top as (
    select seg from f where step = 1 group by seg order by count(*) desc, seg collate "C" limit 6
  )
  select f.step,
         case when f.seg in (select seg from top) then f.seg else 'Other' end,
         count(*),
         case when f.step = 1 then null else avg(extract(epoch from f.t - f.prev))::double precision end
  from f
  group by 1, 2
  order by 1, (case when f.seg in (select seg from top) then f.seg else 'Other' end) collate "C"
$$;

-- ------------------------------------------------------------------ retention

-- Cohorts of users by when they first did p_start_event in the range, and how many of them did
-- p_return_event in each later day or week (period 0 is the cohort's own day or week).
create or replace function public.recap_retention(
  p_app text,
  p_since timestamptz,
  p_until timestamptz default now(),
  p_interval text default 'day',
  p_start_event text default 'Session started',
  p_return_event text default 'Session started',
  p_filters jsonb default '{}'::jsonb,
  p_tz text default 'UTC'
) returns table (cohort timestamptz, cohort_size bigint, period integer, users bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select e.distinct_id, e.name, e.at
    from public.recap_analytics_events e
    where e.app_id = p_app and e.at >= p_since and e.at < p_until
      and e.name in (p_start_event, p_return_event)
      and public.recap_filter_ok(p_filters, e.platform, e.app_version, e.os_version, e.device_model, e.locale)
  ), cohorts as (
    select distinct_id, date_trunc(p_interval, min(at) at time zone p_tz) at time zone p_tz as cohort
    from base where name = p_start_event
    group by distinct_id
  ), sizes as (
    select cohort, count(*) as n from cohorts group by cohort
  ), returned as (
    select distinct c.cohort, c.distinct_id,
           round(extract(epoch from (date_trunc(p_interval, b.at at time zone p_tz) at time zone p_tz) - c.cohort)
                 / case when p_interval = 'week' then 604800 else 86400 end)::integer as period
    from cohorts c
    join base b on b.distinct_id = c.distinct_id and b.name = p_return_event and b.at >= c.cohort
  )
  select s.cohort, s.n, r.period, count(*)
  from sizes s
  join returned r on r.cohort = s.cohort
  where r.period between 0 and 12
  group by s.cohort, s.n, r.period
  order by s.cohort, r.period
$$;

-- ------------------------------------------------------------------ access

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.recap_event_names(text, timestamptz, timestamptz)',
    'public.recap_event_properties(text, timestamptz, timestamptz, text)',
    'public.recap_trend(text, timestamptz, timestamptz, text, text, text, text, jsonb, text)',
    'public.recap_breakdown(text, timestamptz, timestamptz, text, text, jsonb)',
    'public.recap_funnel(text, timestamptz, timestamptz, text[], integer, text, jsonb)',
    'public.recap_retention(text, timestamptz, timestamptz, text, text, text, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ================================================================================================
-- 20261127010000_recap_screenshots.sql
-- ================================================================================================

-- Recap screen pictures: one small JPEG per screen, drawn behind its heatmap in the dashboard.
-- Run after the earlier Recap migrations. Safe to run again.
--
-- The SDK only sends these when the app turns on `screenshots` (we suggest `screenshots: __DEV__`,
-- so pictures come from your own test phone, never from real users). Each upload replaces the
-- previous picture of that screen for the same platform and app version.

create table if not exists public.recap_screenshots (
  app_id      text not null,
  screen      text not null,
  platform    text not null default '',
  app_version text not null default '',
  width       integer,
  height      integer,
  image       text not null,
  captured_at timestamptz not null default now(),
  primary key (app_id, screen, platform, app_version)
);

alter table public.recap_screenshots enable row level security;

drop policy if exists recap_screenshots_read on public.recap_screenshots;
create policy recap_screenshots_read on public.recap_screenshots
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_screenshots_delete on public.recap_screenshots;
create policy recap_screenshots_delete on public.recap_screenshots
  for delete to authenticated using (public.recap_role() = 'admin');

revoke all on public.recap_screenshots from anon;

-- Called by the SDK with { appId, screen, platform, appVersion, width, height, image }.
create or replace function public.recap_screenshot(payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app    text := left(payload ->> 'appId', 100);
  v_screen text := left(payload ->> 'screen', 200);
  v_image  text := payload ->> 'image';
begin
  if v_app is null or v_app = '' or v_screen is null or v_screen = '' then
    raise exception 'recap: appId and screen are required';
  end if;
  if v_image is null or v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
    raise exception 'recap: image must be a base64 data URL';
  end if;
  if length(v_image) > 700000 then
    raise exception 'recap: image too large (keep it under about 500 KB)';
  end if;

  insert into public.recap_screenshots as rs (app_id, screen, platform, app_version, width, height, image, captured_at)
  values (
    v_app,
    v_screen,
    coalesce(left(payload ->> 'platform', 20), ''),
    coalesce(left(payload ->> 'appVersion', 50), ''),
    least(10000, greatest(0, coalesce((payload ->> 'width')::integer, 0))),
    least(10000, greatest(0, coalesce((payload ->> 'height')::integer, 0))),
    v_image,
    now()
  )
  on conflict (app_id, screen, platform, app_version) do update set
    width = excluded.width, height = excluded.height, image = excluded.image, captured_at = excluded.captured_at;
  return true;
end;
$$;

revoke all on function public.recap_screenshot(jsonb) from public;
grant execute on function public.recap_screenshot(jsonb) to anon, authenticated;

-- ================================================================================================
-- 20261127020000_recap_recordings.sql
-- ================================================================================================

-- Recap screen recordings: small pictures taken about once a second, played back as a session replay.
-- Run after the earlier Recap migrations. Safe to run again.
--
-- The SDK only sends these when the app turns on `recordings`. Frames belong to a session and are
-- deleted with it (by an admin, by recap_purge or by recap_forget_user). A frame with no image marks
-- a moment when recording was paused for privacy (keyboard open, a <RecapPrivate> view, an excluded screen).
--
-- Size: a frame is usually 10 to 25 KB, so a ten-minute session is a few MB. On Supabase's free plan
-- (500 MB database) use `recordings: { sampleRate: 0.1 }` or similar on busy apps, and a retention
-- schedule with recap_purge.

create table if not exists public.recap_frames (
  session_id uuid not null references public.recap_sessions (id) on delete cascade,
  app_id     text not null,
  t_ms       integer not null,
  image      text,
  primary key (session_id, t_ms)
);

alter table public.recap_frames enable row level security;

drop policy if exists recap_frames_read on public.recap_frames;
create policy recap_frames_read on public.recap_frames
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_frames_delete on public.recap_frames;
create policy recap_frames_delete on public.recap_frames
  for delete to authenticated using (public.recap_role() = 'admin');

revoke all on public.recap_frames from anon;

-- Called by the SDK with { appId, sessionId, frames: [{ t, image }] }. Returns how many were stored.
create or replace function public.recap_frames(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app     text := left(payload ->> 'appId', 100);
  v_session uuid;
  v_frames  jsonb := payload -> 'frames';
  v_have    integer;
  v_count   integer := 0;
  f         jsonb;
  v_image   text;
begin
  begin
    v_session := (payload ->> 'sessionId')::uuid;
  exception when others then
    raise exception 'recap: sessionId must be a uuid';
  end;
  if v_app is null or v_app = '' or v_session is null then
    raise exception 'recap: appId and sessionId are required';
  end if;
  if jsonb_typeof(v_frames) is distinct from 'array' or jsonb_array_length(v_frames) > 20 then
    raise exception 'recap: frames must be an array of at most 20';
  end if;
  -- The session must already exist for this app (the SDK uploads it first).
  if not exists (select 1 from public.recap_sessions where id = v_session and app_id = v_app) then
    return 0;
  end if;
  select count(*) into v_have from public.recap_frames where session_id = v_session;

  for f in select * from jsonb_array_elements(v_frames) loop
    exit when v_have + v_count >= 3600;
    v_image := f ->> 'image';
    if v_image is not null then
      if v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
        raise exception 'recap: image must be a base64 data URL';
      end if;
      if length(v_image) > 250000 then
        continue; -- too big for a replay frame; skip it rather than fail the batch
      end if;
    end if;
    insert into public.recap_frames (session_id, app_id, t_ms, image)
    values (v_session, v_app, greatest(0, least(86400000, coalesce(round((f ->> 't')::numeric)::integer, 0))), v_image)
    on conflict (session_id, t_ms) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.recap_frames(jsonb) from public;
grant execute on function public.recap_frames(jsonb) to anon, authenticated;

-- ================================================================================================
-- 20261127025000_recap_dom.sql
-- ================================================================================================

-- Recap page recordings for websites and web apps: rrweb events, played back as a session replay.
-- Run after the earlier Recap migrations. Safe to run again.
--
-- The web SDK only sends these when the site turns on `remote.recordings` and loads rrweb. rrweb
-- records the page's structure and its changes, not pictures, with every form field masked and
-- anything marked `.recap-private` or `[data-ut-no-track]` left out. Chunks belong to a session and
-- are deleted with it (by an admin, by recap_purge or by recap_forget_user).
--
-- Size: a few hundred KB for the first view of a page, then small changes. On Supabase's free plan
-- (500 MB database) use `recordings: { sampleRate: 0.1 }` or similar on busy sites, and a retention
-- schedule with recap_purge.

create table if not exists public.recap_dom (
  id         bigint generated always as identity primary key,
  session_id uuid not null references public.recap_sessions (id) on delete cascade,
  app_id     text not null,
  t_ms       integer not null,
  events     jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists recap_dom_session_idx on public.recap_dom (session_id, t_ms, id);

alter table public.recap_dom enable row level security;

drop policy if exists recap_dom_read on public.recap_dom;
create policy recap_dom_read on public.recap_dom
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_dom_delete on public.recap_dom;
create policy recap_dom_delete on public.recap_dom
  for delete to authenticated using (public.recap_role() = 'admin');

revoke all on public.recap_dom from anon;

-- Called by the web SDK with { appId, sessionId, t, events: [rrweb events] }. Returns how many were stored.
create or replace function public.recap_dom(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app     text := left(payload ->> 'appId', 100);
  v_session uuid;
  v_events  jsonb := payload -> 'events';
  v_chunks  integer;
begin
  begin
    v_session := (payload ->> 'sessionId')::uuid;
  exception when others then
    raise exception 'recap: sessionId must be a uuid';
  end;
  if v_app is null or v_app = '' or v_session is null then
    raise exception 'recap: appId and sessionId are required';
  end if;
  if jsonb_typeof(v_events) is distinct from 'array' or jsonb_array_length(v_events) = 0 then
    return 0;
  end if;
  if jsonb_array_length(v_events) > 5000 then
    raise exception 'recap: at most 5000 recording events per chunk';
  end if;
  if octet_length(v_events::text) > 3000000 then
    raise exception 'recap: recording chunk too large (keep it under about 3 MB)';
  end if;
  -- The session must already exist for this app (the SDK uploads it first).
  if not exists (select 1 from public.recap_sessions where id = v_session and app_id = v_app) then
    return 0;
  end if;
  select count(*) into v_chunks from public.recap_dom where session_id = v_session;
  if v_chunks >= 2000 then
    return 0; -- a very long session: stop storing more of it
  end if;

  insert into public.recap_dom (session_id, app_id, t_ms, events)
  values (
    v_session,
    v_app,
    greatest(0, least(86400000, coalesce(round((payload ->> 't')::numeric)::integer, 0))),
    v_events
  );
  return jsonb_array_length(v_events);
end;
$$;

revoke all on function public.recap_dom(jsonb) from public;
grant execute on function public.recap_dom(jsonb) to anon, authenticated;

-- ================================================================================================
-- 20261127030000_recap_storage_limits.sql
-- ================================================================================================

-- Recap storage limits: settings an admin changes from the dashboard's Storage page, enforced in
-- the database so they cover every app (iOS, Android and web) without shipping an app update.
-- Run after the earlier Recap migrations. Safe to run again.
--
--   keep_days        Delete sessions (and their events and replays) older than this. Runs by
--                    itself about once an hour when new sessions arrive, so no scheduler is needed.
--                    Null keeps everything.
--   session_sample   Share of new sessions kept, 0 to 1. Applied on top of each app's own sampleRate.
--   replay_sample    Share of kept sessions that also keep a replay, 0 to 1.
--   max_frames       Most replay frames kept per session (about one a second).
--   daily_sessions   Most new sessions accepted per day (UTC) across all apps. Null is no limit.
--   max_db_mb        Stop accepting new sessions and replay frames once Recap's data reaches this
--                    size (estimated, see recap_data_bytes). Supabase's free plan allows 500 MB for
--                    the whole database, so 400 leaves room. Null is no limit.
--
-- A refused session is dropped quietly: the SDK sees success and doesn't retry.

create table if not exists public.recap_settings (
  id              integer primary key default 1 check (id = 1),
  keep_days       integer check (keep_days is null or keep_days between 1 and 3650),
  session_sample  numeric not null default 1 check (session_sample between 0 and 1),
  replay_sample   numeric not null default 1 check (replay_sample between 0 and 1),
  max_frames      integer not null default 600 check (max_frames between 0 and 3600),
  daily_sessions  integer check (daily_sessions is null or daily_sessions >= 0),
  max_db_mb       integer check (max_db_mb is null or max_db_mb >= 50),
  last_purge_at   timestamptz,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

-- Defaults for a new install: keep 90 days, stop at 400 MB. Existing settings are left alone.
insert into public.recap_settings (id, keep_days, max_db_mb) values (1, 90, 400) on conflict (id) do nothing;

alter table public.recap_settings enable row level security;

drop policy if exists recap_settings_read on public.recap_settings;
create policy recap_settings_read on public.recap_settings
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_settings_admin on public.recap_settings;
create policy recap_settings_admin on public.recap_settings
  for update to authenticated
  using (public.recap_role() = 'admin')
  with check (public.recap_role() = 'admin');

revoke all on public.recap_settings from anon;
revoke insert, delete, truncate on public.recap_settings from authenticated;

create index if not exists recap_sessions_created_idx on public.recap_sessions (created_at);

-- Replay picture bytes per session, kept up to date by recap_frames, so the size of Recap's data can
-- be estimated quickly. (Postgres keeps a table's disk space after rows are deleted and reuses it, so
-- the database's own size doesn't go down after a clean-up; this estimate does.)
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'recap_sessions' and column_name = 'replay_bytes') then
    alter table public.recap_sessions add column replay_bytes bigint not null default 0;
    update public.recap_sessions s set replay_bytes = f.b
    from (select session_id, sum(coalesce(octet_length(image), 0)) b from public.recap_frames group by session_id) f
    where f.session_id = s.id;
  end if;
end $$;

-- ------------------------------------------------------------------ helpers (not callable by the app)

create or replace function public.recap_setting_num(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (to_jsonb(s) ->> p_key)::numeric from public.recap_settings s where id = 1), p_default)
$$;

-- Same answer every time for the same key, so a session is either always in or always out.
create or replace function public.recap_in_sample(p_key text, p_share numeric)
returns boolean
language sql
immutable
as $$
  select case
    when p_share >= 1 then true
    when p_share <= 0 then false
    else (abs(hashtext(p_key)::bigint) % 10000) < round(p_share * 10000)
  end
$$;

-- Estimated bytes of Recap data: replay pictures (counted exactly), plus about 300 bytes per event and
-- 500 per session, plus the heatmap pictures table.
create or replace function public.recap_data_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum(replay_bytes) from public.recap_sessions), 0)
    + greatest(0, (select reltuples from pg_class where oid = 'public.recap_events'::regclass))::bigint * 300
    + (select count(*) from public.recap_sessions) * 500
    + pg_total_relation_size('public.recap_screenshots')
  )::bigint
$$;

create or replace function public.recap_over_size_cap()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.recap_data_bytes() > (select max_db_mb from public.recap_settings where id = 1)::bigint * 1024 * 1024, false)
$$;

create or replace function public.recap_accept_new_session(p_session uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daily integer := (select daily_sessions from public.recap_settings where id = 1);
begin
  if not public.recap_in_sample('session:' || p_session::text, public.recap_setting_num('session_sample', 1)) then
    return false;
  end if;
  if v_daily is not null and (
    select count(*) from public.recap_sessions where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  ) >= v_daily then
    return false;
  end if;
  if public.recap_over_size_cap() then
    return false;
  end if;
  return true;
end;
$$;

-- Deletes sessions older than keep_days, at most once an hour. Called when new sessions arrive.
create or replace function public.recap_auto_purge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
begin
  update public.recap_settings set last_purge_at = now()
  where id = 1 and keep_days is not null and (last_purge_at is null or last_purge_at < now() - interval '1 hour')
  returning keep_days into v_days;
  if v_days is not null then
    perform public.recap_purge(v_days);
  end if;
end;
$$;

revoke all on function public.recap_setting_num(text, numeric) from public, anon, authenticated;
revoke all on function public.recap_over_size_cap() from public, anon, authenticated;
revoke all on function public.recap_data_bytes() from public, anon, authenticated;
revoke all on function public.recap_accept_new_session(uuid) from public, anon, authenticated;
revoke all on function public.recap_auto_purge() from public, anon, authenticated;

-- ------------------------------------------------------------------ dashboard (members read, admins act)

-- How much room Recap is using, for the Storage page.
create or replace function public.recap_storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.recap_is_member() then
    raise exception 'recap: members only';
  end if;
  return jsonb_build_object(
    'databaseBytes',    pg_database_size(current_database()),
    'recapBytes',       public.recap_data_bytes(),
    'sessionsBytes',    pg_total_relation_size('public.recap_sessions'),
    'eventsBytes',      pg_total_relation_size('public.recap_events'),
    'framesBytes',      pg_total_relation_size('public.recap_frames'),
    'screenshotsBytes', pg_total_relation_size('public.recap_screenshots'),
    'sessions',         (select count(*) from public.recap_sessions),
    'sessionsToday',    (select count(*) from public.recap_sessions where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    'sessionsWithReplay', (select count(distinct session_id) from public.recap_frames),
    'oldestSession',    (select min(started_at) from public.recap_sessions)
  );
end;
$$;

revoke all on function public.recap_storage_usage() from public, anon;
grant execute on function public.recap_storage_usage() to authenticated;

-- "Delete old data now" on the Storage page. Admins only. Returns how many sessions were removed.
create or replace function public.recap_purge_now()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := (select keep_days from public.recap_settings where id = 1);
begin
  if public.recap_role() is distinct from 'admin' then
    raise exception 'recap: admins only';
  end if;
  if v_days is null then
    return 0;
  end if;
  update public.recap_settings set last_purge_at = now() where id = 1;
  return public.recap_purge(v_days);
end;
$$;

revoke all on function public.recap_purge_now() from public, anon;
grant execute on function public.recap_purge_now() to authenticated;

-- ------------------------------------------------------------------ uploads, now with the limits

-- recap_ingest: same as the analytics migration, plus the new-session check.
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
  v_new      boolean;
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

  -- Storage limits (recap_settings). Only checked when a session is new: once a session is
  -- accepted, the rest of it is always kept. A refused session returns 0, which the SDK treats as
  -- sent, so it isn't retried.
  v_new := not exists (select 1 from public.recap_sessions where id = v_session);
  if v_new then
    perform public.recap_auto_purge();
    if not public.recap_accept_new_session(v_session) then
      return 0;
    end if;
  end if;

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
    id, app_id, started_at, last_seen_at, user_id, anonymous_id, platform, os_version, device_model,
    app_version, locale, screen_width, screen_height, sdk_version,
    event_count, tap_count, screen_count, first_screen, last_screen
  ) values (
    v_session,
    v_app,
    coalesce((s ->> 'startedAt')::timestamptz, now()),
    coalesce(v_last_at, now()),
    left(s ->> 'userId', 200),
    left(s ->> 'anonymousId', 100),
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
    anonymous_id = coalesce(rs.anonymous_id, excluded.anonymous_id),
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

-- recap_frames: same as the recordings migration, plus the replay limits.
-- Called by the SDK with { appId, sessionId, frames: [{ t, image }] }. Returns how many were stored.
create or replace function public.recap_frames(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app     text := left(payload ->> 'appId', 100);
  v_session uuid;
  v_frames  jsonb := payload -> 'frames';
  v_have    integer;
  v_count   integer := 0;
  f         jsonb;
  v_image   text;
  v_max     integer;
  v_bytes   bigint := 0;
  v_n       integer;
begin
  begin
    v_session := (payload ->> 'sessionId')::uuid;
  exception when others then
    raise exception 'recap: sessionId must be a uuid';
  end;
  if v_app is null or v_app = '' or v_session is null then
    raise exception 'recap: appId and sessionId are required';
  end if;
  if jsonb_typeof(v_frames) is distinct from 'array' or jsonb_array_length(v_frames) > 20 then
    raise exception 'recap: frames must be an array of at most 20';
  end if;
  -- The session must already exist for this app (the SDK uploads it first).
  if not exists (select 1 from public.recap_sessions where id = v_session and app_id = v_app) then
    return 0;
  end if;
  -- Storage limits: replays for only a share of sessions, a frame cap, and a size cap.
  if not public.recap_in_sample('replay:' || v_session::text, public.recap_setting_num('replay_sample', 1)) then
    return 0;
  end if;
  if public.recap_over_size_cap() then
    return 0;
  end if;
  v_max := least(3600, coalesce(public.recap_setting_num('max_frames', 3600)::integer, 3600));
  select count(*) into v_have from public.recap_frames where session_id = v_session;

  for f in select * from jsonb_array_elements(v_frames) loop
    exit when v_have + v_count >= v_max;
    v_image := f ->> 'image';
    if v_image is not null then
      if v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
        raise exception 'recap: image must be a base64 data URL';
      end if;
      if length(v_image) > 250000 then
        continue; -- too big for a replay frame; skip it rather than fail the batch
      end if;
    end if;
    insert into public.recap_frames (session_id, app_id, t_ms, image)
    values (v_session, v_app, greatest(0, least(86400000, coalesce(round((f ->> 't')::numeric)::integer, 0))), v_image)
    on conflict (session_id, t_ms) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_bytes := v_bytes + coalesce(octet_length(v_image), 0); end if;
    v_count := v_count + 1;
  end loop;
  if v_bytes > 0 then
    update public.recap_sessions set replay_bytes = replay_bytes + v_bytes where id = v_session;
  end if;
  return v_count;
end;
$$;

revoke all on function public.recap_frames(jsonb) from public;
grant execute on function public.recap_frames(jsonb) to anon, authenticated;

-- ================================================================================================
-- 20261127040000_recap_dom_limits.sql
-- ================================================================================================

-- Storage limits for web page recordings: run after 20261127025000_recap_dom.sql and
-- 20261127030000_recap_storage_limits.sql. Safe to run again.
--
-- Web recordings (recap_dom) now follow the same settings as app replays: replay_sample decides which
-- sessions keep a recording, max_db_mb stops new recordings when Recap is full, and their size counts
-- towards Recap's total on the Storage page.

-- Size of each stored chunk, so totals can be added up without reading the recordings themselves.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'recap_dom' and column_name = 'bytes') then
    alter table public.recap_dom add column bytes integer not null default 0;
    update public.recap_dom set bytes = octet_length(events::text);
  end if;
end $$;

-- Recap's estimated size now includes web recordings.
create or replace function public.recap_data_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum(replay_bytes) from public.recap_sessions), 0)
    + coalesce((select sum(bytes) from public.recap_dom), 0)
    + greatest(0, (select reltuples from pg_class where oid = 'public.recap_events'::regclass))::bigint * 300
    + (select count(*) from public.recap_sessions) * 500
    + pg_total_relation_size('public.recap_screenshots')
  )::bigint
$$;

revoke all on function public.recap_data_bytes() from public, anon, authenticated;

-- The Storage page's numbers, with web recordings listed separately.
create or replace function public.recap_storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.recap_is_member() then
    raise exception 'recap: members only';
  end if;
  return jsonb_build_object(
    'databaseBytes',    pg_database_size(current_database()),
    'recapBytes',       public.recap_data_bytes(),
    'sessionsBytes',    pg_total_relation_size('public.recap_sessions'),
    'eventsBytes',      pg_total_relation_size('public.recap_events'),
    'framesBytes',      pg_total_relation_size('public.recap_frames'),
    'webReplayBytes',   coalesce((select sum(bytes) from public.recap_dom), 0),
    'screenshotsBytes', pg_total_relation_size('public.recap_screenshots'),
    'sessions',         (select count(*) from public.recap_sessions),
    'sessionsToday',    (select count(*) from public.recap_sessions where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    'sessionsWithReplay', (select count(*) from (select session_id from public.recap_frames union select session_id from public.recap_dom) r),
    'oldestSession',    (select min(started_at) from public.recap_sessions)
  );
end;
$$;

revoke all on function public.recap_storage_usage() from public, anon;
grant execute on function public.recap_storage_usage() to authenticated;

-- recap_dom: same as the web recordings migration, plus the replay limits.
-- Called by the web SDK with { appId, sessionId, t, events: [rrweb events] }. Returns how many were stored.
create or replace function public.recap_dom(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app     text := left(payload ->> 'appId', 100);
  v_session uuid;
  v_events  jsonb := payload -> 'events';
  v_chunks  integer;
  v_bytes   integer;
begin
  begin
    v_session := (payload ->> 'sessionId')::uuid;
  exception when others then
    raise exception 'recap: sessionId must be a uuid';
  end;
  if v_app is null or v_app = '' or v_session is null then
    raise exception 'recap: appId and sessionId are required';
  end if;
  if jsonb_typeof(v_events) is distinct from 'array' or jsonb_array_length(v_events) = 0 then
    return 0;
  end if;
  if jsonb_array_length(v_events) > 5000 then
    raise exception 'recap: at most 5000 recording events per chunk';
  end if;
  v_bytes := octet_length(v_events::text);
  if v_bytes > 3000000 then
    raise exception 'recap: recording chunk too large (keep it under about 3 MB)';
  end if;
  -- The session must already exist for this app (the SDK uploads it first).
  if not exists (select 1 from public.recap_sessions where id = v_session and app_id = v_app) then
    return 0;
  end if;
  -- Storage limits: recordings for only a share of sessions, and nothing new once Recap is full.
  if not public.recap_in_sample('replay:' || v_session::text, public.recap_setting_num('replay_sample', 1)) then
    return 0;
  end if;
  if public.recap_over_size_cap() then
    return 0;
  end if;
  select count(*) into v_chunks from public.recap_dom where session_id = v_session;
  if v_chunks >= 2000 then
    return 0; -- a very long session: stop storing more of it
  end if;

  insert into public.recap_dom (session_id, app_id, t_ms, events, bytes)
  values (
    v_session,
    v_app,
    greatest(0, least(86400000, coalesce(round((payload ->> 't')::numeric)::integer, 0))),
    v_events,
    v_bytes
  );
  return jsonb_array_length(v_events);
end;
$$;

revoke all on function public.recap_dom(jsonb) from public;
grant execute on function public.recap_dom(jsonb) to anon, authenticated;

-- ================================================================================================
-- 20261128000000_recap_recording_limits.sql
-- ================================================================================================

-- Recording limits: record every visit, and stop recordings before they fill Recap up, while visits
-- keep being counted. Run after the earlier Recap migrations. Safe to run again.
--
--   max_replay_mb        Once all recordings together (app replays and web page recordings) reach this
--                        size, new visits aren't recorded. A visit already being recorded carries on
--                        to its own limit. Visits are still counted until max_db_mb. Null is no limit.
--                        Starts at three quarters of max_db_mb (300 of 400 MB).
--   max_visit_replay_mb  Most recording kept for one visit, in MB. Default 10. The rest of the visit
--                        is still counted.
--
-- Also adds recap_sessions.dom_bytes (web recording size, kept up to date by recap_dom) and
-- recap_sessions.has_recording, so the Sessions list can mark recorded visits and put them first.

-- ------------------------------------------------------------------ settings

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'recap_settings' and column_name = 'max_replay_mb') then
    alter table public.recap_settings add column max_replay_mb integer check (max_replay_mb is null or max_replay_mb >= 1);
    update public.recap_settings set max_replay_mb = greatest(1, max_db_mb * 3 / 4) where id = 1 and max_db_mb is not null;
  end if;
end $$;

alter table public.recap_settings
  add column if not exists max_visit_replay_mb integer not null default 10 check (max_visit_replay_mb between 1 and 500);

-- ------------------------------------------------------------------ which sessions have a recording

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'recap_sessions' and column_name = 'dom_bytes') then
    alter table public.recap_sessions add column dom_bytes bigint not null default 0;
    update public.recap_sessions s set dom_bytes = d.b
    from (select session_id, sum(bytes) b from public.recap_dom group by session_id) d
    where d.session_id = s.id;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'recap_sessions' and column_name = 'has_recording') then
    alter table public.recap_sessions
      add column has_recording boolean generated always as (replay_bytes > 0 or dom_bytes > 0) stored;
  end if;
end $$;

create index if not exists recap_sessions_app_recording_idx
  on public.recap_sessions (app_id, has_recording, started_at desc);

-- ------------------------------------------------------------------ helpers (not callable by the app)

-- Bytes of all recordings: app replay pictures plus web page recordings.
create or replace function public.recap_replay_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(replay_bytes + dom_bytes), 0)::bigint from public.recap_sessions
$$;

-- May this visit store more recording? p_have is how much it has stored already.
create or replace function public.recap_recording_allowed(p_have bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- This visit's recording has reached its own limit.
    when p_have >= coalesce((select max_visit_replay_mb from public.recap_settings where id = 1), 10)::bigint * 1048576
      then false
    -- A visit already being recorded carries on to its own limit.
    when p_have > 0 then true
    -- Recordings together are at their limit: don't start new ones.
    else coalesce(
      public.recap_replay_bytes() < (select max_replay_mb from public.recap_settings where id = 1)::bigint * 1048576,
      true)
  end
$$;

revoke all on function public.recap_replay_bytes() from public, anon, authenticated;
revoke all on function public.recap_recording_allowed(bigint) from public, anon, authenticated;

-- ------------------------------------------------------------------ Storage page numbers

create or replace function public.recap_storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.recap_is_member() then
    raise exception 'recap: members only';
  end if;
  return jsonb_build_object(
    'databaseBytes',    pg_database_size(current_database()),
    'recapBytes',       public.recap_data_bytes(),
    'recordingsBytes',  public.recap_replay_bytes(),
    'sessionsBytes',    pg_total_relation_size('public.recap_sessions'),
    'eventsBytes',      pg_total_relation_size('public.recap_events'),
    'framesBytes',      pg_total_relation_size('public.recap_frames'),
    'webReplayBytes',   coalesce((select sum(dom_bytes) from public.recap_sessions), 0),
    'screenshotsBytes', pg_total_relation_size('public.recap_screenshots'),
    'sessions',         (select count(*) from public.recap_sessions),
    'sessionsToday',    (select count(*) from public.recap_sessions where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
    'sessionsWithReplay', (select count(*) from public.recap_sessions where has_recording),
    'oldestSession',    (select min(started_at) from public.recap_sessions)
  );
end;
$$;

revoke all on function public.recap_storage_usage() from public, anon;
grant execute on function public.recap_storage_usage() to authenticated;

-- ------------------------------------------------------------------ uploads, now with the recording limits

-- recap_dom: same as the web recording limits migration, plus the recording limits.
-- Called by the web SDK with { appId, sessionId, t, events: [rrweb events] }. Returns how many were stored.
create or replace function public.recap_dom(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app     text := left(payload ->> 'appId', 100);
  v_session uuid;
  v_events  jsonb := payload -> 'events';
  v_chunks  integer;
  v_bytes   integer;
  v_have    bigint;
begin
  begin
    v_session := (payload ->> 'sessionId')::uuid;
  exception when others then
    raise exception 'recap: sessionId must be a uuid';
  end;
  if v_app is null or v_app = '' or v_session is null then
    raise exception 'recap: appId and sessionId are required';
  end if;
  if jsonb_typeof(v_events) is distinct from 'array' or jsonb_array_length(v_events) = 0 then
    return 0;
  end if;
  if jsonb_array_length(v_events) > 5000 then
    raise exception 'recap: at most 5000 recording events per chunk';
  end if;
  v_bytes := octet_length(v_events::text);
  if v_bytes > 3000000 then
    raise exception 'recap: recording chunk too large (keep it under about 3 MB)';
  end if;
  -- The session must already exist for this app (the SDK uploads it first).
  select dom_bytes into v_have from public.recap_sessions where id = v_session and app_id = v_app;
  if not found then
    return 0;
  end if;
  -- Storage limits: recordings for only a share of sessions, nothing new once Recap is full, and the
  -- recording limits (per visit, and for all recordings together).
  if not public.recap_in_sample('replay:' || v_session::text, public.recap_setting_num('replay_sample', 1)) then
    return 0;
  end if;
  if public.recap_over_size_cap() then
    return 0;
  end if;
  if not public.recap_recording_allowed(v_have) then
    return 0;
  end if;
  select count(*) into v_chunks from public.recap_dom where session_id = v_session;
  if v_chunks >= 2000 then
    return 0; -- a very long session: stop storing more of it
  end if;

  insert into public.recap_dom (session_id, app_id, t_ms, events, bytes)
  values (
    v_session,
    v_app,
    greatest(0, least(86400000, coalesce(round((payload ->> 't')::numeric)::integer, 0))),
    v_events,
    v_bytes
  );
  update public.recap_sessions set dom_bytes = dom_bytes + v_bytes where id = v_session;
  return jsonb_array_length(v_events);
end;
$$;

revoke all on function public.recap_dom(jsonb) from public;
grant execute on function public.recap_dom(jsonb) to anon, authenticated;

-- recap_frames: same as the storage limits migration, plus the recording limits.
-- Called by the SDK with { appId, sessionId, frames: [{ t, image }] }. Returns how many were stored.
create or replace function public.recap_frames(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app       text := left(payload ->> 'appId', 100);
  v_session   uuid;
  v_frames    jsonb := payload -> 'frames';
  v_have      integer;
  v_count     integer := 0;
  f           jsonb;
  v_image     text;
  v_max       integer;
  v_bytes     bigint := 0;
  v_had_bytes bigint;
  v_visit_cap bigint;
  v_n         integer;
begin
  begin
    v_session := (payload ->> 'sessionId')::uuid;
  exception when others then
    raise exception 'recap: sessionId must be a uuid';
  end;
  if v_app is null or v_app = '' or v_session is null then
    raise exception 'recap: appId and sessionId are required';
  end if;
  if jsonb_typeof(v_frames) is distinct from 'array' or jsonb_array_length(v_frames) > 20 then
    raise exception 'recap: frames must be an array of at most 20';
  end if;
  -- The session must already exist for this app (the SDK uploads it first).
  select replay_bytes into v_had_bytes from public.recap_sessions where id = v_session and app_id = v_app;
  if not found then
    return 0;
  end if;
  -- Storage limits: replays for only a share of sessions, a frame cap, a size cap and the recording limits.
  if not public.recap_in_sample('replay:' || v_session::text, public.recap_setting_num('replay_sample', 1)) then
    return 0;
  end if;
  if public.recap_over_size_cap() then
    return 0;
  end if;
  if not public.recap_recording_allowed(v_had_bytes) then
    return 0;
  end if;
  v_max := least(3600, coalesce(public.recap_setting_num('max_frames', 3600)::integer, 3600));
  v_visit_cap := public.recap_setting_num('max_visit_replay_mb', 10)::bigint * 1048576;
  select count(*) into v_have from public.recap_frames where session_id = v_session;

  for f in select * from jsonb_array_elements(v_frames) loop
    exit when v_have + v_count >= v_max;
    exit when v_had_bytes + v_bytes >= v_visit_cap;
    v_image := f ->> 'image';
    if v_image is not null then
      if v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
        raise exception 'recap: image must be a base64 data URL';
      end if;
      if length(v_image) > 250000 then
        continue; -- too big for a replay frame; skip it rather than fail the batch
      end if;
    end if;
    insert into public.recap_frames (session_id, app_id, t_ms, image)
    values (v_session, v_app, greatest(0, least(86400000, coalesce(round((f ->> 't')::numeric)::integer, 0))), v_image)
    on conflict (session_id, t_ms) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_bytes := v_bytes + coalesce(octet_length(v_image), 0); end if;
    v_count := v_count + 1;
  end loop;
  if v_bytes > 0 then
    update public.recap_sessions set replay_bytes = replay_bytes + v_bytes where id = v_session;
  end if;
  return v_count;
end;
$$;

revoke all on function public.recap_frames(jsonb) from public;
grant execute on function public.recap_frames(jsonb) to anon, authenticated;

-- ================================================================================================
-- 20261128010000_recap_hardening.sql
-- ================================================================================================

-- Recap hardening, from the security review of 28 Nov 2026. Run after the earlier Recap migrations.
-- Safe to run again.
--
-- Anyone holding the public key can call the upload functions, so their limits are what keep a
-- project from filling up. This migration:
--   1. Counts real bytes for events (recap_sessions.event_bytes) and checks the size limit on every
--      upload, not only a session's first, so max_db_mb really holds. One session is capped at 20,000
--      events and 5 MB of them, and custom event properties over 8 KB are dropped.
--   2. Screen pictures stop once Recap is full, or once they take 50 MB.
--   3. Dashboard access needs a confirmed email, so listing someone's address before they sign up can't
--      be used by someone else signing up with it.
--   4. Keeps times sane (a session dated in the future would never be cleaned up) and cleans up old data
--      in batches, so a clean-up can't time out an upload.
--   5. Checks access once per query instead of once per row.
--   6. One visit's recording limit covers app frames and web recordings together, with a lock so
--      parallel uploads can't overshoot it.
--   7. Forgetting a user can be limited to one app, and includes the same device's anonymous sessions.
--   8. Members: one row per email whatever its case, an @ in every email, and the last admin stays.
--   9. Signed-in users lose table rights the dashboard never uses.

-- ------------------------------------------------------------------ 1. real event sizes

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'recap_sessions' and column_name = 'event_bytes') then
    alter table public.recap_sessions add column event_bytes bigint not null default 0;
    update public.recap_sessions s set event_bytes = e.b
    from (select session_id, sum(octet_length(data::text) + 150) b from public.recap_events group by session_id) e
    where e.session_id = s.id;
  end if;
end $$;

-- Estimated bytes of Recap data, from counters kept on each session (no table scans of events or
-- recordings), plus the heatmap pictures table.
create or replace function public.recap_data_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum(replay_bytes + dom_bytes + event_bytes) + count(*) * 500 from public.recap_sessions), 0)
    + pg_total_relation_size('public.recap_screenshots')
  )::bigint
$$;

revoke all on function public.recap_data_bytes() from public, anon, authenticated;

-- A time from the client, kept within 30 days back and an hour ahead. Unreadable times become now.
create or replace function public.recap_clamp_time(p text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  t timestamptz;
begin
  begin
    t := p::timestamptz;
  exception when others then
    return now();
  end;
  if t is null then
    return now();
  end if;
  return least(now() + interval '1 hour', greatest(now() - interval '30 days', t));
end;
$$;

revoke all on function public.recap_clamp_time(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ 4. clean-up in batches

drop function if exists public.recap_purge(integer);

-- Deletes sessions older than p_days, at most p_limit of them (null: all). Returns how many.
create or replace function public.recap_purge(p_days integer default 90, p_limit integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.recap_sessions
  where id in (
    select id from public.recap_sessions
    where started_at < now() - make_interval(days => p_days)
    order by started_at
    limit p_limit
  );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.recap_purge(integer, integer) from public, anon, authenticated;

-- Called when new sessions arrive: deletes up to 500 old sessions, about once an hour, and carries on
-- with the next batch on the next new session until none are left. Skips if another upload is already
-- cleaning up.
create or replace function public.recap_auto_purge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  n      integer;
begin
  select keep_days into v_days from public.recap_settings
  where id = 1 and keep_days is not null and (last_purge_at is null or last_purge_at < now() - interval '1 hour')
  for update skip locked;
  if v_days is null then
    return;
  end if;
  n := public.recap_purge(v_days, 500);
  if n < 500 then
    update public.recap_settings set last_purge_at = now() where id = 1;
  end if;
end;
$$;

revoke all on function public.recap_auto_purge() from public, anon, authenticated;

-- "Delete old data now" on the Storage page: everything older than keep_days. Admins only.
create or replace function public.recap_purge_now()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := (select keep_days from public.recap_settings where id = 1);
begin
  if public.recap_role() is distinct from 'admin' then
    raise exception 'recap: admins only';
  end if;
  if v_days is null then
    return 0;
  end if;
  update public.recap_settings set last_purge_at = now() where id = 1;
  return public.recap_purge(v_days, null);
end;
$$;

revoke all on function public.recap_purge_now() from public, anon;
grant execute on function public.recap_purge_now() to authenticated;

-- ------------------------------------------------------------------ 1, 4. uploads of events

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
  v_kept     integer;
  v_bytes    bigint;
  v_taps     integer;
  v_screens  integer;
  v_last_at  timestamptz;
  v_first    text;
  v_last     text;
  v_have_n   integer;
  v_have_b   bigint;
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

  -- Storage limits (recap_settings). A refused batch returns 0, which the SDK treats as sent, so it
  -- isn't retried. New sessions go through the sampling, daily and size checks; every later batch is
  -- checked against the size limit and the per-session caps.
  select event_count, event_bytes into v_have_n, v_have_b from public.recap_sessions where id = v_session;
  if not found then
    perform public.recap_auto_purge();
    if not public.recap_accept_new_session(v_session) then
      return 0;
    end if;
  else
    if public.recap_over_size_cap() then
      return 0;
    end if;
    if v_have_n >= 20000 or v_have_b >= 5 * 1048576 then
      return 0; -- a very long or very large session: stop storing more of it
    end if;
  end if;

  select
    count(*) filter (where e ->> 'type' in ('screen', 'tap', 'scroll', 'app_state', 'custom')),
    count(*) filter (where e ->> 'type' = 'tap'),
    count(*) filter (where e ->> 'type' = 'screen'),
    max(public.recap_clamp_time(e ->> 'at')),
    coalesce(sum(60 + octet_length(coalesce(left(e ->> 'screen', 200), ''))
                    + least(octet_length(coalesce(e -> 'data', '{}'::jsonb)::text), 8192))
             filter (where e ->> 'type' in ('screen', 'tap', 'scroll', 'app_state', 'custom')), 0)
  into v_kept, v_taps, v_screens, v_last_at, v_bytes
  from jsonb_array_elements(v_events) e;

  select left(e ->> 'screen', 200) into v_first
  from jsonb_array_elements(v_events) with ordinality as x(e, i)
  where e ->> 'screen' is not null order by i limit 1;

  select left(e ->> 'screen', 200) into v_last
  from jsonb_array_elements(v_events) with ordinality as x(e, i)
  where e ->> 'screen' is not null order by i desc limit 1;

  insert into public.recap_sessions as rs (
    id, app_id, started_at, last_seen_at, user_id, anonymous_id, platform, os_version, device_model,
    app_version, locale, screen_width, screen_height, sdk_version,
    event_count, tap_count, screen_count, first_screen, last_screen, event_bytes
  ) values (
    v_session,
    v_app,
    public.recap_clamp_time(s ->> 'startedAt'),
    coalesce(v_last_at, now()),
    left(s ->> 'userId', 200),
    left(s ->> 'anonymousId', 100),
    left(d ->> 'platform', 20),
    left(d ->> 'osVersion', 50),
    left(d ->> 'model', 100),
    left(d ->> 'appVersion', 50),
    left(d ->> 'locale', 20),
    least(100000, greatest(0, nullif(d ->> 'screenWidth', '')::numeric))::integer,
    least(100000, greatest(0, nullif(d ->> 'screenHeight', '')::numeric))::integer,
    left(payload ->> 'sdkVersion', 20),
    v_kept, v_taps, v_screens, v_first, v_last, v_bytes
  )
  on conflict (id) do update set
    last_seen_at = greatest(rs.last_seen_at, excluded.last_seen_at),
    user_id      = coalesce(excluded.user_id, rs.user_id),
    anonymous_id = coalesce(rs.anonymous_id, excluded.anonymous_id),
    event_count  = rs.event_count + excluded.event_count,
    event_bytes  = rs.event_bytes + excluded.event_bytes,
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
    greatest(0, least(2147483647, coalesce((e ->> 't')::numeric, 0)))::integer,
    public.recap_clamp_time(e ->> 'at'),
    left(e ->> 'screen', 200),
    case
      when octet_length(coalesce(e -> 'data', '{}'::jsonb)::text) > 8192 then '{"dropped": "properties over 8 KB"}'::jsonb
      when jsonb_typeof(e -> 'data') = 'object' then e -> 'data'
      else '{}'::jsonb
    end
  from jsonb_array_elements(v_events) e
  where e ->> 'type' in ('screen', 'tap', 'scroll', 'app_state', 'custom');

  return v_count;
end;
$$;

revoke all on function public.recap_ingest(jsonb) from public;
grant execute on function public.recap_ingest(jsonb) to anon, authenticated;

-- ------------------------------------------------------------------ 2. screen pictures

create or replace function public.recap_screenshot(payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app    text := left(payload ->> 'appId', 100);
  v_screen text := left(payload ->> 'screen', 200);
  v_image  text := payload ->> 'image';
begin
  if v_app is null or v_app = '' or v_screen is null or v_screen = '' then
    raise exception 'recap: appId and screen are required';
  end if;
  if v_image is null or length(v_image) > 700000 then
    raise exception 'recap: image missing or too large (keep it under about 500 KB)';
  end if;
  if v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
    raise exception 'recap: image must be a base64 data URL';
  end if;
  -- Storage limits: nothing once Recap is full, and pictures never take more than 50 MB.
  if public.recap_over_size_cap() or pg_total_relation_size('public.recap_screenshots') > 50 * 1048576 then
    return false;
  end if;

  insert into public.recap_screenshots as rs (app_id, screen, platform, app_version, width, height, image, captured_at)
  values (
    v_app,
    v_screen,
    coalesce(left(payload ->> 'platform', 20), ''),
    coalesce(left(payload ->> 'appVersion', 50), ''),
    least(10000, greatest(0, coalesce((payload ->> 'width')::numeric, 0)))::integer,
    least(10000, greatest(0, coalesce((payload ->> 'height')::numeric, 0)))::integer,
    v_image,
    now()
  )
  on conflict (app_id, screen, platform, app_version) do update set
    width = excluded.width, height = excluded.height, image = excluded.image, captured_at = excluded.captured_at;
  return true;
end;
$$;

revoke all on function public.recap_screenshot(jsonb) from public;
grant execute on function public.recap_screenshot(jsonb) to anon, authenticated;

-- ------------------------------------------------------------------ 3. confirmed emails only

-- The member row for the signed-in user, only when their email is confirmed in Supabase Auth.
create or replace function public.recap_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.recap_members m
  join auth.users u on lower(u.email) = lower(m.email)
  where u.id = coalesce(
          case when auth.jwt() ->> 'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then (auth.jwt() ->> 'sub')::uuid end,
          '00000000-0000-0000-0000-000000000000'::uuid)
    and u.email_confirmed_at is not null
    and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and m.email like '%_@_%'
  limit 1
$$;

-- ------------------------------------------------------------------ 5. access checked once per query

drop policy if exists recap_sessions_read on public.recap_sessions;
create policy recap_sessions_read on public.recap_sessions
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_sessions_delete on public.recap_sessions;
create policy recap_sessions_delete on public.recap_sessions
  for delete to authenticated using ((select public.recap_role()) = 'admin');

drop policy if exists recap_events_read on public.recap_events;
create policy recap_events_read on public.recap_events
  for select to authenticated using ((select public.recap_is_member()));

drop policy if exists recap_members_read on public.recap_members;
create policy recap_members_read on public.recap_members
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_members_admin on public.recap_members;
create policy recap_members_admin on public.recap_members
  for all to authenticated
  using ((select public.recap_role()) = 'admin')
  with check ((select public.recap_role()) = 'admin');

drop policy if exists recap_screenshots_read on public.recap_screenshots;
create policy recap_screenshots_read on public.recap_screenshots
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_screenshots_delete on public.recap_screenshots;
create policy recap_screenshots_delete on public.recap_screenshots
  for delete to authenticated using ((select public.recap_role()) = 'admin');

drop policy if exists recap_frames_read on public.recap_frames;
create policy recap_frames_read on public.recap_frames
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_frames_delete on public.recap_frames;
create policy recap_frames_delete on public.recap_frames
  for delete to authenticated using ((select public.recap_role()) = 'admin');

drop policy if exists recap_dom_read on public.recap_dom;
create policy recap_dom_read on public.recap_dom
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_dom_delete on public.recap_dom;
create policy recap_dom_delete on public.recap_dom
  for delete to authenticated using ((select public.recap_role()) = 'admin');

drop policy if exists recap_settings_read on public.recap_settings;
create policy recap_settings_read on public.recap_settings
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_settings_admin on public.recap_settings;
create policy recap_settings_admin on public.recap_settings
  for update to authenticated
  using ((select public.recap_role()) = 'admin')
  with check ((select public.recap_role()) = 'admin');

-- ------------------------------------------------------------------ 6. recordings: one limit per visit, locked

create or replace function public.recap_dom(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app     text := left(payload ->> 'appId', 100);
  v_session uuid;
  v_events  jsonb := payload -> 'events';
  v_chunks  integer;
  v_bytes   integer;
  v_have    bigint;
begin
  begin
    v_session := (payload ->> 'sessionId')::uuid;
  exception when others then
    raise exception 'recap: sessionId must be a uuid';
  end;
  if v_app is null or v_app = '' or v_session is null then
    raise exception 'recap: appId and sessionId are required';
  end if;
  if jsonb_typeof(v_events) is distinct from 'array' or jsonb_array_length(v_events) = 0 then
    return 0;
  end if;
  if jsonb_array_length(v_events) > 5000 then
    raise exception 'recap: at most 5000 recording events per chunk';
  end if;
  v_bytes := octet_length(v_events::text);
  if v_bytes > 3000000 then
    raise exception 'recap: recording chunk too large (keep it under about 3 MB)';
  end if;
  -- The session must already exist for this app (the SDK uploads it first). Locking its row makes
  -- parallel chunks of one visit take turns, so they can't all slip under its limit at once.
  select replay_bytes + dom_bytes into v_have from public.recap_sessions
  where id = v_session and app_id = v_app
  for update;
  if not found then
    return 0;
  end if;
  if not public.recap_in_sample('replay:' || v_session::text, public.recap_setting_num('replay_sample', 1)) then
    return 0;
  end if;
  if public.recap_over_size_cap() then
    return 0;
  end if;
  if not public.recap_recording_allowed(v_have) then
    return 0;
  end if;
  select count(*) into v_chunks from public.recap_dom where session_id = v_session;
  if v_chunks >= 2000 then
    return 0; -- a very long session: stop storing more of it
  end if;

  insert into public.recap_dom (session_id, app_id, t_ms, events, bytes)
  values (
    v_session,
    v_app,
    greatest(0, least(86400000, coalesce(round((payload ->> 't')::numeric)::integer, 0))),
    v_events,
    v_bytes
  );
  update public.recap_sessions set dom_bytes = dom_bytes + v_bytes where id = v_session;
  return jsonb_array_length(v_events);
end;
$$;

revoke all on function public.recap_dom(jsonb) from public;
grant execute on function public.recap_dom(jsonb) to anon, authenticated;

create or replace function public.recap_frames(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app       text := left(payload ->> 'appId', 100);
  v_session   uuid;
  v_frames    jsonb := payload -> 'frames';
  v_have      integer;
  v_count     integer := 0;
  f           jsonb;
  v_image     text;
  v_max       integer;
  v_bytes     bigint := 0;
  v_had_bytes bigint;
  v_visit_cap bigint;
  v_n         integer;
begin
  begin
    v_session := (payload ->> 'sessionId')::uuid;
  exception when others then
    raise exception 'recap: sessionId must be a uuid';
  end;
  if v_app is null or v_app = '' or v_session is null then
    raise exception 'recap: appId and sessionId are required';
  end if;
  if jsonb_typeof(v_frames) is distinct from 'array' or jsonb_array_length(v_frames) > 20 then
    raise exception 'recap: frames must be an array of at most 20';
  end if;
  if octet_length(payload::text) > 5100000 then
    raise exception 'recap: frames batch too large';
  end if;
  -- The session must already exist for this app. Locked, as in recap_dom.
  select replay_bytes + dom_bytes into v_had_bytes from public.recap_sessions
  where id = v_session and app_id = v_app
  for update;
  if not found then
    return 0;
  end if;
  if not public.recap_in_sample('replay:' || v_session::text, public.recap_setting_num('replay_sample', 1)) then
    return 0;
  end if;
  if public.recap_over_size_cap() then
    return 0;
  end if;
  if not public.recap_recording_allowed(v_had_bytes) then
    return 0;
  end if;
  v_max := least(3600, coalesce(public.recap_setting_num('max_frames', 3600)::integer, 3600));
  v_visit_cap := public.recap_setting_num('max_visit_replay_mb', 10)::bigint * 1048576;
  select count(*) into v_have from public.recap_frames where session_id = v_session;

  for f in select * from jsonb_array_elements(v_frames) loop
    exit when v_have + v_count >= v_max;
    exit when v_had_bytes + v_bytes >= v_visit_cap;
    v_image := f ->> 'image';
    if v_image is not null then
      if length(v_image) > 250000 then
        continue; -- too big for a replay frame; skip it rather than fail the batch
      end if;
      if v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
        raise exception 'recap: image must be a base64 data URL';
      end if;
    end if;
    insert into public.recap_frames (session_id, app_id, t_ms, image)
    values (v_session, v_app, greatest(0, least(86400000, coalesce(round((f ->> 't')::numeric)::integer, 0))), v_image)
    on conflict (session_id, t_ms) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_bytes := v_bytes + coalesce(octet_length(v_image), 0); end if;
    v_count := v_count + 1;
  end loop;
  if v_bytes > 0 then
    update public.recap_sessions set replay_bytes = replay_bytes + v_bytes where id = v_session;
  end if;
  return v_count;
end;
$$;

revoke all on function public.recap_frames(jsonb) from public;
grant execute on function public.recap_frames(jsonb) to anon, authenticated;

-- ------------------------------------------------------------------ 7. forgetting a user

drop function if exists public.recap_forget_user(text);

-- Remove every session of one of your users (for data deletion requests), in one app or all apps,
-- with the anonymous sessions from the same devices (the install's sessions before they signed in).
-- Admins only. Returns how many sessions were removed.
create or replace function public.recap_forget_user(p_user_id text, p_app text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if public.recap_role() is distinct from 'admin' then
    raise exception 'recap: admins only';
  end if;
  with mine as (
    select id, app_id, anonymous_id from public.recap_sessions
    where user_id = p_user_id and (p_app is null or app_id = p_app)
  )
  delete from public.recap_sessions s
  where s.id in (select id from mine)
     or (s.user_id is null and s.anonymous_id is not null
         and (s.app_id, s.anonymous_id) in (select app_id, anonymous_id from mine where anonymous_id is not null));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.recap_forget_user(text, text) from public, anon;
grant execute on function public.recap_forget_user(text, text) to authenticated;

-- ------------------------------------------------------------------ 8. members

do $$
begin
  begin
    create unique index if not exists recap_members_email_lower_idx on public.recap_members (lower(email));
  exception when unique_violation then
    raise notice 'recap: two members share an email in different case. Delete one, then run this file again.';
  end;
  if not exists (select 1 from pg_constraint where conname = 'recap_members_email_at') then
    alter table public.recap_members add constraint recap_members_email_at check (email like '%_@_%') not valid;
  end if;
end $$;

create or replace function public.recap_keep_an_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from public.recap_members where role = 'admin' and email <> old.email) then
    raise exception 'recap: keep at least one admin. Add another admin first.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.recap_keep_an_admin() from public, anon, authenticated;

drop trigger if exists recap_keep_an_admin on public.recap_members;
create trigger recap_keep_an_admin
  before delete or update on public.recap_members
  for each row execute function public.recap_keep_an_admin();

-- ------------------------------------------------------------------ 9. table rights the dashboard never uses

revoke truncate, references, trigger on
  public.recap_sessions, public.recap_events, public.recap_members, public.recap_frames,
  public.recap_dom, public.recap_screenshots, public.recap_settings
from anon, authenticated;
revoke insert, update on
  public.recap_sessions, public.recap_events, public.recap_frames, public.recap_dom, public.recap_screenshots
from authenticated;

-- ------------------------------------------------------------------ first-admin hint

-- Whether the team has an admin yet. The dashboard shows a signed-in non-member the SQL to make
-- themselves admin only while there is none, so the hint can't be used to talk a member into adding
-- an outsider.
create or replace function public.recap_has_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.recap_members where role = 'admin')
$$;

revoke all on function public.recap_has_admin() from public, anon;
grant execute on function public.recap_has_admin() to authenticated;

-- ================================================================================================
-- Done. This row confirms the setup (nothing here is required to run).
-- ================================================================================================

select
  'Recap is set up' as status,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'recap\_%') as tables_and_views,
  (select count(*) from public.recap_members where role = 'admin') as admins,
  case when (select count(*) from public.recap_members where role = 'admin') = 0
       then 'Next: add yourself as admin (see the top of this file)'
       else 'Admin found: sign in to the dashboard' end as next_step;
