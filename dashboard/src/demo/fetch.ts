// A pretend Supabase for the demo: answers the PostgREST requests the dashboard makes from
// in-memory data, so the real dashboard code (including supabase-js) runs unchanged with no backend.

import type { EventRow, SessionRow } from '../lib/types';
import { buildDataset } from './dataset';

const data = buildDataset();

type Row = Record<string, unknown>;

function get(row: Row, col: string): unknown {
  if (col.includes('->>')) {
    const [base, key] = col.split('->>') as [string, string];
    const v = (row[base] as Row | undefined)?.[key];
    return v == null ? null : String(v);
  }
  return row[col];
}

function test(row: Row, col: string, expr: string): boolean {
  const neg = expr.startsWith('not.');
  const e = neg ? expr.slice(4) : expr;
  const dot = e.indexOf('.');
  const op = e.slice(0, dot);
  let val = e.slice(dot + 1);
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1).replace(/\\"/g, '"');
  const v = get(row, col);
  let ok: boolean;
  switch (op) {
    case 'eq':
      ok = String(v) === val;
      break;
    case 'gte':
      ok = String(v) >= val;
      break;
    case 'is':
      ok = val === 'null' ? v == null : String(v) === val;
      break;
    case 'ilike': {
      const re = new RegExp('^' + val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*') + '$', 'i');
      ok = v != null && re.test(String(v));
      break;
    }
    default:
      ok = true;
  }
  return neg ? !ok : ok;
}

function splitOr(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function query(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'offset', 'limit'].includes(k)) continue;
    if (k === 'or') {
      const parts = splitOr(v.slice(1, -1)).map((p) => {
        const i = p.indexOf('.');
        return [p.slice(0, i), p.slice(i + 1)] as const;
      });
      out = out.filter((r) => parts.some(([c, e]) => test(r, c, e)));
    } else out = out.filter((r) => test(r, k, v));
  }
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((o) => o.split('.') as [string, string]);
    out = [...out].sort((a, b) => {
      for (const [c, dir] of keys) {
        const x = a[c] as string | number;
        const y = b[c] as string | number;
        if (x === y) continue;
        return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }
  return out;
}

function select(rows: Row[], sel: string | null): Row[] {
  if (!sel || sel === '*') return rows;
  const cols = sel.split(',');
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
}

function json(body: unknown, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function screenStats(appId: string, since: string) {
  const ev = data.events.filter((e) => {
    const s = data.sessions.find((x) => x.id === e.session_id);
    return s?.app_id === appId && e.at >= since && e.screen;
  });
  const exits = new Map<string, number>();
  for (const s of data.sessions)
    if (s.app_id === appId && s.started_at >= since && s.last_screen)
      exits.set(s.last_screen, (exits.get(s.last_screen) ?? 0) + 1);
  const by = new Map<string, { views: number; taps: number; sessions: Set<string> }>();
  for (const e of ev) {
    const b = by.get(e.screen!) ?? { views: 0, taps: 0, sessions: new Set<string>() };
    if (e.type === 'screen') b.views++;
    if (e.type === 'tap') b.taps++;
    b.sessions.add(e.session_id);
    by.set(e.screen!, b);
  }
  return [...by.entries()]
    .map(([screen, b]) => ({ screen, views: b.views, taps: b.taps, sessions: b.sessions.size, exits: exits.get(screen) ?? 0 }))
    .sort((a, b) => b.views - a.views || b.taps - a.taps);
}

export const demoFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  const method = req.method;

  if (path.startsWith('rpc/')) {
    const body = (await req.json().catch(() => ({}))) as Record<string, string>;
    if (path === 'rpc/recap_role') return json('admin');
    if (path === 'rpc/recap_screen_stats') return json(screenStats(body.p_app!, body.p_since!));
    if (path === 'rpc/recap_forget_user') {
      const before = data.sessions.length;
      data.sessions = data.sessions.filter((s) => s.user_id !== body.p_user_id);
      return json(before - data.sessions.length);
    }
    return json(null);
  }

  const table: Row[] | undefined =
    path === 'recap_sessions'
      ? (data.sessions as unknown as Row[])
      : path === 'recap_events'
        ? (data.events.map((e) => ({ ...e, app_id: data.sessions.find((s) => s.id === e.session_id)?.app_id })) as Row[])
        : path === 'recap_members'
          ? (data.members as unknown as Row[])
          : undefined;
  if (!table) return json({ message: 'not found' }, {}, 404);

  if (method === 'GET' || method === 'HEAD') {
    const rows = query(table, url.searchParams);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? rows.length);
    const page = select(rows.slice(offset, offset + limit), url.searchParams.get('select'));
    return json(page, { 'content-range': `${offset}-${offset + page.length - 1}/${rows.length}` });
  }
  if (method === 'POST' && path === 'recap_members') {
    const body = (await req.json()) as { email: string; role: 'viewer' | 'admin' };
    data.members.push({ ...body, created_at: new Date().toISOString() });
    return json(undefined, {}, 201);
  }
  if (method === 'DELETE') {
    const gone = new Set(query(table, url.searchParams));
    if (path === 'recap_sessions') {
      data.sessions = data.sessions.filter((s) => !gone.has(s as unknown as Row));
      data.events = data.events.filter((e) => data.sessions.some((s) => s.id === e.session_id));
    }
    if (path === 'recap_members') data.members = data.members.filter((m) => !gone.has(m as unknown as Row));
    return json(undefined, {}, 204);
  }
  return json(null);
};

export type { EventRow, SessionRow };
