-- Checks for the recordings migration. Run after analytics-and-screens.sql on the same scratch database.
\set ON_ERROR_STOP 1

-- 1. The app (anon) sends frames for a session that exists, and for one that doesn't.
set role anon;
do $$ begin
  if public.recap_frames('{"appId":"shop","sessionId":"22222222-2222-4222-8222-222222222221","frames":[
      {"t":1000,"image":"data:image/jpeg;base64,QUJD"},
      {"t":2000.4,"image":null},
      {"t":3000,"image":"data:image/jpeg;base64,REVG"}]}'::jsonb) <> 3 then
    raise exception 'FAIL: frames not stored';
  end if;
  -- Unknown session, or a session from another app: ignored.
  if public.recap_frames('{"appId":"shop","sessionId":"99999999-2222-4222-8222-222222222221","frames":[{"t":1,"image":null}]}'::jsonb) <> 0 then
    raise exception 'FAIL: frames for unknown session stored';
  end if;
  if public.recap_frames('{"appId":"other","sessionId":"22222222-2222-4222-8222-222222222221","frames":[{"t":1,"image":null}]}'::jsonb) <> 0 then
    raise exception 'FAIL: frames stored against another app';
  end if;
  -- Not a picture: refused.
  begin
    perform public.recap_frames('{"appId":"shop","sessionId":"22222222-2222-4222-8222-222222222221","frames":[{"t":5,"image":"<svg onload=alert(1)>"}]}'::jsonb);
    raise exception 'FAIL: non-image frame accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- Anon can't read frames back.
  begin perform 1 from public.recap_frames; raise exception 'FAIL: anon read frames';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 2. Strangers see nothing; members see the frames in order; viewers can't delete them.
set role authenticated;
set request.jwt.claims = '{"email":"stranger@example.com"}';
do $$ begin
  if (select count(*) from public.recap_frames) <> 0 then raise exception 'FAIL: stranger saw frames'; end if;
end $$;
set request.jwt.claims = '{"email":"team@example.com"}';
do $$ begin
  if (select string_agg(t_ms || ':' || coalesce(left(image, 10), 'hidden'), ',' order by t_ms) from public.recap_frames)
     <> '1000:data:image,2000:hidden,3000:data:image' then
    raise exception 'FAIL: frames %', (select json_agg(t_ms order by t_ms) from public.recap_frames);
  end if;
  delete from public.recap_frames;
  if (select count(*) from public.recap_frames) <> 3 then raise exception 'FAIL: viewer deleted frames'; end if;
end $$;
reset role;

-- 3. Deleting the session deletes its frames.
delete from public.recap_sessions where id = '22222222-2222-4222-8222-222222222221';
do $$ begin
  if (select count(*) from public.recap_frames) <> 0 then raise exception 'FAIL: frames outlived their session'; end if;
end $$;

select 'ALL RECORDING CHECKS PASSED' as result;
