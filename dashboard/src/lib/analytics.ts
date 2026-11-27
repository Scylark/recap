// Mixpanel-style analytics. Each function calls a database function from
// supabase/migrations/20261127000000_recap_analytics.sql (the demo answers the same calls from
// src/demo/analytics.ts). Everything respects the dashboard's sign-in: only team members see data.

import { db } from './supabase';

export type Interval = 'hour' | 'day' | 'week' | 'month';
export type Measure = 'total' | 'uniques';

/** Properties you can break a chart down by. "prop:<key>" uses a property sent with recap.track(). */
export const PROPERTIES: { key: string; label: string }[] = [
  { key: 'platform', label: 'Platform' },
  { key: 'app_version', label: 'App version' },
  { key: 'os_version', label: 'OS version' },
  { key: 'device_model', label: 'Device' },
  { key: 'locale', label: 'Locale' },
  { key: 'screen', label: 'Screen' },
];

export type Filters = Partial<Record<'platform' | 'app_version' | 'os_version' | 'device_model' | 'locale', string>>;

export interface EventName {
  name: string;
  kind: 'session' | 'screen' | 'tap' | 'custom';
  events: number;
  users: number;
  last_seen: string;
}

export interface TrendPoint {
  bucket: string;
  segment: string;
  value: number;
}

export interface BreakdownRow {
  segment: string;
  events: number;
  users: number;
}

export interface FunnelRow {
  step: number;
  segment: string;
  users: number;
  avg_seconds: number | null;
}

export interface RetentionRow {
  cohort: string;
  cohort_size: number;
  period: number;
  users: number;
}

export interface PropertyValue {
  key: string;
  value: string;
  events: number;
}

export const SESSION_STARTED = 'Session started';

function tz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const res = await db().rpc(fn, args);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T[];
}

const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function eventNames(appId: string, since: string): Promise<EventName[]> {
  const rows = await rpc<EventName>('recap_event_names', { p_app: appId, p_since: since });
  return rows.map((r) => ({ ...r, events: num(r.events), users: num(r.users) }));
}

export async function eventProperties(appId: string, since: string, event: string): Promise<PropertyValue[]> {
  const rows = await rpc<PropertyValue>('recap_event_properties', {
    p_app: appId,
    p_since: since,
    p_until: new Date().toISOString(),
    p_event: event,
  });
  return rows.map((r) => ({ ...r, events: num(r.events) }));
}

export async function trend(
  appId: string,
  since: string,
  opts: { event: string | null; measure: Measure; interval: Interval; breakdown: string | null; filters: Filters },
): Promise<TrendPoint[]> {
  const rows = await rpc<TrendPoint>('recap_trend', {
    p_app: appId,
    p_since: since,
    p_until: new Date().toISOString(),
    p_event: opts.event,
    p_measure: opts.measure,
    p_interval: opts.interval,
    p_breakdown: opts.breakdown,
    p_filters: opts.filters,
    p_tz: tz(),
  });
  return rows.map((r) => ({ ...r, value: num(r.value) }));
}

export async function breakdown(
  appId: string,
  since: string,
  opts: { event: string | null; property: string; filters: Filters },
): Promise<BreakdownRow[]> {
  const rows = await rpc<BreakdownRow>('recap_breakdown', {
    p_app: appId,
    p_since: since,
    p_until: new Date().toISOString(),
    p_event: opts.event,
    p_property: opts.property,
    p_filters: opts.filters,
  });
  return rows.map((r) => ({ ...r, events: num(r.events), users: num(r.users) }));
}

export async function funnel(
  appId: string,
  since: string,
  opts: { steps: string[]; windowMinutes: number; breakdown: string | null; filters: Filters },
): Promise<FunnelRow[]> {
  const rows = await rpc<FunnelRow>('recap_funnel', {
    p_app: appId,
    p_since: since,
    p_until: new Date().toISOString(),
    p_steps: opts.steps,
    p_window_minutes: opts.windowMinutes,
    p_breakdown: opts.breakdown,
    p_filters: opts.filters,
  });
  return rows.map((r) => ({ ...r, step: num(r.step), users: num(r.users), avg_seconds: r.avg_seconds == null ? null : Number(r.avg_seconds) }));
}

export async function retention(
  appId: string,
  since: string,
  opts: { interval: 'day' | 'week'; startEvent: string; returnEvent: string; filters: Filters },
): Promise<RetentionRow[]> {
  const rows = await rpc<RetentionRow>('recap_retention', {
    p_app: appId,
    p_since: since,
    p_until: new Date().toISOString(),
    p_interval: opts.interval,
    p_start_event: opts.startEvent,
    p_return_event: opts.returnEvent,
    p_filters: opts.filters,
    p_tz: tz(),
  });
  return rows.map((r) => ({ ...r, cohort_size: num(r.cohort_size), period: num(r.period), users: num(r.users) }));
}
