-- Checks the recording limits: each visit's recording stops at max_visit_replay_mb, new recordings stop
-- once all recordings reach max_replay_mb (visits already recording carry on), visits are still
-- counted, and has_recording marks recorded sessions. Run after dom-limits.sql.
\set ON_ERROR_STOP 1

-- 0. Defaults: an install with the 400 MB limit gets 300 MB for recordings and 10 MB per visit.
do $$ begin
  if (select max_replay_mb from public.recap_settings where id = 1) is distinct from 300 then
    raise exception 'FAIL: max_replay_mb should start at 300 for a 400 MB limit, got %',
      (select max_replay_mb from public.recap_settings where id = 1);
  end if;
  if (select max_visit_replay_mb from public.recap_settings where id = 1) is distinct from 10 then
    raise exception 'FAIL: max_visit_replay_mb should start at 10';
  end if;
end $$;

update public.recap_settings
set replay_sample = 1, session_sample = 1, daily_sessions = null, max_db_mb = null,
    max_replay_mb = 300, max_visit_replay_mb = 10;
insert into public.recap_sessions (id, app_id, started_at, last_seen_at, platform) values
  ('55555555-0000-4000-8000-000000000001', 'rec-limits', now(), now(), 'web'),
  ('55555555-0000-4000-8000-000000000002', 'rec-limits', now(), now(), 'web'),
  ('55555555-0000-4000-8000-000000000003', 'rec-limits', now(), now(), 'ios');

-- 1. A web chunk is stored, counted on the session and marks it as recorded.
set role anon;
do $$ begin
  if public.recap_dom('{"appId":"rec-limits","sessionId":"55555555-0000-4000-8000-000000000001","t":5,
      "events":[{"type":2,"timestamp":1,"data":{"node":{"id":1}}}]}'::jsonb) <> 1 then
    raise exception 'FAIL: web chunk not stored within the recording limits';
  end if;
end $$;
reset role;
do $$ begin
  if (select dom_bytes from public.recap_sessions where id = '55555555-0000-4000-8000-000000000001') <= 0 then
    raise exception 'FAIL: dom_bytes not counted';
  end if;
  if not (select has_recording from public.recap_sessions where id = '55555555-0000-4000-8000-000000000001') then
    raise exception 'FAIL: has_recording not set for a recorded web visit';
  end if;
  if (select has_recording from public.recap_sessions where id = '55555555-0000-4000-8000-000000000002') then
    raise exception 'FAIL: has_recording set for a visit with no recording';
  end if;
end $$;
set role authenticated;
set request.jwt.claims = '{"email":"team@example.com"}';
do $$ begin
  if (public.recap_storage_usage() ->> 'recordingsBytes')::bigint <= 0 then
    raise exception 'FAIL: recordingsBytes missing from storage usage';
  end if;
  if (public.recap_storage_usage() ->> 'sessionsWithReplay')::integer < 1 then
    raise exception 'FAIL: sessionsWithReplay should count the recorded visit';
  end if;
end $$;
reset role;

-- 2. One visit at its own limit: no more of it is stored.
update public.recap_sessions set dom_bytes = 10 * 1024 * 1024 where id = '55555555-0000-4000-8000-000000000001';
set role anon;
do $$ begin
  if public.recap_dom('{"appId":"rec-limits","sessionId":"55555555-0000-4000-8000-000000000001","t":9,
      "events":[{"type":3,"timestamp":2}]}'::jsonb) <> 0 then
    raise exception 'FAIL: web chunk stored past the per-visit limit';
  end if;
end $$;
reset role;

-- 3. Raising the per-visit limit lets it carry on.
update public.recap_settings set max_visit_replay_mb = 20;
set role anon;
do $$ begin
  if public.recap_dom('{"appId":"rec-limits","sessionId":"55555555-0000-4000-8000-000000000001","t":9,
      "events":[{"type":3,"timestamp":2}]}'::jsonb) <> 1 then
    raise exception 'FAIL: web chunk refused under a raised per-visit limit';
  end if;
end $$;
reset role;

-- 4. All recordings at their limit: a new visit isn't recorded, a visit already recording carries on,
--    and visits are still counted.
update public.recap_settings set max_replay_mb = 5;
set role anon;
do $$ begin
  if public.recap_dom('{"appId":"rec-limits","sessionId":"55555555-0000-4000-8000-000000000002","t":5,
      "events":[{"type":2,"timestamp":1,"data":{"node":{"id":1}}}]}'::jsonb) <> 0 then
    raise exception 'FAIL: new web recording started over the recordings limit';
  end if;
  if public.recap_dom('{"appId":"rec-limits","sessionId":"55555555-0000-4000-8000-000000000001","t":12,
      "events":[{"type":3,"timestamp":3}]}'::jsonb) <> 1 then
    raise exception 'FAIL: a visit already recording was stopped by the recordings limit';
  end if;
  if public.recap_frames('{"appId":"rec-limits","sessionId":"55555555-0000-4000-8000-000000000003",
      "frames":[{"t":1000,"image":"data:image/jpeg;base64,AAAA"}]}'::jsonb) <> 0 then
    raise exception 'FAIL: new app recording started over the recordings limit';
  end if;
  if public.recap_ingest('{"appId":"rec-limits","session":{"id":"55555555-0000-4000-8000-000000000009","device":{"platform":"web"}},
      "events":[{"type":"screen","t":0,"screen":"/"}]}'::jsonb) <> 1 then
    raise exception 'FAIL: a new visit was not counted while recordings are at their limit';
  end if;
end $$;
reset role;

-- 5. No recordings limit: new recordings start again. App frames stop at the per-visit limit.
update public.recap_settings set max_replay_mb = null, max_visit_replay_mb = 1;
set role anon;
do $$ begin
  if public.recap_frames('{"appId":"rec-limits","sessionId":"55555555-0000-4000-8000-000000000003",
      "frames":[{"t":1000,"image":"data:image/jpeg;base64,AAAA"}]}'::jsonb) <> 1 then
    raise exception 'FAIL: app frame refused with no recordings limit';
  end if;
end $$;
reset role;
do $$ begin
  if not (select has_recording from public.recap_sessions where id = '55555555-0000-4000-8000-000000000003') then
    raise exception 'FAIL: has_recording not set for a recorded app session';
  end if;
end $$;
update public.recap_sessions set replay_bytes = 1024 * 1024 where id = '55555555-0000-4000-8000-000000000003';
set role anon;
do $$ begin
  if public.recap_frames('{"appId":"rec-limits","sessionId":"55555555-0000-4000-8000-000000000003",
      "frames":[{"t":2000,"image":"data:image/jpeg;base64,BBBB"}]}'::jsonb) <> 0 then
    raise exception 'FAIL: app frame stored past the per-visit limit';
  end if;
end $$;
reset role;

-- 6. The app can't call the helpers.
set role anon;
do $$ begin
  begin
    perform public.recap_replay_bytes();
    raise exception 'FAIL: anon can call recap_replay_bytes';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

delete from public.recap_sessions where app_id = 'rec-limits';
update public.recap_settings set max_db_mb = 400, max_replay_mb = 300, max_visit_replay_mb = 10;
select 'recording limits: all checks passed' as result;
