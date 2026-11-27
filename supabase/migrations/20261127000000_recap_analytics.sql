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
  order by count(*) desc, name
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
    select kv.*, row_number() over (partition by kv.key order by kv.n desc, kv.value) as r from kv
  )
  select key, value, n from ranked where r <= 10 order by key, n desc, value
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
    select seg from ev group by seg order by count(*) desc, seg limit 6
  )
  select bucket,
         case when seg in (select seg from top) then seg else 'Other' end as segment,
         case when p_measure = 'uniques' then count(distinct distinct_id) else count(*) end as value
  from ev
  group by 1, 2
  order by 1, 2
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
  order by 2 desc, 1
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
    select seg from f where step = 1 group by seg order by count(*) desc, seg limit 6
  )
  select f.step,
         case when f.seg in (select seg from top) then f.seg else 'Other' end,
         count(*),
         case when f.step = 1 then null else avg(extract(epoch from f.t - f.prev))::double precision end
  from f
  group by 1, 2
  order by 1, 2
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
