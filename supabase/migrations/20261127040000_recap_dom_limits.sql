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
