-- Checks the hardening migration (security review, 28 Nov 2026). Run after recording-limits.sql.
\set ON_ERROR_STOP 1

update public.recap_settings
set replay_sample = 1, session_sample = 1, daily_sessions = null, max_db_mb = null, max_replay_mb = null, max_visit_replay_mb = 10;

-- A session to work with.
set role anon;
do $$ begin
  if public.recap_ingest('{"appId":"hard","session":{"id":"66666666-0000-4000-8000-000000000001","startedAt":"infinity",
      "device":{"platform":"web"}},"events":[{"type":"screen","t":0,"at":"not a time","screen":"/"},{"type":"bogus","t":1}]}'::jsonb) <> 2 then
    raise exception 'FAIL: first batch not accepted';
  end if;
end $$;
reset role;

-- 1. Times are kept sane, and only known event types are counted.
do $$
declare s record;
begin
  select * into s from public.recap_sessions where id = '66666666-0000-4000-8000-000000000001';
  if s.started_at > now() + interval '2 hours' then raise exception 'FAIL: startedAt "infinity" was not clamped'; end if;
  if s.event_count <> 1 then raise exception 'FAIL: event_count counted an unknown event type (%)', s.event_count; end if;
  if s.event_bytes <= 0 then raise exception 'FAIL: event_bytes not counted'; end if;
  if (select at from public.recap_events where session_id = s.id limit 1) > now() + interval '1 minute' then
    raise exception 'FAIL: an unreadable event time was not replaced with now';
  end if;
end $$;

-- 2. Custom event properties over 8 KB are dropped, and counted at the capped size.
set role anon;
do $$ begin
  perform public.recap_ingest(jsonb_build_object('appId', 'hard',
    'session', jsonb_build_object('id', '66666666-0000-4000-8000-000000000001'),
    'events', jsonb_build_array(jsonb_build_object('type', 'custom', 't', 5, 'screen', '/',
      'data', jsonb_build_object('name', 'big', 'blob', repeat('x', 20000))))));
end $$;
reset role;
do $$ begin
  if (select data ->> 'dropped' from public.recap_events
      where session_id = '66666666-0000-4000-8000-000000000001' and type = 'custom') is null then
    raise exception 'FAIL: oversized custom properties were stored';
  end if;
  if (select event_bytes from public.recap_sessions where id = '66666666-0000-4000-8000-000000000001') > 12000 then
    raise exception 'FAIL: oversized properties counted at full size';
  end if;
end $$;

-- 3. The size limit applies to every batch, not only a session's first.
update public.recap_settings set max_db_mb = 50;
update public.recap_sessions set replay_bytes = 60 * 1048576 where id = '66666666-0000-4000-8000-000000000001';
set role anon;
do $$ begin
  if public.recap_ingest('{"appId":"hard","session":{"id":"66666666-0000-4000-8000-000000000001"},
      "events":[{"type":"tap","t":9,"screen":"/"}]}'::jsonb) <> 0 then
    raise exception 'FAIL: a later batch was stored over the size limit';
  end if;
  -- 4. Screen pictures stop too.
  if public.recap_screenshot('{"appId":"hard","screen":"/","image":"data:image/jpeg;base64,AAAA"}'::jsonb) then
    raise exception 'FAIL: a screen picture was stored over the size limit';
  end if;
end $$;
reset role;
update public.recap_settings set max_db_mb = null;
update public.recap_sessions set replay_bytes = 0 where id = '66666666-0000-4000-8000-000000000001';

-- 5. One session is capped at 20,000 events.
update public.recap_sessions set event_count = 20000 where id = '66666666-0000-4000-8000-000000000001';
set role anon;
do $$ begin
  if public.recap_ingest('{"appId":"hard","session":{"id":"66666666-0000-4000-8000-000000000001"},
      "events":[{"type":"tap","t":9,"screen":"/"}]}'::jsonb) <> 0 then
    raise exception 'FAIL: a session past 20,000 events kept growing';
  end if;
end $$;
reset role;

-- 6. One visit's recording limit covers app frames and web recordings together.
update public.recap_sessions set replay_bytes = 10 * 1048576 where id = '66666666-0000-4000-8000-000000000001';
set role anon;
do $$ begin
  if public.recap_dom('{"appId":"hard","sessionId":"66666666-0000-4000-8000-000000000001","t":5,
      "events":[{"type":2,"timestamp":1,"data":{"node":{"id":1}}}]}'::jsonb) <> 0 then
    raise exception 'FAIL: web recording stored past the visit limit reached by app frames';
  end if;
