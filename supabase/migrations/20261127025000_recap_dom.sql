-- Recap page recordings for websites and web apps: rrweb events, played back as a session replay.
-- Run after the earlier Recap migrations. Safe to run again.
--
-- The web SDK only sends these when the site turns on `remote.recordings` and loads rrweb. rrweb
-- records the page's structure and its changes, not pictures, with every form field masked and
-- anything marked `.recap-private` or `[data-ut-no-track]` left out. Chunks belong to a session and
-- are deleted with it (by an admin, by recap_purge or by recap_forget_user).
--
-- Size: a few hundred KB for the first view of a page, then small changes. On Supabase's free plan
-- (500 MB database) use `recordings: { sampleRate: 0.1 }` or similar on busy sites, and a retention
-- schedule with recap_purge.

create table if not exists public.recap_dom (
  id         bigint generated always as identity primary key,
  session_id uuid not null references public.recap_sessions (id) on delete cascade,
  app_id     text not null,
  t_ms       integer not null,
  events     jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists recap_dom_session_idx on public.recap_dom (session_id, t_ms, id);

alter table public.recap_dom enable row level security;

drop policy if exists recap_dom_read on public.recap_dom;
create policy recap_dom_read on public.recap_dom
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_dom_delete on public.recap_dom;
create policy recap_dom_delete on public.recap_dom
  for delete to authenticated using (public.recap_role() = 'admin');

revoke all on public.recap_dom from anon;

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
  if octet_length(v_events::text) > 3000000 then
    raise exception 'recap: recording chunk too large (keep it under about 3 MB)';
  end if;
  -- The session must already exist for this app (the SDK uploads it first).
  if not exists (select 1 from public.recap_sessions where id = v_session and app_id = v_app) then
    return 0;
  end if;
  select count(*) into v_chunks from public.recap_dom where session_id = v_session;
  if v_chunks >= 2000 then
    return 0; -- a very long session: stop storing more of it
  end if;

  insert into public.recap_dom (session_id, app_id, t_ms, events)
  values (
    v_session,
    v_app,
    greatest(0, least(86400000, coalesce(round((payload ->> 't')::numeric)::integer, 0))),
    v_events
  );
  return jsonb_array_length(v_events);
end;
$$;

revoke all on function public.recap_dom(jsonb) from public;
grant execute on function public.recap_dom(jsonb) to anon, authenticated;
