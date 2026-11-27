// In-memory versions of the analytics database functions, for the demo. They mirror
// supabase/migrations/20261127000000_recap_analytics.sql; tests/analytics-parity.test.ts checks
// both give the same answers on the same data.

import type {
  BreakdownRow,
  EventName,
  Filters,
  FunnelRow,
  PropertyValue,
  RetentionRow,
  TrendPoint,
} from '../lib/analytics';
import type { EventRow, SessionRow } from '../lib/types';
import { trunc } from '../lib/time';

export interface AnalyticsEvent {
  app_id: string;
  session_id: string;
  distinct_id: string;
  name: string;
  kind: EventName['kind'];
  at: number;
  screen: string | null;
  platform: string | null;
  app_version: string | null;
  os_version: string | null;
  device_model: string | null;
  locale: string | null;
  data: Record<string, unknown>;
}

export function analyticsEvents(sessions: SessionRow[], events: EventRow[]): AnalyticsEvent[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const base = (s: SessionRow) => ({
    app_id: s.app_id,
    session_id: s.id,
    distinct_id: s.user_id ?? s.anonymous_id ?? s.id,
    platform: s.platform,
    app_version: s.app_version,
    os_version: s.os_version,
    device_model: s.device_model,
    locale: s.locale,
  });
  const out: AnalyticsEvent[] = [];
  for (const e of events) {
    const s = byId.get(e.session_id);
    if (!s) continue;
    let name: string | null = null;
    if (e.type === 'screen' && e.screen != null) name = `Viewed ${e.screen}`;
    else if (e.type === 'tap' && e.data.label != null) name = `Tapped ${String(e.data.label)}`;
    else if (e.type === 'custom' && e.data.name != null) name = String(e.data.name).slice(0, 200);
    if (name == null) continue;
    out.push({ ...base(s), name, kind: e.type as EventName['kind'], at: Date.parse(e.at), screen: e.screen, data: e.data });
  }
  for (const s of sessions)
    out.push({ ...base(s), name: 'Session started', kind: 'session', at: Date.parse(s.started_at), screen: s.first_screen, data: {} });
  return out;
}

const FILTER_KEYS = ['platform', 'app_version', 'os_version', 'device_model', 'locale'] as const;

function filterOk(f: Filters | undefined, e: AnalyticsEvent): boolean {
  if (!f) return true;
  return FILTER_KEYS.every((k) => f[k] == null || f[k] === e[k]);
}

export function prop(p: string, e: AnalyticsEvent): string {
  let v: unknown = null;
  if (p === 'screen' || (FILTER_KEYS as readonly string[]).includes(p)) v = e[p as keyof AnalyticsEvent];
  else if (p.startsWith('prop:')) {
    const raw = e.data[p.slice(5)];
    v = raw == null ? null : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  }
  return v == null ? '(none)' : String(v);
}

export { trunc };

const iso = (ms: number) => new Date(ms).toISOString();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function inRange(all: AnalyticsEvent[], app: string, since: string, until: string) {
  const a = Date.parse(since);
  const b = Date.parse(until);
  return all.filter((e) => e.app_id === app && e.at >= a && e.at < b);
}

function topSegments(counts: Map<string, number>): Set<string> {
  return new Set(
    [...counts.entries()]
      .sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]))
      .slice(0, 6)
      .map(([k]) => k),
  );
}

export function eventNames(all: AnalyticsEvent[], app: string, since: string, until: string): EventName[] {
  const by = new Map<string, { kind: EventName['kind']; n: number; users: Set<string>; last: number }>();
  for (const e of inRange(all, app, since, until)) {
    const b = by.get(e.name) ?? { kind: e.kind, n: 0, users: new Set<string>(), last: 0 };
    if (e.kind < b.kind) b.kind = e.kind;
    b.n++;
    b.users.add(e.distinct_id);
    b.last = Math.max(b.last, e.at);
    by.set(e.name, b);
  }
  return [...by.entries()]
    .map(([name, b]) => ({ name, kind: b.kind, events: b.n, users: b.users.size, last_seen: iso(b.last) }))
    .sort((x, y) => y.events - x.events || cmp(x.name, y.name));
}

