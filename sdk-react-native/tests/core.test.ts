import { describe, expect, it, beforeEach } from 'vitest';
import { RecapCore } from '../src/core';
import type { IngestBatch, StorageAdapter, Transport } from '../src/types';

function memoryStorage(): StorageAdapter & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

function fakeTransport(fail = false): Transport & { batches: IngestBatch[]; fail: boolean } {
  const t = {
    batches: [] as IngestBatch[],
    fail,
    send: async (b: IngestBatch) => {
      if (t.fail) throw new Error('offline');
      t.batches.push(b);
    },
  };
  return t;
}

let clock = 1_700_000_000_000;
const deps = {
  now: () => clock,
  random: () => 0.42,
  setInterval: () => null,
  clearInterval: () => undefined,
};
const device = { platform: 'ios' as const, screenWidth: 400, screenHeight: 800 };

describe('RecapCore', () => {
  beforeEach(() => {
    clock = 1_700_000_000_000;
  });

  it('records screens, taps and scroll milestones and uploads them', async () => {
    const transport = fakeTransport();
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', transport }, device);

    r.screen('Home');
    clock += 1000;
    r.tap({ x: 200, y: 400 });
    r.scroll(30);
    r.scroll(40); // no new milestone
    r.scroll(80);
    r.screen('Home'); // same screen, ignored
    r.screen('Basket');
    await r.flush();

    expect(transport.batches).toHaveLength(1);
    const b = transport.batches[0]!;
    expect(b.appId).toBe('test');
    expect(b.session.device.platform).toBe('ios');
    expect(b.events.map((e) => e.type)).toEqual(['screen', 'tap', 'scroll', 'scroll', 'screen']);
    expect(b.events[1]!.data).toMatchObject({ nx: 0.5, ny: 0.5, label: null });
    expect(b.events[1]!.t).toBe(1000);
    expect(b.events[1]!.screen).toBe('Home');
    expect(b.events[3]!.data).toMatchObject({ depth: 75, maxDepth: 80 });
    expect(b.events[4]!.data).toMatchObject({ from: 'Home' });
    expect(r.pending()).toHaveLength(0);
  });

  it('labels a tap from a press handler fired just after it', async () => {
    const transport = fakeTransport();
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', transport }, device);
    r.screen('Home');
    r.tap({ x: 10, y: 10 });
    clock += 100;
    r.labelTap('Buy now');
    expect(r.pending()[1]!.data.label).toBe('Buy now');
  });

  it('labels the next tap when the press handler fires first', async () => {
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', transport: fakeTransport() }, device);
    r.labelTap('Menu');
    clock += 50;
    r.tap({ x: 1, y: 1 });
    expect(r.pending()[0]!.data.label).toBe('Menu');
  });

  it('records nothing until consent when requireConsent is on', async () => {
    const storage = memoryStorage();
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', transport: fakeTransport(), requireConsent: true, storage }, device);
    r.screen('Home');
    expect(r.pending()).toHaveLength(0);
    await r.optIn();
    r.screen('Settings');
    expect(r.pending()).toHaveLength(1);
    expect(storage.data.get('recap:consent')).toBe('granted');
  });

  it('optOut stops recording and clears the queue', async () => {
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', transport: fakeTransport(true) }, device);
    r.screen('Home');
    await r.optOut();
    r.screen('Other');
    expect(r.pending()).toHaveLength(0);
    expect(r.isRecording()).toBe(false);
  });

  it('respects sampleRate', async () => {
    const r = new RecapCore(deps); // random() is 0.42
    await r.init({ appId: 'test', transport: fakeTransport(), sampleRate: 0.25 }, device);
    r.screen('Home');
    expect(r.isRecording()).toBe(false);
    expect(r.pending()).toHaveLength(0);
  });

  it('keeps events offline and restores them on the next launch', async () => {
    const storage = memoryStorage();
    const offline = fakeTransport(true);
    const first = new RecapCore(deps);
    await first.init({ appId: 'test', transport: offline, storage }, device);
    first.screen('Home');
    first.tap({ x: 5, y: 5 });
    await first.flush();
    expect(first.pending()).toHaveLength(2);

    const online = fakeTransport();
    const second = new RecapCore(deps);
    await second.init({ appId: 'test', transport: online, storage }, device);
    await second.flush();
    expect(online.batches).toHaveLength(1);
    expect(online.batches[0]!.events).toHaveLength(2);
    expect(online.batches[0]!.session.id).toBe(first.getSessionId());
  });

  it('caps the offline queue', async () => {
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', transport: fakeTransport(true), maxQueueSize: 5, maxBatchSize: 100 }, device);
    for (let i = 0; i < 10; i++) r.track('e', { i });
    expect(r.pending()).toHaveLength(5);
    expect(r.pending()[0]!.data.i).toBe(5);
  });

  it('starts a new session after a long time in the background', async () => {
    const transport = fakeTransport();
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', transport, sessionTimeoutMs: 60_000 }, device);
    r.screen('Home');
    const firstId = r.getSessionId();
    r.appState('background');
    clock += 10_000;
    r.appState('active');
    expect(r.getSessionId()).toBe(firstId);
    r.appState('background');
    clock += 120_000;
    r.appState('active');
    expect(r.getSessionId()).not.toBe(firstId);
    await r.flush();
    const ids = new Set(transport.batches.map((b) => b.session.id));
    expect(ids.size).toBe(2);
    const last = transport.batches[transport.batches.length - 1]!;
    expect(last.events[0]).toMatchObject({ type: 'screen', screen: 'Home', t: 0 });
  });

  it('splits uploads into batches', async () => {
    const transport = fakeTransport();
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', transport, maxBatchSize: 3 }, device);
    transport.fail = true; // hold everything back while we record
    for (let i = 0; i < 7; i++) r.track('e');
    transport.fail = false;
    await r.flush();
    expect(transport.batches.map((b) => b.events.length)).toEqual([3, 3, 1]);
  });
  it('keeps events recorded while saved state is still loading', async () => {
    const storage = memoryStorage();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: StorageAdapter = { ...storage, getItem: async (k) => (await gate, storage.getItem(k)) };
    const r = new RecapCore(deps);
    const ready = r.init({ appId: 'test', transport: fakeTransport(), storage: slow }, device);
    r.screen('Home'); // app renders its first screen before storage answers
    release();
    await ready;
    expect(r.pending().map((e) => e.screen)).toEqual(['Home']);
  });

  it('drops early events if the user had opted out on a previous launch', async () => {
    const storage = memoryStorage();
    storage.data.set('recap:consent', 'denied');
    const r = new RecapCore(deps);
    const ready = r.init({ appId: 'test', transport: fakeTransport(), storage }, device);
    r.screen('Home');
    await ready;
    r.screen('Next');
    expect(r.pending()).toHaveLength(0);
  });

  it('sends the right headers for legacy and publishable Supabase keys', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const g = globalThis as unknown as { fetch: unknown };
    const orig = g.fetch;
    g.fetch = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return { ok: true, status: 200 };
    };
    try {
      const { supabaseTransport } = await import('../src/transports');
      const batch = { appId: 'a', sdkVersion: '0', session: { id: 'x', startedAt: '', userId: null, device: {} as never }, events: [] };
      await supabaseTransport({ url: 'https://p.supabase.co/', anonKey: 'eyJabc' }).send(batch);
      await supabaseTransport({ url: 'https://p.supabase.co', anonKey: 'sb_publishable_abc' }).send(batch);
    } finally {
      g.fetch = orig;
    }
    expect(calls[0]!.url).toBe('https://p.supabase.co/rest/v1/rpc/recap_ingest');
    expect(calls[0]!.headers.Authorization).toBe('Bearer eyJabc');
    expect(calls[1]!.headers.apikey).toBe('sb_publishable_abc');
    expect(calls[1]!.headers.Authorization).toBeUndefined();
  });

  it('runs without uploading when Supabase settings are missing', async () => {
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', supabase: { url: '', anonKey: '' } }, device);
    r.screen('Home');
    await r.flush();
    expect(r.pending()).toHaveLength(1);
  });

  it('keeps one anonymous install id across launches and forgets it on opt-out', async () => {
    const storage = memoryStorage();
    let n = 0;
    const seq = { ...deps, random: () => ((n = (n * 7 + 3) % 97), n / 97) };
    const t1 = fakeTransport();
    const first = new RecapCore(seq);
    await first.init({ appId: 'test', transport: t1, storage }, device);
    first.screen('Home');
    await first.flush();
    const id = t1.batches[0]!.session.anonymousId;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(storage.data.get('recap:install')).toBe(id);

    const t2 = fakeTransport();
    const second = new RecapCore(seq);
    await second.init({ appId: 'test', transport: t2, storage }, device);
    second.screen('Home');
    await second.flush();
    expect(t2.batches[0]!.session.anonymousId).toBe(id);
    expect(t2.batches[0]!.session.id).not.toBe(t1.batches[0]!.session.id);

    await second.optOut();
    expect(storage.data.has('recap:install')).toBe(false);
    expect(second.getAnonymousId()).not.toBe(id);
  });

  it('takes one screenshot per screen and app version, after the screen settles', async () => {
    const storage = memoryStorage();
    const timers: (() => void)[] = [];
    const d = { ...deps, setTimeout: (fn: () => void) => void timers.push(fn) };
    const shots: { screen: string; image: string; appVersion: string | null }[] = [];
    const transport = { ...fakeTransport(), sendScreenshot: async (s: { screen: string; image: string; appVersion: string | null }) => void shots.push(s) };
    const r = new RecapCore(d);
    await r.init({ appId: 'test', transport, storage, screenshots: { exclude: ['Secret'] }, appVersion: '1.2.0' }, device);
    let calls = 0;
    r.setScreenCapture(async () => (calls++, 'QUJD'));

    r.screen('Home');
    r.screen('Secret'); // excluded
    r.screen('Product'); // Home timer will find the user has moved on
    for (const t of timers.splice(0)) t();
    await new Promise((res) => setTimeout(res, 0));
    expect(shots.map((s) => s.screen)).toEqual(['Product']);
    expect(shots[0]).toMatchObject({ image: 'data:image/jpeg;base64,QUJD', appVersion: '1.2.0' });

    r.screen('Home');
    for (const t of timers.splice(0)) t();
    await new Promise((res) => setTimeout(res, 0));
    r.screen('Product'); // already captured for this version
    expect(timers).toHaveLength(0);
    expect(shots.map((s) => s.screen)).toEqual(['Product', 'Home']);
    expect(JSON.parse(storage.data.get('recap:shots')!)).toEqual(['Product|1.2.0', 'Home|1.2.0']);
    expect(calls).toBe(2);
  });

  it('takes no screenshots unless switched on', async () => {
    const timers: (() => void)[] = [];
    const r = new RecapCore({ ...deps, setTimeout: (fn: () => void) => void timers.push(fn) });
    await r.init({ appId: 'test', transport: { ...fakeTransport(), sendScreenshot: async () => undefined } }, device);
    r.setScreenCapture(async () => 'QUJD');
    r.screen('Home');
    expect(timers).toHaveLength(0);
  });

  it('records frames, skips unchanged ones and pauses for privacy', async () => {
    const frames: { sessionId: string; frames: { t: number; image: string | null }[] }[] = [];
    const transport = { ...fakeTransport(), sendFrames: async (f: (typeof frames)[number]) => void frames.push(f) };
    const r = new RecapCore(deps);
    await r.init({ appId: 'test', transport, recordings: { exclude: ['Account'] } }, device);
    let n = 0;
    const pictures = ['A', 'A', 'B'];
    r.setScreenCapture(async (opts) => {
      expect(opts).toEqual({ width: 280, quality: 0.4 });
      return pictures[n++] ?? 'C';
    });
    r.screen('Home');
    for (const step of [1, 2, 3]) {
      clock += 1000;
      await r.recordFrame(); // A, A (skipped: same picture), B
      void step;
    }
    r.setKeyboardOpen(true);
    clock += 1000;
    await r.recordFrame(); // paused: one marker
    clock += 1000;
    await r.recordFrame(); // still paused: no second marker
    r.setKeyboardOpen(false);
    const release = r.holdPrivacy();
    clock += 1000;
    await r.recordFrame(); // a private view is on screen: still paused, no new marker
    release();
    clock += 1000;
    await r.recordFrame(); // C
    r.screen('Account');
    clock += 1000;
    await r.recordFrame(); // excluded screen: marker
    await r.shutdown();

    const all = frames.flatMap((f) => f.frames);
    expect(all.map((f) => f.image)).toEqual([
      'data:image/jpeg;base64,A',
      'data:image/jpeg;base64,B',
      null,
      'data:image/jpeg;base64,C',
      null,
    ]);
    expect(all.map((f) => f.t)).toEqual([1000, 3000, 4000, 7000, 8000]);
    expect(n).toBe(4);
    // The session's events were uploaded first, so the frames have a session to belong to.
    expect(transport.batches[0]!.session.id).toBe(frames[0]!.sessionId);
  });

  it('takes quick extra frames after taps and scrolls, but not too often', async () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const d = { ...deps, setTimeout: (fn: () => void, ms: number) => void timers.push({ fn, ms }) };
    const transport = { ...fakeTransport(), sendFrames: async () => undefined };
    const r = new RecapCore(d);
    await r.init({ appId: 'test', transport, recordings: true }, device);
    r.screen('Home');
    expect(timers.map((x) => x.ms)).toEqual([120, 450]); // a new screen gets a burst too
    clock += 1000;
    const before = timers.length;
    r.tap({ x: 10, y: 10 });
    expect(timers.slice(before).map((x) => x.ms)).toEqual([120, 450]);
    r.scroll(10); // within 300ms of the tap: no second burst
    expect(timers.length).toBe(before + 2);
    clock += 400;
    r.scroll(20);
    expect(timers.length).toBe(before + 4);

    const plain = new RecapCore(d);
    await plain.init({ appId: 'test', transport }, device);
    const n = timers.length;
    plain.tap({ x: 1, y: 1 });
    plain.scroll(50);
    expect(timers.length).toBe(n); // recordings off: no extra frames
    await r.shutdown();
    await plain.shutdown();
  });

  it('records no frames unless switched on, and respects maxFrames', async () => {
    const got: unknown[] = [];
    const transport = { ...fakeTransport(), sendFrames: async (f: unknown) => void got.push(f) };
    const off = new RecapCore(deps);
    await off.init({ appId: 'test', transport }, device);
    off.setScreenCapture(async () => 'A');
    off.screen('Home');
    await off.recordFrame();
    await off.shutdown();
    expect(got).toHaveLength(0);

    const capped = new RecapCore(deps);
    await capped.init({ appId: 'test', transport, recordings: { maxFrames: 2 } }, device);
    let i = 0;
    capped.setScreenCapture(async () => `P${i++}`);
    capped.screen('Home');
    for (let k = 0; k < 5; k++) {
      clock += 1000;
      await capped.recordFrame();
    }
    await capped.shutdown();
    expect((got as { frames: unknown[] }[]).flatMap((f) => f.frames)).toHaveLength(2);
  });
});
