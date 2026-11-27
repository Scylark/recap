-- Recap screen pictures: one small JPEG per screen, drawn behind its heatmap in the dashboard.
-- Run after the earlier Recap migrations. Safe to run again.
--
-- The SDK only sends these when the app turns on `screenshots` (we suggest `screenshots: __DEV__`,
-- so pictures come from your own test phone, never from real users). Each upload replaces the
-- previous picture of that screen for the same platform and app version.

create table if not exists public.recap_screenshots (
  app_id      text not null,
  screen      text not null,
  platform    text not null default '',
  app_version text not null default '',
  width       integer,
  height      integer,
  image       text not null,
  captured_at timestamptz not null default now(),
  primary key (app_id, screen, platform, app_version)
);

alter table public.recap_screenshots enable row level security;

drop policy if exists recap_screenshots_read on public.recap_screenshots;
create policy recap_screenshots_read on public.recap_screenshots
  for select to authenticated using (public.recap_is_member());

drop policy if exists recap_screenshots_delete on public.recap_screenshots;
create policy recap_screenshots_delete on public.recap_screenshots
  for delete to authenticated using (public.recap_role() = 'admin');

revoke all on public.recap_screenshots from anon;

-- Called by the SDK with { appId, screen, platform, appVersion, width, height, image }.
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
  if v_image is null or v_image !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' then
    raise exception 'recap: image must be a base64 data URL';
  end if;
  if length(v_image) > 700000 then
    raise exception 'recap: image too large (keep it under about 500 KB)';
  end if;

  insert into public.recap_screenshots as rs (app_id, screen, platform, app_version, width, height, image, captured_at)
  values (
    v_app,
    v_screen,
    coalesce(left(payload ->> 'platform', 20), ''),
    coalesce(left(payload ->> 'appVersion', 50), ''),
    least(10000, greatest(0, coalesce((payload ->> 'width')::integer, 0))),
    least(10000, greatest(0, coalesce((payload ->> 'height')::integer, 0))),
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
