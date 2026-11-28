// Checks that the analytics database functions and the demo's in-memory versions agree.
// Needs a scratch Postgres with the shim and both migrations applied:
//   RECAP_TEST_PG=postgres://... TZ=UTC npx vitest run tests/analytics-parity.test.ts
// Skipped when RECAP_TEST_PG isn't set.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import * as local from '../src/demo/analytics';
import { buildDataset } from '../src/demo/dataset';

const url = process.env.RECAP_TEST_PG;
const NOW = Date.parse('2026-11-27T12:00:00Z');
const data = buildDataset(NOW);
const all = local.analyticsEvents(data.sessions, data.events);
const since = new Date(NOW - 30 * 86_400_000).toISOString();
const until = new Date(NOW).toISOString();
const app = 'demo-shop';

let client: pg.Client;

async function call(fn: string, args: Record<string, unknown>) {
  const keys = Object.keys(args);
  const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
  const res = await client.query(sql, keys.map((k) => args[k]));
  return res.rows as Record<string, unknown>[];
}

function norm(rows: Record<string, unknown>[]) {
  return rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        v instanceof Date
          ? v.toISOString()
          : typeof v === 'string' && /^\d+$/.test(v)
            ? Number(v)
            : typeof v === 'number'
              ? Math.round(v * 1000) / 1000
              : v,
      ]),
    ),
  );
}

describe.skipIf(!url)('analytics: database and demo agree', () => {
  beforeAll(async () => {
    expect(process.env.TZ).toBe('UTC');
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query("select 1 from public.recap_sessions limit 0");
    const existing = await client.query("select count(*)::int as n from public.recap_sessions where app_id in ('demo-shop', 'test-shop')");
    if (existing.rows[0].n > 0) throw new Error('Use a scratch database: demo-shop data is already there');
    await client.query(
      "insert into public.recap_members (email, role) values ('parity@example.com', 'viewer') on conflict do nothing",
    );
    for (const s of data.sessions) {
      // has_recording is worked out by the database (a generated column), so it can't be inserted.
      const cols = Object.keys(s).filter((c) => c !== 'has_recording');
      await client.query(
        `insert into public.recap_sessions (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
        cols.map((c) => (s as unknown as Record<string, unknown>)[c] ?? null),
      );
    }
    for (const e of data.events) {
      const s = data.sessions.find((x) => x.id === e.session_id)!;
      await client.query(
        'insert into public.recap_events (session_id, app_id, type, t_ms, at, screen, data) values ($1,$2,$3,$4,$5,$6,$7)',
        [e.session_id, s.app_id, e.type, e.t_ms, e.at, e.screen, e.data],
      );
    }
    await client.query('set role authenticated');
    await client.query(`select set_config('request.jwt.claims', '{"email":"parity@example.com"}', false)`);
  });
  afterAll(async () => {
    await client?.end();
  });

  it('event names', async () => {
    const db = await call('recap_event_names', { p_app: app, p_since: since, p_until: until });
    expect(db.length).toBeGreaterThan(10);
    expect(norm(db)).toEqual(norm(local.eventNames(all, app, since, until) as never));
  });

  it('event properties', async () => {
    const args = { p_app: app, p_since: since, p_until: until, p_event: 'order_completed' };
    const db = await call('recap_event_properties', args);
    expect(db.length).toBeGreaterThan(0);
    expect(norm(db)).toEqual(norm(local.eventProperties(all, app, since, until, 'order_completed') as never));
  });

  const trends = [
    ['daily sessions', { p_event: 'Session started', p_measure: 'total', p_interval: 'day', p_breakdown: null }],
    ['weekly unique users by platform', { p_event: 'Session started', p_measure: 'uniques', p_interval: 'week', p_breakdown: 'platform' }],
    ['taps by screen, iOS only', { p_event: 'Tapped Add to basket', p_measure: 'total', p_interval: 'day', p_breakdown: 'screen', p_filters: { platform: 'ios' } }],
    ['any event by custom property', { p_event: null, p_measure: 'total', p_interval: 'hour', p_breakdown: 'prop:sku' }],
  ] as const;
  for (const [label, extra] of trends) {
    it(`trend: ${label}`, async () => {
      const args = { p_app: app, p_since: since, p_until: until, p_filters: {}, p_tz: 'UTC', ...extra };
      const db = await call('recap_trend', args);
      expect(db.length).toBeGreaterThan(0);
      expect(norm(db)).toEqual(norm(local.trend(all, args as never) as never));
    });
  }

  it('breakdown', async () => {
    const args = { p_app: app, p_since: since, p_until: until, p_event: 'Session started', p_property: 'device_model', p_filters: {} };
    const db = await call('recap_breakdown', args);
    expect(norm(db)).toEqual(norm(local.breakdown(all, args) as never));
  });

  const funnels = [
    ['purchase funnel', { p_steps: ['Viewed Home', 'Viewed Product', 'Tapped Add to basket', 'Viewed Checkout', 'order_completed'], p_breakdown: null }],
    ['by platform, 10 minute window', { p_steps: ['Session started', 'Viewed Product', 'Viewed Basket'], p_window_minutes: 10, p_breakdown: 'platform' }],
    ['repeated step', { p_steps: ['Viewed Product', 'Viewed Product'], p_breakdown: 'app_version' }],
  ] as const;
  for (const [label, extra] of funnels) {
    it(`funnel: ${label}`, async () => {
      const args = { p_app: app, p_since: since, p_until: until, p_window_minutes: 1440, p_filters: {}, ...extra, p_steps: [...extra.p_steps] };
      const db = await call('recap_funnel', args);
      expect(db.length).toBeGreaterThan(1);
      expect(norm(db)).toEqual(norm(local.funnel(all, args) as never));
    });
  }

  for (const interval of ['day', 'week'] as const) {
    it(`retention by ${interval}`, async () => {
      const args = {
        p_app: app,
        p_since: since,
        p_until: until,
        p_interval: interval,
        p_start_event: 'Session started',
        p_return_event: 'Session started',
        p_filters: {},
        p_tz: 'UTC',
      };
      const db = await call('recap_retention', args);
      expect(db.some((r) => Number(r.period) > 0)).toBe(true);
      expect(norm(db)).toEqual(norm(local.retention(all, args) as never));
    });
  }

  it('shows nothing to someone who is not on the team', async () => {
    await client.query(`select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', false)`);
    const db = await call('recap_trend', { p_app: app, p_since: since, p_until: until });
    expect(db).toEqual([]);
    await client.query(`select set_config('request.jwt.claims', '{"email":"parity@example.com"}', false)`);
  });
});
