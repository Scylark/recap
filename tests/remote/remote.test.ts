import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteSink, maskTextSelectorFor, type RrwebEvent } from '../../src/remote/remote';
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

describe('RemoteSink when the page is hidden or closed', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  type Sent = { url: string; payload: { events: { type: string }[] }; keepalive: boolean };

  /** A fetch whose first `hold` calls wait until release() is called. */
  function heldFetch(hold = 1, status = (_url: string) => 200) {
    const sent: Sent[] = [];
    const waiting: Array<() => void> = [];
    let held = 0;
    const fn = (async (url: string, init: RequestInit) => {
      sent.push({ url, payload: JSON.parse(String(init.body)).payload, keepalive: Boolean(init.keepalive) });
      if (held < hold) {
        held++;
        await new Promise<void>((r) => waiting.push(r));
      }
      const s = status(url);
      return { ok: s < 400, status: s } as Response;
    }) as unknown as typeof fetch;
    return { fn, sent, release: () => waiting.splice(0).forEach((r) => r()) };
  }

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('never sends an event twice or drops one when the tab hides mid-upload', async () => {
    const { fn, sent, release } = heldFetch(1);
    const sink = new RemoteSink(config, fn);
    sink.start();
    sink.handle(nav('/')); // first screen: uploads straight away, and that request is held
    await tick();
    sink.handle(click(10, 10, 'A'));
    window.dispatchEvent(new Event('pagehide')); // exit flush while the first batch is on the way
    await tick();
    sink.handle(click(20, 20, 'B'));
    release();
    await tick();
    await sink.flush();
    sink.stop();
    const types = sent
      .filter((c) => c.url.endsWith('recap_ingest'))
      .flatMap((c) => c.payload.events.map((e) => (e as { data?: { label?: string } }).data?.label ?? e.type));
    expect(types.sort()).toEqual(['A', 'B', 'screen'].sort());
    expect(sink.pending()).toHaveLength(0);
  });

  it('sends no recording on exit until the session is stored', async () => {
    const { fn, sent, release } = heldFetch(1);
    let emit: ((e: RrwebEvent) => void) | null = null;
    const record = (opts: { emit: (e: RrwebEvent) => void }) => {
      emit = opts.emit;
      return () => undefined;
    };
    const sink = new RemoteSink({ ...config, recordings: { record } }, fn);
    sink.start();
    emit!({ type: 2, timestamp: Date.now(), data: {} });
    sink.handle(nav('/')); // the session's first upload, held
    await tick();
    window.dispatchEvent(new Event('pagehide'));
    await tick();
    expect(sent.filter((c) => c.url.endsWith('recap_dom'))).toHaveLength(0);
    release();
    await sink.flush();
    const urls = sent.map((c) => c.url.split('/').pop());
    expect(urls.indexOf('recap_ingest')).toBeLessThan(urls.indexOf('recap_dom'));
    sink.stop();
  });

  it('keeps a snapshot too big for keepalive for the next normal upload', async () => {
    const { fn, sent } = heldFetch(0);
    let emit: ((e: RrwebEvent) => void) | null = null;
    const record = (opts: { emit: (e: RrwebEvent) => void }) => {
      emit = opts.emit;
      return () => undefined;
    };
    const sink = new RemoteSink({ ...config, recordings: { record } }, fn);
    sink.start();
    sink.handle(nav('/'));
    await sink.flush(); // session stored
    emit!({ type: 2, timestamp: Date.now(), data: { html: 'x'.repeat(100_000) } });
    window.dispatchEvent(new Event('pagehide'));
    await tick();
    expect(sent.filter((c) => c.url.endsWith('recap_dom'))).toHaveLength(0);
    await sink.flush();
    const dom = sent.filter((c) => c.url.endsWith('recap_dom'));
    expect(dom).toHaveLength(1);
    expect(dom[0]!.keepalive).toBe(false);
    expect(dom[0]!.payload.events[0]!.type).toBe(2);
    sink.stop();
  });

  it('sends small batches as keepalive so they survive the page closing', async () => {
    const { fn, sent } = heldFetch(0);
    const sink = new RemoteSink(config, fn);
    sink.start();
    sink.handle(nav('/'));
    await sink.flush();
    expect(sent[0]!.keepalive).toBe(true);
    sink.stop();
  });
});

