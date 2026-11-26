-- Security and ingestion checks for the Recap migration.
-- Run against a scratch database:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supabase-shim.sql \
--        -f supabase/migrations/20261126000000_recap.sql -f supabase/tests/security.sql
\set ON_ERROR_STOP 1

insert into public.recap_members (email, role) values ('owner@example.com', 'admin'), ('team@example.com', 'viewer')
  on conflict do nothing;

-- 1. The app (anon) can ingest a batch.
set role anon;
select public.recap_ingest('{
  "appId": "demo", "sdkVersion": "0.1.0",
  "session": { "id": "11111111-1111-4111-8111-111111111111", "startedAt": "2026-11-26T10:00:00Z", "userId": null,
               "device": { "platform": "ios", "osVersion": "18.1", "screenWidth": 393, "screenHeight": 852 } },
  "events": [
    { "type": "screen", "t": 0, "at": "2026-11-26T10:00:00Z", "screen": "Home", "data": { "from": null } },
    { "type": "tap", "t": 1200, "at": "2026-11-26T10:00:01Z", "screen": "Home", "data": { "x": 196, "y": 700, "nx": 0.5, "ny": 0.82, "label": "Shop now" } },
    { "type": "screen", "t": 1500, "at": "2026-11-26T10:00:01Z", "screen": "Shop", "data": { "from": "Home" } }
  ] }'::jsonb) as ingested;
-- A second batch for the same session updates the counters.
select public.recap_ingest('{
  "appId": "demo", "session": { "id": "11111111-1111-4111-8111-111111111111", "startedAt": "2026-11-26T10:00:00Z", "device": {} },
  "events": [ { "type": "tap", "t": 3000, "at": "2026-11-26T10:00:03Z", "screen": "Shop", "data": { "x": 10, "y": 10 } } ] }'::jsonb);

-- 2. The app (anon) cannot read anything.
do $$ begin
  begin perform 1 from public.recap_sessions; raise exception 'FAIL: anon read sessions';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.recap_events; raise exception 'FAIL: anon read events';
  exception when insufficient_privilege then null; end;
end $$;

-- 3. Another app cannot write into this session.
do $$ begin
  perform public.recap_ingest('{"appId":"other","session":{"id":"11111111-1111-4111-8111-111111111111","device":{}},
    "events":[{"type":"tap","t":1,"at":"2026-11-26T10:00:05Z","screen":"x","data":{}}]}'::jsonb);
  raise exception 'FAIL: cross-app write allowed';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
reset role;

-- 4. A signed-in stranger sees nothing; a member sees the session.
set role authenticated;
set request.jwt.claims = '{"email":"stranger@example.com"}';
do $$ begin
  if (select count(*) from public.recap_sessions) <> 0 then raise exception 'FAIL: stranger can read'; end if;
end $$;
set request.jwt.claims = '{"email":"Team@Example.com"}';
do $$ declare r record; begin
  select * into r from public.recap_sessions where id = '11111111-1111-4111-8111-111111111111';
  if r.event_count <> 4 or r.tap_count <> 2 or r.screen_count <> 2 then
    raise exception 'FAIL: counters wrong %', row_to_json(r);
  end if;
  if r.first_screen <> 'Home' or r.last_screen <> 'Shop' then raise exception 'FAIL: screens wrong'; end if;
  if (select count(*) from public.recap_events) <> 4 then raise exception 'FAIL: member cannot read events'; end if;
  if (select count(*) from public.recap_screen_stats('demo', '2026-01-01')) <> 2 then raise exception 'FAIL: screen stats'; end if;
end $$;
-- Viewers cannot delete or add members.
do $$ begin
  delete from public.recap_sessions;
  if (select count(*) from public.recap_sessions) <> 1 then raise exception 'FAIL: viewer deleted'; end if;
  begin
    insert into public.recap_members (email) values ('x@example.com');
    raise exception 'FAIL: viewer added member';
  exception when insufficient_privilege then null; end;
end $$;
-- Admins can.
set request.jwt.claims = '{"email":"owner@example.com"}';
insert into public.recap_members (email) values ('new@example.com');
do $$ begin
  if public.recap_forget_user('nobody') <> 0 then raise exception 'FAIL: forget'; end if;
end $$;
reset role;

-- 5. Retention purge.
do $$ begin
  if public.recap_purge(0) <> 1 then raise exception 'FAIL: purge'; end if;
  if (select count(*) from public.recap_events) <> 0 then raise exception 'FAIL: cascade'; end if;
end $$;

select 'ALL RECAP DATABASE CHECKS PASSED' as result;