const HIDDEN_KEYS = new Set(['name', 'label', 'x', 'y', 'nx', 'ny', 'from']);

export function eventProperties(all: AnalyticsEvent[], app: string, since: string, until: string, event: string): PropertyValue[] {
  const counts = new Map<string, Map<string, number>>();
  for (const e of inRange(all, app, since, until)) {
    if (e.name !== event) continue;
    for (const [k, raw] of Object.entries(e.data)) {
      if (HIDDEN_KEYS.has(k)) continue;
      const v = raw == null ? null : typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
      if (v == null) continue;
      const m = counts.get(k) ?? new Map<string, number>();
      m.set(v, (m.get(v) ?? 0) + 1);
      counts.set(k, m);
    }
  }
  const out: PropertyValue[] = [];
  for (const k of [...counts.keys()].sort(cmp)) {
    const vals = [...counts.get(k)!.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 10);
    for (const [value, events] of vals) out.push({ key: k, value, events });
  }
  return out;
}

export function trend(
  all: AnalyticsEvent[],
  a: { p_app: string; p_since: string; p_until: string; p_event: string | null; p_measure: string; p_interval: string; p_breakdown: string | null; p_filters?: Filters },
): TrendPoint[] {
  const ev = inRange(all, a.p_app, a.p_since, a.p_until)
    .filter((e) => (a.p_event == null || e.name === a.p_event) && filterOk(a.p_filters, e))
    .map((e) => ({ bucket: trunc(e.at, a.p_interval), seg: a.p_breakdown == null ? 'All' : prop(a.p_breakdown, e), id: e.distinct_id }));
  const segCount = new Map<string, number>();
  for (const e of ev) segCount.set(e.seg, (segCount.get(e.seg) ?? 0) + 1);
  const top = topSegments(segCount);
  const by = new Map<string, { bucket: number; seg: string; n: number; ids: Set<string> }>();
  for (const e of ev) {
    const seg = top.has(e.seg) ? e.seg : 'Other';
    const key = `${e.bucket}|${seg}`;
    const b = by.get(key) ?? { bucket: e.bucket, seg, n: 0, ids: new Set<string>() };
    b.n++;
    b.ids.add(e.id);
    by.set(key, b);
  }
  return [...by.values()]
    .sort((x, y) => x.bucket - y.bucket || cmp(x.seg, y.seg))
    .map((b) => ({ bucket: iso(b.bucket), segment: b.seg, value: a.p_measure === 'uniques' ? b.ids.size : b.n }));
}

export function breakdown(
  all: AnalyticsEvent[],
  a: { p_app: string; p_since: string; p_until: string; p_event: string | null; p_property: string; p_filters?: Filters },
): BreakdownRow[] {
  const by = new Map<string, { n: number; ids: Set<string> }>();
  for (const e of inRange(all, a.p_app, a.p_since, a.p_until)) {
    if ((a.p_event != null && e.name !== a.p_event) || !filterOk(a.p_filters, e)) continue;
    const seg = prop(a.p_property, e);
    const b = by.get(seg) ?? { n: 0, ids: new Set<string>() };
    b.n++;
    b.ids.add(e.distinct_id);
    by.set(seg, b);
  }
  return [...by.entries()]
    .map(([segment, b]) => ({ segment, events: b.n, users: b.ids.size }))
    .sort((x, y) => y.events - x.events || cmp(x.segment, y.segment))
    .slice(0, 50);
}

