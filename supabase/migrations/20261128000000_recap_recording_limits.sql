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
