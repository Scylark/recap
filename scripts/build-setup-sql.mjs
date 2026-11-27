#!/usr/bin/env node
// Builds supabase/setup.sql: every file in supabase/migrations/, in name order, in one file that can
// be pasted into the Supabase SQL editor and run once (or again after an update: every migration is
// safe to re-run). `--check` fails if setup.sql is out of date (used in CI).
//
//   node scripts/build-setup-sql.mjs          write supabase/setup.sql
//   node scripts/build-setup-sql.mjs --check  exit 1 if it differs from what would be written

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'supabase', 'migrations');
const out = join(root, 'supabase', 'setup.sql');

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const versions = files.map((f) => f.split('_')[0]);
const dup = versions.find((v, i) => versions.indexOf(v) !== i);
if (dup) {
  console.error(`Two migrations share the version ${dup}: supabase db push needs each to be unique.`);
  process.exit(1);
}

const header = `-- Recap: the whole database setup in one file.
--
-- Paste all of this into your Supabase project's SQL editor (Dashboard -> SQL Editor -> New query)
-- and press Run. It creates Recap's tables, functions and access rules. It is safe to run again,
-- for example after updating Recap. Supabase may warn that the query is "destructive": it only drops
-- and recreates Recap's own access rules, so press "Run this query".
--
-- Then make yourself the first dashboard admin (the email you will sign in with), in a new query:
--
--   insert into public.recap_members (email, role) values ('you@example.com', 'admin');
--
-- Generated from supabase/migrations/ by scripts/build-setup-sql.mjs. Don't edit this file by hand:
-- change a migration and run \`node scripts/build-setup-sql.mjs\`. With the Supabase CLI you can use
-- the migrations instead (supabase db push).
--
-- Contents:
${files.map((f, i) => `--   ${i + 1}. ${f}`).join('\n')}
`;

const body = files
  .map((f) => {
    const sql = readFileSync(join(dir, f), 'utf8').replace(/\s+$/, '');
    const rule = '-- ' + '='.repeat(96);
    return `${rule}\n-- ${f}\n${rule}\n\n${sql}\n`;
  })
  .join('\n');

const footer = `
-- ${'='.repeat(96)}
-- Done. This row confirms the setup (nothing here is required to run).
-- ${'='.repeat(96)}

select
  'Recap is set up' as status,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'recap\\_%') as tables_and_views,
  (select count(*) from public.recap_members where role = 'admin') as admins,
  case when (select count(*) from public.recap_members where role = 'admin') = 0
       then 'Next: add yourself as admin (see the top of this file)'
       else 'Admin found: sign in to the dashboard' end as next_step;
`;

const result = `${header}\n${body}${footer}`;

if (process.argv.includes('--check')) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (current !== result) {
    console.error('supabase/setup.sql is out of date: run `node scripts/build-setup-sql.mjs` and commit it.');
    process.exit(1);
  }
  console.log(`supabase/setup.sql is up to date (${files.length} migrations).`);
} else {
  writeFileSync(out, result);
  console.log(`Wrote supabase/setup.sql from ${files.length} migrations (${Math.round(result.length / 1024)} KB).`);
}
