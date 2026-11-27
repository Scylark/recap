-- Checks for the storage limits migration. Run after recordings.sql on the same scratch database.
\set ON_ERROR_STOP 1

-- Helper: one small batch for a new session.
create or replace function pg_temp.batch(p_id text, p_app text default 'limits') returns jsonb language sql as $$
  select jsonb_build_object('appId', p_app, 'sdkVersion', 't', 'session',
    jsonb_build_object('id', p_id, 'startedAt', now()::text, 'device', jsonb_build_object('platform', 'web')),
    'events', jsonb_build_array(jsonb_build_object('type', 'screen', 't', 0, 'at', now()::text, 'screen', 'Home', 'data', '{}'::jsonb)))
$$;

-- 1. Defaults: keep 90 days, 400 MB cap, everything sampled in.
do $$ begin
  if (select keep_days from public.recap_settings) <> 90 or (select max_db_mb from public.recap_settings) <> 400 then
    raise exception 'FAIL: unexpected defaults';
  end if;
end $$;

-- 2. Viewers can read the settings but not change them; strangers see nothing; admins can change them.
set role authenticated;
set request.jwt.claims = '{"email":"stranger@example.com"}';
do $$ begin
  if (select count(*) from public.recap_settings) <> 0 then raise exception 'FAIL: stranger saw settings'; end if;
end $$;
set request.jwt.claims = '{"email":"team@example.com"}';
do $$ begin
  if (select count(*) from public.recap_settings) <> 1 then raise exception 'FAIL: member cannot read settings'; end if;
  update public.recap_settings set session_sample = 0;
  if (select session_sample from public.recap_settings) <> 1 then raise exception 'FAIL: viewer changed settings'; end if;
  begin perform public.recap_purge_now(); raise exception 'FAIL: viewer purged';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  if (public.recap_storage_usage() ->> 'sessions')::int < 1 then raise exception 'FAIL: usage missing'; end if;
end $$;
set request.jwt.claims = '{"email":"owner@example.com"}';
do $$ begin
  begin
    update public.recap_settings set session_sample = 2;
    raise exception 'FAIL: sample above 1 accepted';
  exception when check_violation then null; end;
  update public.recap_settings set session_sample = 0, updated_by = 'owner@example.com';
  if (select session_sample from public.recap_settings) <> 0 then raise exception 'FAIL: admin could not change settings'; end if;
end $$;
reset role;

-- 3. The app can't read or change settings.
set role anon;
do $$ begin
  begin perform 1 from public.recap_settings; raise exception 'FAIL: anon read settings';
  exception when insufficient_privilege then null; end;
  begin perform public.recap_auto_purge(); raise exception 'FAIL: anon called purge';
  exception when insufficient_privilege then null; end;
end $$;

-- 4. Sample 0: new sessions are dropped quietly (return 0, no error), so the SDK doesn't retry.
do $$ begin
  if public.recap_ingest(pg_temp.batch('33333333-0000-4000-8000-000000000001')) <> 0 then
    raise exception 'FAIL: session kept with sample 0';
  end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.recap_sessions where id = '33333333-0000-4000-8000-000000000001') then
    raise exception 'FAIL: refused session stored';
  end if;
end $$;

-- 5. Daily cap: once today's count is reached, new sessions stop, but known sessions keep going.
update public.recap_settings set session_sample = 1, daily_sessions = (select count(*) from public.recap_sessions where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') + 1;
set role anon;
do $$ begin
  if public.recap_ingest(pg_temp.batch('33333333-0000-4000-8000-000000000002')) <> 1 then raise exception 'FAIL: session under cap refused'; end if;
  if public.recap_ingest(pg_temp.batch('33333333-0000-4000-8000-000000000003')) <> 0 then raise exception 'FAIL: session over cap kept'; end if;
  if public.recap_ingest(pg_temp.batch('33333333-0000-4000-8000-000000000002')) <> 1 then raise exception 'FAIL: known session refused'; end if;
end $$;
reset role;
update public.recap_settings set daily_sessions = null;

-- 6. Replays: frames are counted towards the size estimate, capped per session, and sampled.
update public.recap_settings set max_frames = 2;
set role anon;
do $$ declare before bigint; begin
  if public.recap_frames('{"appId":"limits","sessionId":"33333333-0000-4000-8000-000000000002","frames":[
      {"t":1,"image":"data:image/jpeg;base64,QUJDRA=="},{"t":2,"image":null},{"t":3,"image":"data:image/jpeg;base64,QUJD"}]}'::jsonb) <> 2 then
    raise exception 'FAIL: max_frames not applied';
  end if;
end $$;
reset role;
do $$ begin
  if (select replay_bytes from public.recap_sessions where id = '33333333-0000-4000-8000-000000000002') <> length('data:image/jpeg;base64,QUJDRA==') then
    raise exception 'FAIL: replay bytes not counted';
  end if;
end $$;
update public.recap_settings set max_frames = 600, replay_sample = 0;
set role anon;
do $$ begin
  if public.recap_frames('{"appId":"limits","sessionId":"33333333-0000-4000-8000-000000000002","frames":[{"t":9,"image":null}]}'::jsonb) <> 0 then
    raise exception 'FAIL: replay kept with replay_sample 0';
  end if;
end $$;
reset role;
update public.recap_settings set replay_sample = 1;

-- 7. Size cap: over the cap, new sessions and frames stop.
update public.recap_settings set max_db_mb = 50;
update public.recap_sessions set replay_bytes = 60 * 1024 * 1024 where id = '33333333-0000-4000-8000-000000000002';
set role anon;
do $$ begin
  if public.recap_ingest(pg_temp.batch('33333333-0000-4000-8000-000000000004')) <> 0 then raise exception 'FAIL: session kept over size cap'; end if;
  if public.recap_frames('{"appId":"limits","sessionId":"33333333-0000-4000-8000-000000000002","frames":[{"t":10,"image":null}]}'::jsonb) <> 0 then
    raise exception 'FAIL: frames kept over size cap';
  end if;
end $$;
reset role;
update public.recap_settings set max_db_mb = 400;
update public.recap_sessions set replay_bytes = 0 where id = '33333333-0000-4000-8000-000000000002';

-- 8. Retention: an old session is removed when a new session arrives (at most once an hour), and by
--    "Delete old data now".
insert into public.recap_sessions (id, app_id, started_at, last_seen_at) values
  ('33333333-0000-4000-8000-000000000005', 'limits', now() - interval '100 days', now() - interval '100 days');
update public.recap_settings set last_purge_at = null;
set role anon;
select public.recap_ingest(pg_temp.batch('33333333-0000-4000-8000-000000000006'));
reset role;
do $$ begin
  if exists (select 1 from public.recap_sessions where id = '33333333-0000-4000-8000-000000000005') then
    raise exception 'FAIL: old session not purged';
  end if;
end $$;
insert into public.recap_sessions (id, app_id, started_at, last_seen_at) values
  ('33333333-0000-4000-8000-000000000007', 'limits', now() - interval '100 days', now() - interval '100 days');
set role authenticated;
set request.jwt.claims = '{"email":"owner@example.com"}';
do $$ begin
  if public.recap_purge_now() <> 1 then raise exception 'FAIL: purge now did not remove the old session'; end if;
end $$;
reset role;

select 'storage limits: all checks passed' as result;
