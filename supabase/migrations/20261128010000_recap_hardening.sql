-- Recap hardening, from the security review of 28 Nov 2026. Run after the earlier Recap migrations.
-- Safe to run again.
--
-- Anyone holding the public key can call the upload functions, so their limits are what keep a
-- project from filling up. This migration:
--   1. Counts real bytes for events (recap_sessions.event_bytes) and checks the size limit on every
--      upload, not only a session's first, so max_db_mb really holds. One session is capped at 20,000
--      events and 5 MB of them, and custom event properties over 8 KB are dropped.
--   2. Screen pictures stop once Recap is full, or once they take 50 MB.
--   3. Dashboard access needs a confirmed email, so listing someone's address before they sign up can't
--      be used by someone else signing up with it.
--   4. Keeps times sane (a session dated in the future would never be cleaned up) and cleans up old data
--      in batches, so a clean-up can't time out an upload.
--   5. Checks access once per query instead of once per row.
--   6. One visit's recording limit covers app frames and web recordings together, with a lock so
--      parallel uploads can't overshoot it.
--   7. Forgetting a user can be limited to one app, and includes the same device's anonymous sessions.
--   8. Members: one row per email whatever its case, an @ in every email, and the last admin stays.
--   9. Signed-in users lose table rights the dashboard never uses.

-- ------------------------------------------------------------------ 1. real event sizes

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'recap_sessions' and column_name = 'event_bytes') then
    alter table public.recap_sessions add column event_bytes bigint not null default 0;
    update public.recap_sessions s set event_bytes = e.b
    from (select session_id, sum(octet_length(data::text) + 150) b from public.recap_events group by session_id) e
    where e.session_id = s.id;
  end if;
end $$;

-- Estimated bytes of Recap data, from counters kept on each session (no table scans of events or
-- recordings), plus the heatmap pictures table.
create or replace function public.recap_data_bytes()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum(replay_bytes + dom_bytes + event_bytes) + count(*) * 500 from public.recap_sessions), 0)
    + pg_total_relation_size('public.recap_screenshots')
  )::bigint
$$;

revoke all on function public.recap_data_bytes() from public, anon, authenticated;

-- A time from the client, kept within 30 days back and an hour ahead. Unreadable times become now.
create or replace function public.recap_clamp_time(p text)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  t timestamptz;
begin
  begin
    t := p::timestamptz;
  exception when others then
    return now();
  end;
  if t is null then
    return now();
  end if;
  return least(now() + interval '1 hour', greatest(now() - interval '30 days', t));
end;
$$;

