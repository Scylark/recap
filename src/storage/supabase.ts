// Optional transport: send web sessions to the Recap tables in your own Supabase project,
// the same tables and dashboard the iOS and Android SDK use. Web sessions show as platform "web".
//
// Only the public anon (or publishable) key is used. It can call recap_ingest() and nothing else:
// it cannot read, change or delete any Recap data.

import type { AnyEvent } from '../types.js';

export const WEB_SDK_VERSION = 'web-1.2.0';

export interface SupabaseTarget {
  url: string;
  anonKey: string;
  appId: string;
  appVersion?: string | undefined;
}

interface IngestEvent {
  type: 'screen' | 'tap' | 'scroll' | 'app_state';
  t: number;
  at: string;
  screen: string | null;
  data: Record<string, unknown>;
}

const START_KEY = 'recap-session-start';

let _target: SupabaseTarget | null = null;

export function setSupabase(target: SupabaseTarget): void {
  _target = { ...target, url: target.url.replace(/\/+$/, '') };
  // Fix the session start now, at the moment the page began loading, so event times count from there.
  sessionStartMs(typeof performance !== 'undefined' ? Math.round(performance.timeOrigin) : Date.now());
}

export function hasSupabase(): boolean {
  return _target !== null;
}

/** Wall clock time the session started. Kept in sessionStorage so it survives page loads, like the session id. */
export function sessionStartMs(now: number = Date.now()): number {
  try {
    const stored = Number(sessionStorage.getItem(START_KEY));
    if (stored > 0) return stored;
    sessionStorage.setItem(START_KEY, String(now));
  } catch {
    // sessionStorage unavailable: the session starts with this page load
  }
  return now;
}

/** A short, non-identifying device label, e.g. "Chrome on Mac". */
export function describeBrowser(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  return os ? `${browser} on ${os}` : browser;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : Math.round(n * 1000) / 1000);

/**
 * Turn web events into the shape recap_ingest() expects.
 * `timeOrigin` is the wall clock time performance.now() counts from (performance.timeOrigin).
 */
export function toIngestEvents(events: AnyEvent[], timeOrigin: number, startMs: number): IngestEvent[] {
  const out: IngestEvent[] = [];
  for (const e of events) {
    const wall = Math.round(timeOrigin + e.timestamp);
    const base = { t: Math.max(0, wall - startMs), at: new Date(wall).toISOString(), screen: e.url || null };
    const w = e.viewport.width || 1;
    const h = e.viewport.height || 1;
    switch (e.type) {
      case 'navigation':
        out.push({ ...base, type: 'screen', screen: e.to || e.url || null, data: { from: e.from || null, method: e.method } });
        break;
      case 'click':
        out.push({
          ...base,
          type: 'tap',
          data: {
            x: Math.round(e.clientX),
            y: Math.round(e.clientY),
            nx: clamp01(e.clientX / w),
            ny: clamp01(e.clientY / h),
            pageX: Math.round(e.pageX),
            pageY: Math.round(e.pageY),
            label: e.label,
            selector: e.selector,
            tag: e.tagName,
          },
        });
        break;
      case 'scroll':
        out.push({ ...base, type: 'scroll', data: { depth: e.depth, maxDepth: e.maxDepth } });
        break;
      case 'visibility':
        out.push({ ...base, type: 'app_state', data: { state: e.state === 'hidden' ? 'background' : 'active' } });
        break;
      default:
        // resize events stay in the browser only
        break;
    }
  }
  return out;
}

export function buildBatch(
  events: AnyEvent[],
  ctx: { appId: string; appVersion?: string | undefined; sessionId: string; startMs: number; timeOrigin: number },
): Record<string, unknown> {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return {
    appId: ctx.appId,
    sdkVersion: WEB_SDK_VERSION,
    session: {
      id: ctx.sessionId,
      startedAt: new Date(ctx.startMs).toISOString(),
      userId: null,
      anonymousId: null,
      device: {
        platform: 'web',
        osVersion: null,
        model: describeBrowser(ua),
        appVersion: ctx.appVersion ?? null,
        screenWidth: vw,
        screenHeight: vh,
        locale: typeof navigator !== 'undefined' ? (navigator.language ?? null) : null,
      },
    },
    events: toIngestEvents(events, ctx.timeOrigin, ctx.startMs),
  };
}

const MAX_PENDING = 1000;
let _pending: AnyEvent[] = [];

/**
 * Send events, plus any left over from a failed send. keepalive lets it finish when the page is closing.
 * Failures are kept in memory (up to 1 000 events) and retried with the next batch, so the local
 * copy in IndexedDB is never written twice.
 */
export async function sendToSupabase(events: AnyEvent[], sessionId: string): Promise<void> {
  if (!_target) return;
  const all = _pending.concat(events);
  _pending = [];
  if (all.length === 0) return;
  // recap_ingest takes at most 500 events per call
  for (let i = 0; i < all.length; i += 200) {
    try {
      await postBatch(all.slice(i, i + 200), sessionId);
    } catch (err) {
      _pending = all.slice(i).slice(-MAX_PENDING);
      console.warn(String(err));
      return;
    }
  }
}

/** For tests. */
export function pendingCount(): number {
  return _pending.length;
}

async function postBatch(events: AnyEvent[], sessionId: string): Promise<void> {
  const t = _target!;
  const batch = buildBatch(events, {
    appId: t.appId,
    appVersion: t.appVersion,
    sessionId,
    startMs: sessionStartMs(),
    timeOrigin: performance.timeOrigin,
  });
  if ((batch.events as unknown[]).length === 0) return;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', apikey: t.anonKey };
  // Legacy anon keys are JWTs and also go in Authorization. Newer sb_publishable_ keys don't.
  if (t.anonKey.startsWith('eyJ')) headers['Authorization'] = `Bearer ${t.anonKey}`;
  const body = JSON.stringify({ payload: batch });
  const res = await fetch(`${t.url}/rest/v1/rpc/recap_ingest`, {
    method: 'POST',
    headers,
    body,
    keepalive: body.length < 60_000,
  });
  if (!res.ok) throw new Error(`[Recap] Supabase upload failed with HTTP ${res.status}`);
}
