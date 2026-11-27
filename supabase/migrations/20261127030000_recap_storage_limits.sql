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
