import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteSink, type RrwebEvent } from '../../src/remote/remote';
import type { AnyEvent } from '../../src/types';

type Call = { url: string; body: { payload: Record<string, unknown> }; keepalive: boolean };

function fakeFetch(ok = true) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), keepalive: Boolean(init.keepalive) });
    return { ok, status: ok ? 200 : 500 } as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const base = { sessionId: 's', timestamp: 0, url: '/', viewport: { width: 400, height: 800 } };
const nav = (to: string): AnyEvent => ({ ...base, type: 'navigation', from: '', to, method: 'pushState' });
const click = (x: number, y: number, label: string | null): AnyEvent => ({
  ...base,
  type: 'click',
  pageX: x,
  pageY: y + 100,
  clientX: x,
  clientY: y,
  elementX: 0.5,
  elementY: 0.5,
  selector: '#buy',
  tagName: 'BUTTON',
  label,
  nearestHeading: null,
  pageRegion: 'center',
});
const scroll = (depth: number): AnyEvent => ({ ...base, type: 'scroll', depth, maxDepth: depth });

const config = { appId: 'web-shop', supabase: { url: 'https://x.supabase.co/', anonKey: 'sb_publishable_abc' } };

describe('RemoteSink', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  it('sends page views, taps, scroll milestones and custom events in the mobile format', async () => {
    const { fn, calls } = fakeFetch();
    const sink = new RemoteSink(config, fn);
    expect(sink.start()).toBe(true);
    sink.handle(nav('/'));
    sink.handle(click(100, 200, 'Buy now'));
    sink.handle(scroll(30));
    sink.handle(scroll(40)); // no new milestone
    sink.handle(scroll(80));
    sink.track('added_to_basket', { sku: 'A1' });
    await sink.flush();
    sink.stop();

    const all = calls.filter((c) => c.url.endsWith('/rpc/recap_ingest'));
    expect(all[0]!.url).toBe('https://x.supabase.co/rest/v1/rpc/recap_ingest');
    const events = all.flatMap((c) => c.body.payload['events'] as { type: string; data: Record<string, unknown>; screen: string }[]);
    expect(events.map((e) => e.type)).toEqual(['screen', 'tap', 'scroll', 'scroll', 'custom']);
    expect(events[1]!.data).toMatchObject({ x: 100, y: 200, nx: 0.25, ny: 0.25, label: 'Buy now' });
    expect(events[1]!.screen).toBe('/');
    expect(events.filter((e) => e.type === 'scroll').map((e) => e.data['depth'])).toEqual([25, 75]);
    const p = all[0]!.body.payload as { appId: string; session: { device: { platform: string } } };
    expect(p.appId).toBe('web-shop');
    expect(p.session.device.platform).toBe('web');
  });

  it('keeps one session across page loads in the same tab', () => {
    const a = new RemoteSink(config, fakeFetch().fn);
    const b = new RemoteSink(config, fakeFetch().fn);
    expect(b.getSessionId()).toBe(a.getSessionId());
  });

  it('sends nothing for sessions left out by sampleRate', async () => {
    const { fn, calls } = fakeFetch();
    const sink = new RemoteSink({ ...config, sampleRate: 0 }, fn);
    expect(sink.start()).toBe(false);
    sink.handle(nav('/'));
    await sink.flush();
    expect(calls).toHaveLength(0);
  });

  it('keeps events after a failed upload and retries', async () => {
    const bad = fakeFetch(false);
    const sink = new RemoteSink(config, bad.fn);
    sink.start();
    sink.handle(nav('/'));
    await sink.flush();
    expect(sink.pending()).toHaveLength(1);
    sink.stop();
  });

  it('records the page with rrweb, masks typing, and uploads only once the session exists', async () => {
    const { fn, calls } = fakeFetch();
    let emit: ((e: RrwebEvent) => void) | null = null;
    const record = vi.fn((opts: { emit: (e: RrwebEvent) => void }) => {
      emit = opts.emit;
      return () => undefined;
    });
    const sink = new RemoteSink({ ...config, recordings: { record } }, fn);
    sink.start();
    expect(record.mock.calls[0]![0]).toMatchObject({ maskAllInputs: true });
    expect(String((record.mock.calls[0]![0] as { blockSelector: string }).blockSelector)).toContain('.recap-private');
    emit!({ type: 2, timestamp: Date.now(), data: { node: {} } }); // full snapshot, before the session is uploaded
    expect(calls).toHaveLength(0);
    sink.handle(nav('/'));
    await sink.flush();
    sink.stop();
    const urls = calls.map((c) => c.url.split('/').pop());
    expect(urls.indexOf('recap_ingest')).toBeLessThan(urls.indexOf('recap_dom'));
    const dom = calls.find((c) => c.url.endsWith('recap_dom'))!.body.payload as { sessionId: string; events: unknown[] };
    expect(dom.sessionId).toBe(sink.getSessionId());
    expect(dom.events).toHaveLength(1);
  });

  it('sends recordings nowhere when rrweb is missing', () => {
    const sink = new RemoteSink({ ...config, recordings: true }, fakeFetch().fn);
    expect(() => sink.start()).not.toThrow();
    sink.stop();
  });
});

describe('RemoteSink without the recordings migration', () => {
  it('stops recording instead of retrying forever', async () => {
    sessionStorage.clear();
    const calls: string[] = [];
    const fn = (async (url: string) => {
      calls.push(url);
      return { ok: !url.endsWith('recap_dom'), status: url.endsWith('recap_dom') ? 404 : 200 } as Response;
    }) as unknown as typeof fetch;
    let emit: ((e: RrwebEvent) => void) | null = null;
    const stop = vi.fn();
    const record = (opts: { emit: (e: RrwebEvent) => void }) => {
      emit = opts.emit;
      return stop;
    };
    const sink = new RemoteSink({ ...config, recordings: { record } }, fn);
    sink.start();
    emit!({ type: 2, timestamp: Date.now() });
    sink.handle(nav('/'));
    await sink.flush();
    await sink.flush();
    expect(calls.filter((u) => u.endsWith('recap_dom'))).toHaveLength(1);
    expect(stop).toHaveBeenCalled();
    sink.stop();
  });
});
