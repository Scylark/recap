-- Checks for the web page recordings migration (recap_dom). Run after recordings.sql on the same scratch database.
\set ON_ERROR_STOP 1

-- A web session to record against.
set role anon;
select public.recap_ingest('{
  "appId": "web-shop", "sdkVersion": "web-0.1.0",
  "session": { "id": "33333333-3333-4333-8333-333333333331", "startedAt": "2026-11-27T10:00:00Z",
               "device": { "platform": "web", "model": "Chrome", "screenWidth": 1280, "screenHeight": 800 } },
  "events": [ { "type": "screen", "t": 0, "at": "2026-11-27T10:00:00Z", "screen": "/", "data": {} } ] }'::jsonb);

-- 1. The site (anon) sends recording chunks for a session that exists, and not for one that doesn't.
do $$ begin
  if public.recap_dom('{"appId":"web-shop","sessionId":"33333333-3333-4333-8333-333333333331","t":10,
      "events":[{"type":4,"timestamp":1,"data":{"width":1280,"height":800}},{"type":2,"timestamp":2,"data":{"node":{}}}]}'::jsonb) <> 2 then
    raise exception 'FAIL: chunk not stored';
  end if;
  if public.recap_dom('{"appId":"web-shop","sessionId":"33333333-3333-4333-8333-333333333331","t":900,
      "events":[{"type":3,"timestamp":3,"data":{"source":3}}]}'::jsonb) <> 1 then
    raise exception 'FAIL: second chunk not stored';
  end if;
  -- Unknown session, or a session from another app: ignored.
  if public.recap_dom('{"appId":"web-shop","sessionId":"99999999-3333-4333-8333-333333333331","events":[{"type":3}]}'::jsonb) <> 0 then
    raise exception 'FAIL: chunk for unknown session stored';
  end if;
  if public.recap_dom('{"appId":"other","sessionId":"33333333-3333-4333-8333-333333333331","events":[{"type":3}]}'::jsonb) <> 0 then
    raise exception 'FAIL: chunk stored against another app';
  end if;
  -- Not an array: nothing stored.
  if public.recap_dom('{"appId":"web-shop","sessionId":"33333333-3333-4333-8333-333333333331","events":"nope"}'::jsonb) <> 0 then
    raise exception 'FAIL: non-array chunk stored';
  end if;
  -- Bad session id: refused.
  begin
    perform public.recap_dom('{"appId":"web-shop","sessionId":"not-a-uuid","events":[{"type":3}]}'::jsonb);
    raise exception 'FAIL: bad session id accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- Anon can't read recordings back.
  begin perform 1 from public.recap_dom; raise exception 'FAIL: anon read recordings';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 2. Strangers see nothing; members see the chunks in order; viewers can't delete them.
set role authenticated;
set request.jwt.claims = '{"email":"stranger@example.com"}';
do $$ begin
  if (select count(*) from public.recap_dom) <> 0 then raise exception 'FAIL: stranger saw recordings'; end if;
end $$;
set request.jwt.claims = '{"email":"team@example.com"}';
do $$ begin
  if (select string_agg(t_ms || ':' || jsonb_array_length(events), ',' order by t_ms) from public.recap_dom) <> '10:2,900:1' then
    raise exception 'FAIL: chunks %', (select json_agg(t_ms order by t_ms) from public.recap_dom);
  end if;
  delete from public.recap_dom;
  if (select count(*) from public.recap_dom) <> 2 then raise exception 'FAIL: viewer deleted recordings'; end if;
end $$;
reset role;

-- 3. Deleting the session deletes its recording.
delete from public.recap_sessions where id = '33333333-3333-4333-8333-333333333331';
do $$ begin
  if (select count(*) from public.recap_dom) <> 0 then raise exception 'FAIL: recording outlived its session'; end if;
end $$;

select 'ALL WEB RECORDING CHECKS PASSED' as result;
