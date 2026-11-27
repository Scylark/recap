-- Checks that web page recordings follow the storage limits. Run after storage-limits.sql.
\set ON_ERROR_STOP 1

update public.recap_settings set replay_sample = 1, max_db_mb = null, session_sample = 1, daily_sessions = null;
insert into public.recap_sessions (id, app_id, started_at, last_seen_at, platform) values
  ('44444444-0000-4000-8000-000000000001', 'web-limits', now(), now(), 'web');

-- 1. Within the limits, a chunk is stored and counted towards Recap's size.
set role anon;
do $$ begin
  if public.recap_dom('{"appId":"web-limits","sessionId":"44444444-0000-4000-8000-000000000001","t":5,
      "events":[{"type":2,"timestamp":1,"data":{"node":{"id":1}}}]}'::jsonb) <> 1 then
    raise exception 'FAIL: chunk not stored within limits';
  end if;
end $$;
reset role;
do $$ begin
  if (select bytes from public.recap_dom where session_id = '44444444-0000-4000-8000-000000000001') <= 0 then
    raise exception 'FAIL: chunk size not recorded';
  end if;
end $$;
set role authenticated;
set request.jwt.claims = '{"email":"team@example.com"}';
do $$ begin
  if (public.recap_storage_usage() ->> 'webReplayBytes')::bigint <= 0 then
    raise exception 'FAIL: web recordings missing from storage usage';
  end if;
end $$;
reset role;

-- 2. replay_sample = 0: no new recordings.
update public.recap_settings set replay_sample = 0;
set role anon;
do $$ begin
  if public.recap_dom('{"appId":"web-limits","sessionId":"44444444-0000-4000-8000-000000000001","t":9,
      "events":[{"type":3,"timestamp":2}]}'::jsonb) <> 0 then
    raise exception 'FAIL: recording stored with replay_sample 0';
  end if;
end $$;
reset role;

-- 3. Over the size cap: no new recordings.
update public.recap_settings set replay_sample = 1, max_db_mb = 50;
update public.recap_sessions set replay_bytes = 60 * 1024 * 1024 where id = '44444444-0000-4000-8000-000000000001';
set role anon;
do $$ begin
  if public.recap_dom('{"appId":"web-limits","sessionId":"44444444-0000-4000-8000-000000000001","t":9,
      "events":[{"type":3,"timestamp":2}]}'::jsonb) <> 0 then
    raise exception 'FAIL: recording stored over the size cap';
  end if;
end $$;
reset role;

delete from public.recap_sessions where id = '44444444-0000-4000-8000-000000000001';
update public.recap_settings set max_db_mb = 400;
select 'web recording limits: all checks passed' as result;
