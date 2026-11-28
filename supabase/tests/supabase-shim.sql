-- Minimal stand-in for the roles and auth.jwt() that Supabase provides, so the
-- migration and tests can run against a plain local Postgres (used in CI).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
-- Supabase Auth's users table, standing in for the signed-in user only: confirmed unless the claims
-- say {"email_unconfirmed": true}. recap_role() reads it to check the email is confirmed.
create or replace view auth.users as
  select coalesce(case when c ->> 'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then (c ->> 'sub')::uuid end,
                  '00000000-0000-0000-0000-000000000000'::uuid) as id,
         c ->> 'email' as email,
         case when c ->> 'email_unconfirmed' = 'true' then null else now() end as email_confirmed_at
  from (select auth.jwt() as c) x
  where c ? 'email';