revoke all on function public.recap_clamp_time(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ 4. clean-up in batches

drop function if exists public.recap_purge(integer);

-- Deletes sessions older than p_days, at most p_limit of them (null: all). Returns how many.
create or replace function public.recap_purge(p_days integer default 90, p_limit integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.recap_sessions
  where id in (
    select id from public.recap_sessions
    where started_at < now() - make_interval(days => p_days)
    order by started_at
    limit p_limit
  );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.recap_purge(integer, integer) from public, anon, authenticated;

-- Called when new sessions arrive: deletes up to 500 old sessions, about once an hour, and carries on
-- with the next batch on the next new session until none are left. Skips if another upload is already
-- cleaning up.
create or replace function public.recap_auto_purge()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  n      integer;
begin
  select keep_days into v_days from public.recap_settings
  where id = 1 and keep_days is not null and (last_purge_at is null or last_purge_at < now() - interval '1 hour')
  for update skip locked;
  if v_days is null then
    return;
  end if;
  n := public.recap_purge(v_days, 500);
  if n < 500 then
    update public.recap_settings set last_purge_at = now() where id = 1;
  end if;
end;
$$;

revoke all on function public.recap_auto_purge() from public, anon, authenticated;

-- "Delete old data now" on the Storage page: everything older than keep_days. Admins only.
create or replace function public.recap_purge_now()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := (select keep_days from public.recap_settings where id = 1);
begin
  if public.recap_role() is distinct from 'admin' then
    raise exception 'recap: admins only';
  end if;
  if v_days is null then
    return 0;
  end if;
  update public.recap_settings set last_purge_at = now() where id = 1;
  return public.recap_purge(v_days, null);
end;
$$;

revoke all on function public.recap_purge_now() from public, anon;
grant execute on function public.recap_purge_now() to authenticated;

-- ------------------------------------------------------------------ 1, 4. uploads of events

create or replace function public.recap_ingest(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s          jsonb := payload -> 'session';
  d          jsonb := coalesce(payload -> 'session' -> 'device', '{}'::jsonb);
  v_app      text  := left(payload ->> 'appId', 100);
  v_session  uuid;
  v_events   jsonb := coalesce(payload -> 'events', '[]'::jsonb);
  v_count    integer;
  v_kept     integer;
  v_bytes    bigint;
  v_taps     integer;
  v_screens  integer;
  v_last_at  timestamptz;
  v_first    text;
  v_last     text;
  v_have_n   integer;
  v_have_b   bigint;
begin
  if v_app is null or v_app = '' then
    raise exception 'recap: appId is required';
  end if;
  if jsonb_typeof(v_events) <> 'array' then
    raise exception 'recap: events must be an array';
  end if;
  v_count := jsonb_array_length(v_events);
  if v_count = 0 then
    return 0;
  end if;
  if v_count > 500 then
    raise exception 'recap: at most 500 events per batch';
  end if;
  if octet_length(payload::text) > 512000 then
    raise exception 'recap: batch too large';
  end if;

  begin
    v_session := (s ->> 'id')::uuid;
  exception when others then
    raise exception 'recap: session.id must be a uuid';
  end;

  -- Storage limits (recap_settings). A refused batch returns 0, which the SDK treats as sent, so it
  -- isn't retried. New sessions go through the sampling, daily and size checks; every later batch is
  -- checked against the size limit and the per-session caps.
  select event_count, event_bytes into v_have_n, v_have_b from public.recap_sessions where id = v_session;
  if not found then
    perform public.recap_auto_purge();
    if not public.recap_accept_new_session(v_session) then
      return 0;
    end if;
  else
    if public.recap_over_size_cap() then
      return 0;
    end if;
    if v_have_n >= 20000 or v_have_b >= 5 * 1048576 then
      return 0; -- a very long or very large session: stop storing more of it
    end if;
  end if;

  select
    count(*) filter (where e ->> 'type' in ('screen', 'tap', 'scroll', 'app_state', 'custom')),
    count(*) filter (where e ->> 'type' = 'tap'),
    count(*) filter (where e ->> 'type' = 'screen'),
    max(public.recap_clamp_time(e ->> 'at')),
    coalesce(sum(60 + octet_length(coalesce(left(e ->> 'screen', 200), ''))
                    + least(octet_length(coalesce(e -> 'data', '{}'::jsonb)::text), 8192))
             filter (where e ->> 'type' in ('screen', 'tap', 'scroll', 'app_state', 'custom')), 0)
  into v_kept, v_taps, v_screens, v_last_at, v_bytes
  from jsonb_array_elements(v_events) e;

  select left(e ->> 'screen', 200) into v_first
  from jsonb_array_elements(v_events) with ordinality as x(e, i)
  where e ->> 'screen' is not null order by i limit 1;

  select left(e ->> 'screen', 200) into v_last
  from jsonb_array_elements(v_events) with ordinality as x(e, i)
  where e ->> 'screen' is not null order by i desc limit 1;

  insert into public.recap_sessions as rs (
    id, app_id, started_at, last_seen_at, user_id, anonymous_id, platform, os_version, device_model,
    app_version, locale, screen_width, screen_height, sdk_version,
    event_count, tap_count, screen_count, first_screen, last_screen, event_bytes
  ) values (
    v_session,
    v_app,
    public.recap_clamp_time(s ->> 'startedAt'),
    coalesce(v_last_at, now()),
    left(s ->> 'userId', 200),
    left(s ->> 'anonymousId', 100),
    left(d ->> 'platform', 20),
    left(d ->> 'osVersion', 50),
    left(d ->> 'model', 100),
    left(d ->> 'appVersion', 50),
    left(d ->> 'locale', 20),
    least(100000, greatest(0, nullif(d ->> 'screenWidth', '')::numeric))::integer,
    least(100000, greatest(0, nullif(d ->> 'screenHeight', '')::numeric))::integer,
    left(payload ->> 'sdkVersion', 20),
    v_kept, v_taps, v_screens, v_first, v_last, v_bytes
  )
  on conflict (id) do update set
    last_seen_at = greatest(rs.last_seen_at, excluded.last_seen_at),
    user_id      = coalesce(excluded.user_id, rs.user_id),
    anonymous_id = coalesce(rs.anonymous_id, excluded.anonymous_id),
    event_count  = rs.event_count + excluded.event_count,
    event_bytes  = rs.event_bytes + excluded.event_bytes,
    tap_count    = rs.tap_count + excluded.tap_count,
    screen_count = rs.screen_count + excluded.screen_count,
    first_screen = coalesce(rs.first_screen, excluded.first_screen),
    last_screen  = coalesce(excluded.last_screen, rs.last_screen)
  where rs.app_id = excluded.app_id;

  if not exists (select 1 from public.recap_sessions where id = v_session and app_id = v_app) then
    raise exception 'recap: session belongs to a different app';
  end if;

  insert into public.recap_events (session_id, app_id, type, t_ms, at, screen, data)
  select
    v_session,
    v_app,
    e ->> 'type',
    greatest(0, least(2147483647, coalesce((e ->> 't')::numeric, 0)))::integer,
    public.recap_clamp_time(e ->> 'at'),
    left(e ->> 'screen', 200),
    case
      when octet_length(coalesce(e -> 'data', '{}'::jsonb)::text) > 8192 then '{"dropped": "properties over 8 KB"}'::jsonb
      when jsonb_typeof(e -> 'data') = 'object' then e -> 'data'
      else '{}'::jsonb
    end
  from jsonb_array_elements(v_events) e
  where e ->> 'type' in ('screen', 'tap', 'scroll', 'app_state', 'custom');

  return v_count;
end;
$$;

revoke all on function public.recap_ingest(jsonb) from public;
grant execute on function public.recap_ingest(jsonb) to anon, authenticated;

-- ------------------------------------------------------------------ 2. screen pictures

create or replace function public.recap_screenshot(payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app    text := left(payload ->> 'appId', 100);
  v_screen text := left(payload ->> 'screen', 200);
  v_image  text := payload ->> 'image';
begin
  if v_app is null or v_app = '' or v_screen is null or v_screen = '' then
    raise exception 'recap: appId and screen are required';
  end if;
  if v_image is null or length(v_image) > 700000 then
    raise exception 'recap: image missing or too large (keep it under about 500 KB)';
  end if;
  if v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
    raise exception 'recap: image must be a base64 data URL';
  end if;
  -- Storage limits: nothing once Recap is full, and pictures never take more than 50 MB.
  if public.recap_over_size_cap() or pg_total_relation_size('public.recap_screenshots') > 50 * 1048576 then
    return false;
  end if;

  insert into public.recap_screenshots as rs (app_id, screen, platform, app_version, width, height, image, captured_at)
  values (
    v_app,
    v_screen,
    coalesce(left(payload ->> 'platform', 20), ''),
    coalesce(left(payload ->> 'appVersion', 50), ''),
    least(10000, greatest(0, coalesce((payload ->> 'width')::numeric, 0)))::integer,
    least(10000, greatest(0, coalesce((payload ->> 'height')::numeric, 0)))::integer,
    v_image,
    now()
  )
  on conflict (app_id, screen, platform, app_version) do update set
    width = excluded.width, height = excluded.height, image = excluded.image, captured_at = excluded.captured_at;
  return true;
end;
$$;

revoke all on function public.recap_screenshot(jsonb) from public;
grant execute on function public.recap_screenshot(jsonb) to anon, authenticated;

-- ------------------------------------------------------------------ 3. confirmed emails only

-- The member row for the signed-in user, only when their email is confirmed in Supabase Auth.
create or replace function public.recap_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.recap_members m
  join auth.users u on lower(u.email) = lower(m.email)
  where u.id = coalesce(
          case when auth.jwt() ->> 'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then (auth.jwt() ->> 'sub')::uuid end,
          '00000000-0000-0000-0000-000000000000'::uuid)
    and u.email_confirmed_at is not null
    and lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and m.email like '%_@_%'
  limit 1
$$;

-- ------------------------------------------------------------------ 5. access checked once per query

drop policy if exists recap_sessions_read on public.recap_sessions;
create policy recap_sessions_read on public.recap_sessions
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_sessions_delete on public.recap_sessions;
create policy recap_sessions_delete on public.recap_sessions
  for delete to authenticated using ((select public.recap_role()) = 'admin');

drop policy if exists recap_events_read on public.recap_events;
create policy recap_events_read on public.recap_events
  for select to authenticated using ((select public.recap_is_member()));

drop policy if exists recap_members_read on public.recap_members;
create policy recap_members_read on public.recap_members
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_members_admin on public.recap_members;
create policy recap_members_admin on public.recap_members
  for all to authenticated
  using ((select public.recap_role()) = 'admin')
  with check ((select public.recap_role()) = 'admin');

drop policy if exists recap_screenshots_read on public.recap_screenshots;
create policy recap_screenshots_read on public.recap_screenshots
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_screenshots_delete on public.recap_screenshots;
create policy recap_screenshots_delete on public.recap_screenshots
  for delete to authenticated using ((select public.recap_role()) = 'admin');

drop policy if exists recap_frames_read on public.recap_frames;
create policy recap_frames_read on public.recap_frames
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_frames_delete on public.recap_frames;
create policy recap_frames_delete on public.recap_frames
  for delete to authenticated using ((select public.recap_role()) = 'admin');

drop policy if exists recap_dom_read on public.recap_dom;
create policy recap_dom_read on public.recap_dom
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_dom_delete on public.recap_dom;
create policy recap_dom_delete on public.recap_dom
  for delete to authenticated using ((select public.recap_role()) = 'admin');

drop policy if exists recap_settings_read on public.recap_settings;
create policy recap_settings_read on public.recap_settings
  for select to authenticated using ((select public.recap_is_member()));
drop policy if exists recap_settings_admin on public.recap_settings;
create policy recap_settings_admin on public.recap_settings
  for update to authenticated
  using ((select public.recap_role()) = 'admin')
  with check ((select public.recap_role()) = 'admin');

-- ------------------------------------------------------------------ 6. recordings: one limit per visit, locked

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
  -- The session must already exist for this app (the SDK uploads it first). Locking its row makes
  -- parallel chunks of one visit take turns, so they can't all slip under its limit at once.
  select replay_bytes + dom_bytes into v_have from public.recap_sessions
  where id = v_session and app_id = v_app
  for update;
  if not found then
    return 0;
  end if;
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
  if octet_length(payload::text) > 5100000 then
    raise exception 'recap: frames batch too large';
  end if;
  -- The session must already exist for this app. Locked, as in recap_dom.
  select replay_bytes + dom_bytes into v_had_bytes from public.recap_sessions
  where id = v_session and app_id = v_app
  for update;
  if not found then
    return 0;
  end if;
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
      if length(v_image) > 250000 then
        continue; -- too big for a replay frame; skip it rather than fail the batch
      end if;
      if v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
        raise exception 'recap: image must be a base64 data URL';
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

-- ------------------------------------------------------------------ 7. forgetting a user

drop function if exists public.recap_forget_user(text);

-- Remove every session of one of your users (for data deletion requests), in one app or all apps,
-- with the anonymous sessions from the same devices (the install's sessions before they signed in).
-- Admins only. Returns how many sessions were removed.
create or replace function public.recap_forget_user(p_user_id text, p_app text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if public.recap_role() is distinct from 'admin' then
    raise exception 'recap: admins only';
  end if;
  with mine as (
    select id, app_id, anonymous_id from public.recap_sessions
    where user_id = p_user_id and (p_app is null or app_id = p_app)
  )
  delete from public.recap_sessions s
  where s.id in (select id from mine)
     or (s.user_id is null and s.anonymous_id is not null
         and (s.app_id, s.anonymous_id) in (select app_id, anonymous_id from mine where anonymous_id is not null));
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.recap_forget_user(text, text) from public, anon;
grant execute on function public.recap_forget_user(text, text) to authenticated;

-- ------------------------------------------------------------------ 8. members

do $$
begin
  begin
    create unique index if not exists recap_members_email_lower_idx on public.recap_members (lower(email));
  exception when unique_violation then
    raise notice 'recap: two members share an email in different case. Delete one, then run this file again.';
  end;
  if not exists (select 1 from pg_constraint where conname = 'recap_members_email_at') then
    alter table public.recap_members add constraint recap_members_email_at check (email like '%_@_%') not valid;
  end if;
end $$;

create or replace function public.recap_keep_an_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (select 1 from public.recap_members where role = 'admin' and email <> old.email) then
    raise exception 'recap: keep at least one admin. Add another admin first.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.recap_keep_an_admin() from public, anon, authenticated;

drop trigger if exists recap_keep_an_admin on public.recap_members;
create trigger recap_keep_an_admin
  before delete or update on public.recap_members
  for each row execute function public.recap_keep_an_admin();

-- ------------------------------------------------------------------ 9. table rights the dashboard never uses

revoke truncate, references, trigger on
  public.recap_sessions, public.recap_events, public.recap_members, public.recap_frames,
  public.recap_dom, public.recap_screenshots, public.recap_settings
from anon, authenticated;
revoke insert, update on
  public.recap_sessions, public.recap_events, public.recap_frames, public.recap_dom, public.recap_screenshots
from authenticated;

-- ------------------------------------------------------------------ first-admin hint

-- Whether the team has an admin yet. The dashboard shows a signed-in non-member the SQL to make
-- themselves admin only while there is none, so the hint can't be used to talk a member into adding
-- an outsider.
create or replace function public.recap_has_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.recap_members where role = 'admin')
$$;

revoke all on function public.recap_has_admin() from public, anon;
grant execute on function public.recap_has_admin() to authenticated;