end $$;
reset role;

-- 7. Dashboard access needs a confirmed email.
set role authenticated;
set request.jwt.claims = '{"email":"owner@example.com","email_unconfirmed":true}';
do $$ begin
  if public.recap_role() is not null then raise exception 'FAIL: an unconfirmed email got a role'; end if;
  if exists (select 1 from public.recap_sessions) then raise exception 'FAIL: an unconfirmed email can read sessions'; end if;
end $$;
set request.jwt.claims = '{"email":"owner@example.com"}';
do $$ begin
  if public.recap_role() is distinct from 'admin' then raise exception 'FAIL: a confirmed admin lost their role'; end if;
end $$;
reset role;

-- 8. Members: one row per email whatever the case, an @ in every email, and the last admin stays.
do $$ begin
  begin
    insert into public.recap_members (email, role) values ('OWNER@example.com', 'viewer');
    raise exception 'FAIL: the same email in another case was added twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.recap_members (email, role) values ('', 'viewer');
    raise exception 'FAIL: a blank email was added';
  exception when check_violation then null;
  end;
end $$;
do $$
declare v_admins integer := (select count(*) from public.recap_members where role = 'admin');
begin
  if v_admins = 1 then
    begin
      delete from public.recap_members where role = 'admin';
      raise exception 'FAIL: the last admin was removed';
    exception when raise_exception then
      if sqlerrm like 'FAIL%' then raise; end if;
    end;
  end if;
  insert into public.recap_members (email, role) values ('second-admin@example.com', 'admin');
  delete from public.recap_members where email = 'second-admin@example.com';
end $$;

-- 9. Forgetting a user: one app only, with the same device's anonymous sessions, not other users'.
insert into public.recap_sessions (id, app_id, started_at, last_seen_at, user_id, anonymous_id) values
  ('66666666-0000-4000-8000-0000000000a1', 'forget-a', now(), now(), 'u1', 'dev-x'),
  ('66666666-0000-4000-8000-0000000000a2', 'forget-a', now(), now(), null, 'dev-x'),
  ('66666666-0000-4000-8000-0000000000a3', 'forget-a', now(), now(), 'u2', 'dev-x'),
  ('66666666-0000-4000-8000-0000000000b1', 'forget-b', now(), now(), 'u1', 'dev-x');
set role authenticated;
set request.jwt.claims = '{"email":"owner@example.com"}';
do $$ begin
  if public.recap_forget_user('u1', 'forget-a') <> 2 then raise exception 'FAIL: forget_user should remove 2 sessions'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.recap_sessions where id in ('66666666-0000-4000-8000-0000000000a1', '66666666-0000-4000-8000-0000000000a2')) then
    raise exception 'FAIL: forget_user left the user''s or the device''s anonymous session';
  end if;
  if (select count(*) from public.recap_sessions where id in ('66666666-0000-4000-8000-0000000000a3', '66666666-0000-4000-8000-0000000000b1')) <> 2 then
    raise exception 'FAIL: forget_user removed another user''s session or another app''s';
  end if;
end $$;

-- 10. Clean-up in batches.
insert into public.recap_sessions (id, app_id, started_at, last_seen_at) values
  ('66666666-0000-4000-8000-0000000000c1', 'old', now() - interval '400 days', now() - interval '400 days'),
  ('66666666-0000-4000-8000-0000000000c2', 'old', now() - interval '401 days', now() - interval '401 days');
do $$ begin
  if public.recap_purge(365, 1) <> 1 then raise exception 'FAIL: recap_purge did not stop at its batch size'; end if;
  if public.recap_purge(365) <> 1 then raise exception 'FAIL: recap_purge did not delete the rest'; end if;
end $$;

-- 11. Signed-in users can't truncate, or write sessions directly.
set role authenticated;
set request.jwt.claims = '{"email":"owner@example.com"}';
do $$ begin
  begin
    truncate public.recap_events;
    raise exception 'FAIL: a signed-in user could truncate events';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.recap_sessions (id, app_id) values (gen_random_uuid(), 'x');
    raise exception 'FAIL: a signed-in user could insert a session';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

delete from public.recap_sessions where app_id in ('hard', 'forget-a', 'forget-b', 'old');
update public.recap_settings set max_db_mb = 400, max_replay_mb = 300, max_visit_replay_mb = 10;
select 'hardening: all checks passed' as result;
