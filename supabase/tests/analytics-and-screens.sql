-- Checks for the analytics and screenshot migrations. Run after security.sql on the same scratch database:
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/supabase-shim.sql -f supabase/migrations/<each file in order> \
--        -f supabase/tests/security.sql -f supabase/tests/analytics-and-screens.sql
\set ON_ERROR_STOP 1

-- 1. The app (anon) sends two sessions from one install, plus a screen picture.
set role anon;
select public.recap_ingest('{
  "appId": "shop", "sdkVersion": "0.2.0",
  "session": { "id": "22222222-2222-4222-8222-222222222221", "startedAt": "2026-11-20T09:00:00Z", "anonymousId": "install-1",
               "device": { "platform": "android" } },
  "events": [
    { "type": "screen", "t": 0, "at": "2026-11-20T09:00:00Z", "screen": "Home", "data": {} },
    { "type": "tap", "t": 900, "at": "2026-11-20T09:00:01Z", "screen": "Home", "data": { "nx": 0.5, "ny": 0.9, "label": "Buy" } },
    { "type": "custom", "t": 950, "at": "2026-11-20T09:00:01Z", "screen": "Home", "data": { "name": "order_completed", "value": 12 } },
    { "type": "tap", "t": 990, "at": "2026-11-20T09:00:02Z", "screen": "Home", "data": { "nx": 0.1, "ny": 0.1 } }
  ] }'::jsonb);
select public.recap_ingest('{
  "appId": "shop", "session": { "id": "22222222-2222-4222-8222-222222222222", "startedAt": "2026-11-21T09:00:00Z", "anonymousId": "install-1",
               "device": { "platform": "android" } },
  "events": [ { "type": "screen", "t": 0, "at": "2026-11-21T09:00:00Z", "screen": "Home", "data": {} } ] }'::jsonb);
select public.recap_screenshot('{"appId":"shop","screen":"Home","platform":"android","appVersion":"1.0","width":400,"height":800,
  "image":"data:image/jpeg;base64,QUJD"}'::jsonb);
-- A second picture of the same screen replaces the first.
select public.recap_screenshot('{"appId":"shop","screen":"Home","platform":"android","appVersion":"1.0","width":400,"height":800,
  "image":"data:image/jpeg;base64,REVG"}'::jsonb);

-- 2. Anon cannot read pictures or analytics, and can't store anything that isn't an image.
do $$ begin
  begin perform 1 from public.recap_screenshots; raise exception 'FAIL: anon read screenshots';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.recap_analytics_events; raise exception 'FAIL: anon read analytics view';
  exception when insufficient_privilege then null; end;
  begin perform public.recap_trend('shop', '2026-01-01'); raise exception 'FAIL: anon ran trend';
  exception when insufficient_privilege then null; end;
  begin
    perform public.recap_screenshot('{"appId":"shop","screen":"Home","image":"<script>alert(1)</script>"}'::jsonb);
    raise exception 'FAIL: non-image accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;

-- 3. Strangers see nothing; members see analytics built from both sessions as one user.
set role authenticated;
set request.jwt.claims = '{"email":"stranger@example.com"}';
do $$ begin
  if (select count(*) from public.recap_screenshots) <> 0 then raise exception 'FAIL: stranger saw screenshots'; end if;
  if (select count(*) from public.recap_event_names('shop', '2026-01-01', '2027-01-01')) <> 0 then raise exception 'FAIL: stranger saw events'; end if;
end $$;
set request.jwt.claims = '{"email":"team@example.com"}';
do $$ declare n record; begin
  if (select image from public.recap_screenshots where app_id = 'shop' and screen = 'Home') <> 'data:image/jpeg;base64,REVG' then
    raise exception 'FAIL: screenshot not replaced';
  end if;
  -- Named events: unlabelled taps are left out.
  if (select string_agg(name || ':' || events || ':' || users, ',' order by name)
      from public.recap_event_names('shop', '2026-01-01', '2027-01-01'))
     <> 'Session started:2:1,Tapped Buy:1:1,Viewed Home:2:1,order_completed:1:1' then
    raise exception 'FAIL: event names %', (select json_agg(x) from public.recap_event_names('shop', '2026-01-01', '2027-01-01') x);
  end if;
  -- One install came back the next day.
  if (select string_agg(period || ':' || users, ',' order by period)
      from public.recap_retention('shop', '2026-11-01', '2026-12-01', 'day')) <> '0:1,1:1' then
    raise exception 'FAIL: retention';
  end if;
  if (select string_agg(step || ':' || users, ',' order by step)
      from public.recap_funnel('shop', '2026-11-01', '2026-12-01', array['Viewed Home', 'Tapped Buy', 'order_completed'])) <> '1:1,2:1,3:1' then
    raise exception 'FAIL: funnel';
  end if;
  if (select value from public.recap_event_properties('shop', '2026-11-01', '2026-12-01', 'order_completed') where key = 'value') <> '12' then
    raise exception 'FAIL: properties';
  end if;
  -- Viewers can't delete pictures.
  delete from public.recap_screenshots;
  if (select count(*) from public.recap_screenshots) <> 1 then raise exception 'FAIL: viewer deleted screenshot'; end if;
end $$;
reset role;

select 'ALL ANALYTICS AND SCREENSHOT CHECKS PASSED' as result;