describe('RemoteSink recording limits', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function recorder() {
    const ctl: { emit: ((e: RrwebEvent) => void) | null; stop: ReturnType<typeof vi.fn> } = { emit: null, stop: vi.fn() };
    const record = Object.assign(
      (opts: { emit: (e: RrwebEvent) => void }) => {
        ctl.emit = opts.emit;
        return ctl.stop;
      },
      { takeFullSnapshot: vi.fn(() => ctl.emit!({ type: 2, timestamp: Date.now(), data: { fresh: true } })) },
    );
    return { ctl, record };
  }

  it('stops recording when the database refuses a chunk, instead of retrying it forever', async () => {
    const calls: string[] = [];
    const fn = (async (url: string) => {
      calls.push(url);
      const s = url.endsWith('recap_dom') ? 400 : 200;
      return { ok: s < 400, status: s } as Response;
    }) as unknown as typeof fetch;
    const { ctl, record } = recorder();
    const sink = new RemoteSink({ ...config, recordings: { record } }, fn);
    sink.start();
    ctl.emit!({ type: 2, timestamp: Date.now() });
    sink.handle(nav('/'));
    await sink.flush();
    ctl.emit!({ type: 3, timestamp: Date.now() });
    await sink.flush();
    expect(calls.filter((u) => u.endsWith('recap_dom'))).toHaveLength(1);
    expect(ctl.stop).toHaveBeenCalled();
    sink.stop();
  });

  it('keeps retrying recordings after server errors', async () => {
    let fail = true;
    const calls: string[] = [];
    const fn = (async (url: string) => {
      calls.push(url);
      const s = url.endsWith('recap_dom') && fail ? 503 : 200;
      return { ok: s < 400, status: s } as Response;
    }) as unknown as typeof fetch;
    const { ctl, record } = recorder();
    const sink = new RemoteSink({ ...config, recordings: { record } }, fn);
    sink.start();
    ctl.emit!({ type: 2, timestamp: Date.now() });
    sink.handle(nav('/'));
    await sink.flush();
    const failed = calls.filter((u) => u.endsWith('recap_dom')).length;
    expect(failed).toBeGreaterThan(0);
    fail = false;
    await sink.flush(); // sent now
    await sink.flush(); // nothing left to send
    expect(calls.filter((u) => u.endsWith('recap_dom'))).toHaveLength(failed + 1);
    expect(ctl.stop).not.toHaveBeenCalled();
    sink.stop();
  });

  it('starts again from a fresh snapshot instead of buffering without limit', () => {
    const fn = (async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    const { ctl, record } = recorder();
    const sink = new RemoteSink({ ...config, recordings: { record } }, fn);
    sink.start();
    for (let i = 0; i < 6; i++) ctl.emit!({ type: 3, timestamp: Date.now(), data: { html: 'x'.repeat(1_000_000) } });
    expect(record.takeFullSnapshot).toHaveBeenCalledTimes(1);
    sink.stop();
  });

  it('gives up on pages too large to store', () => {
    const { ctl, record } = recorder();
    const sink = new RemoteSink({ ...config, recordings: { record } }, fakeFetch().fn);
    sink.start();
    ctl.emit!({ type: 2, timestamp: Date.now(), data: { html: 'x'.repeat(3_000_000) } });
    expect(ctl.stop).toHaveBeenCalled();
    sink.stop();
  });

  it('records the first snapshot rrweb emits while starting', async () => {
    const { fn, calls } = fakeFetch();
    const record = (opts: { emit: (e: RrwebEvent) => void }) => {
      opts.emit({ type: 4, timestamp: Date.now(), data: { width: 400, height: 800 } });
      opts.emit({ type: 2, timestamp: Date.now(), data: {} });
      return () => undefined;
    };
    const sink = new RemoteSink({ ...config, recordings: { record } }, fn);
    sink.start();
    sink.handle(nav('/'));
    await sink.flush();
    const dom = calls.find((c) => c.url.endsWith('recap_dom'))!.body.payload as { events: { type: number }[] };
    expect(dom.events.map((e) => e.type)).toEqual([4, 2]);
    sink.stop();
  });
});

describe('RemoteSink recordings text masking', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function optionsFor(maskText?: boolean | string): Record<string, unknown> {
    const record = vi.fn(() => () => undefined);
    const recordings = maskText === undefined ? { record } : { record, maskText };
    const sink = new RemoteSink({ ...config, recordings }, fakeFetch().fn);
    sink.start();
    sink.stop();
    sessionStorage.clear();
    return (record.mock.calls[0] as unknown as [Record<string, unknown>])[0];
  }

  it('masks .ut-mask text by default, all text with maskText: true, or a selector', () => {
    expect(optionsFor()).toMatchObject({ maskAllInputs: true, maskTextSelector: '.ut-mask' });
    expect(optionsFor(true)).toMatchObject({ maskAllInputs: true, maskTextSelector: '*' });
    expect(optionsFor('.ride-name, [data-private-text]')).toMatchObject({
      maskAllInputs: true,
      maskTextSelector: '.ut-mask, .ride-name, [data-private-text]',
    });
    expect(maskTextSelectorFor(false)).toBe('.ut-mask');
    expect(maskTextSelectorFor('  ')).toBe('.ut-mask');
  });

  it('keeps blocking private parts as well as masking text', () => {
    expect(String(optionsFor(true)['blockSelector'])).toContain('.recap-private');
  });
});

describe('RemoteSink.discard', () => {
  it('drops everything not yet sent, stops recording and forgets the browser id', async () => {
    sessionStorage.clear();
    const { fn, calls } = fakeFetch();
    const stop = vi.fn();
    let emit: ((e: RrwebEvent) => void) | null = null;
    const record = (opts: { emit: (e: RrwebEvent) => void }) => {
      emit = opts.emit;
      return stop;
    };
    const sink = new RemoteSink({ ...config, recordings: { record } }, fn);
    sink.start();
    sink.handle(nav('/'));
    await sink.flush();
    expect(localStorage.getItem('recap-remote-anon')).not.toBeNull();
    const before = calls.length;
    sink.track('waiting');
    emit!({ type: 3, timestamp: Date.now() });
    sink.discard();
    await sink.flush();
    expect(calls.length).toBe(before);
    expect(sink.pending()).toHaveLength(0);
    expect(stop).toHaveBeenCalled();
    expect(localStorage.getItem('recap-remote-anon')).toBeNull();
  });
});