export function funnel(
  all: AnalyticsEvent[],
  a: { p_app: string; p_since: string; p_until: string; p_steps: string[]; p_window_minutes?: number; p_breakdown: string | null; p_filters?: Filters },
): FunnelRow[] {
  const steps = a.p_steps;
  const windowMs = (a.p_window_minutes ?? 1440) * 60_000;
  const ev = inRange(all, a.p_app, a.p_since, a.p_until).filter((e) => steps.includes(e.name) && filterOk(a.p_filters, e));
  const byUser = new Map<string, AnalyticsEvent[]>();
  for (const e of ev) byUser.set(e.distinct_id, [...(byUser.get(e.distinct_id) ?? []), e]);

  const reached: { step: number; seg: string; gap: number | null }[] = [];
  for (const list of byUser.values()) {
    const firsts = list.filter((e) => e.name === steps[0]);
    if (!firsts.length) continue;
    // Earliest first step; ties resolve like Postgres' DISTINCT ON without a tiebreak, so prefer
    // the first in insertion order.
    const first = firsts.reduce((m, e) => (e.at < m.at ? e : m));
    const seg = a.p_breakdown == null ? 'All' : prop(a.p_breakdown, first);
    const t0 = first.at;
    let t = first.at;
    reached.push({ step: 1, seg, gap: null });
    for (let k = 1; k < steps.length; k++) {
      const same = steps[k] === steps[k - 1];
      const cands = list.filter((e) => e.name === steps[k] && e.at >= t && (!same || e.at > t) && e.at <= t0 + windowMs);
      if (!cands.length) break;
      const next = Math.min(...cands.map((e) => e.at));
      reached.push({ step: k + 1, seg, gap: (next - t) / 1000 });
      t = next;
    }
  }
  const segCount = new Map<string, number>();
  for (const r of reached) if (r.step === 1) segCount.set(r.seg, (segCount.get(r.seg) ?? 0) + 1);
  const top = topSegments(segCount);
  const by = new Map<string, { step: number; seg: string; n: number; gap: number }>();
  for (const r of reached) {
    const seg = top.has(r.seg) ? r.seg : 'Other';
    const key = `${r.step}|${seg}`;
    const b = by.get(key) ?? { step: r.step, seg, n: 0, gap: 0 };
    b.n++;
    b.gap += r.gap ?? 0;
    by.set(key, b);
  }
  return [...by.values()]
    .sort((x, y) => x.step - y.step || cmp(x.seg, y.seg))
    .map((b) => ({ step: b.step, segment: b.seg, users: b.n, avg_seconds: b.step === 1 ? null : b.gap / b.n }));
}

export function retention(
  all: AnalyticsEvent[],
  a: { p_app: string; p_since: string; p_until: string; p_interval: string; p_start_event: string; p_return_event: string; p_filters?: Filters },
): RetentionRow[] {
  const ev = inRange(all, a.p_app, a.p_since, a.p_until).filter(
    (e) => (e.name === a.p_start_event || e.name === a.p_return_event) && filterOk(a.p_filters, e),
  );
  const firstAt = new Map<string, number>();
  for (const e of ev)
    if (e.name === a.p_start_event) firstAt.set(e.distinct_id, Math.min(firstAt.get(e.distinct_id) ?? Infinity, e.at));
  const cohortOf = new Map([...firstAt.entries()].map(([id, at]) => [id, trunc(at, a.p_interval)]));
  const sizes = new Map<number, number>();
  for (const c of cohortOf.values()) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const secs = a.p_interval === 'week' ? 604_800 : 86_400;
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const e of ev) {
    if (e.name !== a.p_return_event) continue;
    const c = cohortOf.get(e.distinct_id);
    if (c == null || e.at < c) continue;
    const period = Math.round((trunc(e.at, a.p_interval) - c) / 1000 / secs);
    if (period < 0 || period > 12) continue;
    const k = `${c}|${e.distinct_id}|${period}`;
    if (seen.has(k)) continue;
    seen.add(k);
    counts.set(`${c}|${period}`, (counts.get(`${c}|${period}`) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, users]) => {
      const [c, p] = k.split('|').map(Number) as [number, number];
      return { cohort: iso(c), cohort_size: sizes.get(c)!, period: p, users };
    })
    .sort((x, y) => cmp(x.cohort, y.cohort) || x.period - y.period);
}
