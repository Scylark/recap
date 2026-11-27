-- Recap screen recordings: small pictures taken about once a second, played back as a session replay.
-- Run after the earlier Recap migrations. Safe to run again.
--
-- The SDK only sends these when the app turns on `recordings`. Frames belong to a session and are
-- deleted with it (by an admin, by recap_purge or by recap_forget_user). A frame with no image marks
-- a moment when recording was paused for privacy (keyboard open, a <RecapPrivate> view, an excluded screen).
--
-- Size: a frame is usually 10 to 25 KB, so a ten-minute session is a few MB. On Supabase's free plan
-- (500 MB database) use `recordings: { sampleRate: 0.1 }` or similar on busy apps, and a retention
-- schedule with recap_purge.

create table if not exists public.recap_frames (
  session_id uuid not null references public.recap_sessions (id) on delete cascade,
  app_id     text not null,
  t_ms       integer not null,
  image      text,
  primary key (session_id, t_ms)
);

alter table public.recap_frames enable row level security;

drop policy if exists recap_frames_read on public.recap_frames;
create policy recap_frames_read on public.recap_frames
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_frames_delete on public.recap_frames;
create policy recap_frames_delete on public.recap_frames
  for delete to authenticated using (public.recap_role() = 'admin');

revoke all on public.recap_frames from anon;

-- Called by the SDK with { appId, sessionId, frames: [{ t, image }] }. Returns how many were stored.
create or replace function public.recap_frames(payload jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app     text := left(payload ->> 'appId', 100);
  v_session uuid;
  v_frames  jsonb := payload -> 'frames';
  v_have    integer;
  v_count   integer := 0;
  f         jsonb;
  v_image   text;
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
  -- The session must already exist for this app (the SDK uploads it first).
  if not exists (select 1 from public.recap_sessions where id = v_session and app_id = v_app) then
    return 0;
  end if;
  select count(*) into v_have from public.recap_frames where session_id = v_session;

  for f in select * from jsonb_array_elements(v_frames) loop
    exit when v_have + v_count >= 3600;
    v_image := f ->> 'image';
    if v_image is not null then
      if v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
        raise exception 'recap: image must be a base64 data URL';
      end if;
      if length(v_image) > 250000 then
        continue; -- too big for a replay frame; skip it rather than fail the batch
      end if;
    end if;
    insert into public.recap_frames (session_id, app_id, t_ms, image)
    values (v_session, v_app, greatest(0, least(86400000, coalesce(round((f ->> 't')::numeric)::integer, 0))), v_image)
    on conflict (session_id, t_ms) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.recap_frames(jsonb) from public;
grant execute on function public.recap_frames(jsonb) to anon, authenticated;
