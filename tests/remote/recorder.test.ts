import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteSink, canvasFps, setDefaultRrwebSrc, type RemoteConfig, type RrwebEvent } from '../../src/remote/remote';
import { setScreenNamer } from '../../src/privacy/sanitize';

type Call = { url: string; payload: { events: { type: number; data: Record<string, unknown> }[] } };

function fakeFetch() {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, payload: JSON.parse(String(init.body)).payload });
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls, dom: () => calls.filter((c) => c.url.endsWith('recap_dom')).flatMap((c) => c.payload.events) };
}

const base: RemoteConfig = { appId: 'web-shop', supabase: { url: 'https://x.supabase.co', anonKey: 'sb_publishable_abc' } };
const nav = { sessionId: 's', timestamp: 0, url: '/', viewport: { width: 400, height: 800 }, type: 'navigation', from: '', to: '/', method: 'pushState' } as const;
const tick = () => new Promise((r) => setTimeout(r, 0));
const w = window as unknown as { rrweb?: { record?: unknown } };

/** The <script> tags Recap added for a recorder address. */
const scriptsFor = (src: string) => Array.from(document.querySelectorAll<HTMLScriptElement>('script')).filter((s) => s.src === src);

let n = 0;
/** A fresh address per test: loads are shared per address. */
const freshSrc = () => `https://cdn.example.test/v${++n}/recap-rrweb.min.js`;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  delete w.rrweb;
  setDefaultRrwebSrc(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete w.rrweb;
  setDefaultRrwebSrc(null);
  setScreenNamer(null);
  document.head.innerHTML = '';
});

describe('loading rrweb when recordings are on', () => {
  it('loads recap-rrweb.min.js from recordings.src for a sampled tab, then records', () => {
    const src = freshSrc();
    const sink = new RemoteSink({ ...base, recordings: { src } }, fakeFetch().fn);
    sink.start();
    const [tag] = scriptsFor(src);
    expect(tag).toBeDefined();
    expect(tag!.async).toBe(true);
    expect(sink.isRecordingPage()).toBe(false);

    const record = vi.fn(() => () => undefined);
    w.rrweb = { record };
    tag!.dispatchEvent(new Event('load'));
    return tick().then(() => {
      expect(record).toHaveBeenCalledTimes(1);
      expect(sink.isRecordingPage()).toBe(true);
      sink.stop();
    });
  });

  it('never loads it in a tab that is not sampled in', () => {
    const src = freshSrc();
    const sink = new RemoteSink({ ...base, recordings: { src, sampleRate: 0 } }, fakeFetch().fn);
    sink.start();
    expect(scriptsFor(src)).toHaveLength(0);
    sink.stop();
  });

  it('passes recordings.integrity to the script tag', () => {
    const src = freshSrc();
    const sink = new RemoteSink({ ...base, recordings: { src, integrity: 'sha384-abc' } }, fakeFetch().fn);
    sink.start();
    const [tag] = scriptsFor(src);
    expect(tag!.integrity).toBe('sha384-abc');
    expect(tag!.crossOrigin).toBe('anonymous');
    sink.stop();
  });

  it('uses the default address the script tag set, next to recap.min.js', () => {
    const src = freshSrc();
    setDefaultRrwebSrc(src);
    const sink = new RemoteSink({ ...base, recordings: true }, fakeFetch().fn);
    sink.start();
    expect(scriptsFor(src)).toHaveLength(1);
    sink.stop();
  });

  it("loads nothing when rrweb's record is given or already on the page", () => {
    setDefaultRrwebSrc(freshSrc());
    const record = vi.fn(() => () => undefined);
    w.rrweb = { record };
    const sink = new RemoteSink({ ...base, recordings: true }, fakeFetch().fn);
    sink.start();
    expect(record).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('script')).toHaveLength(0);
    sink.stop();
  });

  it('a failed load (CSP, offline) is harmless and logged in debug', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const src = freshSrc();
    const { fn, calls } = fakeFetch();
    const sink = new RemoteSink({ ...base, debug: true, recordings: { src } }, fn);
    expect(() => sink.start()).not.toThrow();
    scriptsFor(src)[0]!.dispatchEvent(new Event('error'));
    await tick();
    expect(scriptsFor(src)).toHaveLength(0); // the failed tag is removed
    expect(warn.mock.calls.some((c) => String(c[0]).includes('could not load'))).toBe(true);
    expect(sink.isRecordingPage()).toBe(false);
    // Analytics carry on as usual.
    sink.handle(nav);
    await sink.flush();
    expect(calls.filter((c) => c.url.endsWith('recap_ingest'))).toHaveLength(1);
    sink.stop();
  });

  it('does not start recording if the sink stopped while rrweb was loading', async () => {
    const src = freshSrc();
    const sink = new RemoteSink({ ...base, recordings: { src } }, fakeFetch().fn);
    sink.start();
    sink.stop();
    const record = vi.fn(() => () => undefined);
    w.rrweb = { record };
    scriptsFor(src)[0]!.dispatchEvent(new Event('load'));
    await tick();
    expect(record).not.toHaveBeenCalled();
  });

  it('in a module build without src or record, says in debug what is needed', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sink = new RemoteSink({ ...base, debug: true, recordings: true }, fakeFetch().fn);
    sink.start();
    expect(document.querySelectorAll('script')).toHaveLength(0);
    const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.includes("rrweb isn't loaded"));
    expect(line).toContain('recordings.record');
    expect(line).toContain('recordings.src');
    sink.stop();
  });
});

describe('recording options', () => {
  function optionsFor(recordings: Record<string, unknown>): Record<string, unknown> {
    const record = vi.fn(() => () => undefined);
    const sink = new RemoteSink({ ...base, recordings: { record, ...recordings } }, fakeFetch().fn);
    sink.start();
    sink.stop();
    sessionStorage.clear();
    return (record.mock.calls[0] as unknown as [Record<string, unknown>])[0];
  }

  it('leaves canvas out by default', () => {
    const o = optionsFor({});
    expect(o['recordCanvas']).toBe(false);
    expect(o['sampling']).not.toHaveProperty('canvas');
  });

  it('records canvas at 2 frames a second with canvas: true, or the number given', () => {
    expect(optionsFor({ canvas: true })).toMatchObject({ recordCanvas: true, sampling: { canvas: 2 } });
    expect(optionsFor({ canvas: 5 })).toMatchObject({ recordCanvas: true, sampling: { canvas: 5, mousemove: 50 } });
    expect(optionsFor({ canvas: 0 })['recordCanvas']).toBe(false);
    expect(canvasFps(false)).toBe(0);
    expect(canvasFps(-1)).toBe(0);
  });

  it('blocks the privacy marker, new and old names', () => {
    const block = String(optionsFor({})['blockSelector']);
    for (const s of ['[data-recap-private]', '.recap-private', '[data-ut-no-track]', '.ut-block']) expect(block).toContain(s);
    expect(String(optionsFor({ blockSelector: '.chat' })['blockSelector'])).toContain('.chat');
  });
});

describe('recorded page addresses', () => {
  async function hrefSent(config: Partial<RemoteConfig>, href: string): Promise<unknown> {
    const { fn, dom } = fakeFetch();
    const record = (opts: { emit: (e: RrwebEvent) => void }) => {
      opts.emit({ type: 4, timestamp: Date.now(), data: { href, width: 400, height: 800 } });
      return () => undefined;
    };
    const sink = new RemoteSink({ ...base, ...config, recordings: { record } }, fn);
    sink.start();
    sink.handle(nav);
    await sink.flush();
    sink.stop();
    sessionStorage.clear();
    return dom().find((e) => e.type === 4)?.data['href'];
  }

  it('drops the query string and hash from Meta events, keeping origin and path', async () => {
    expect(await hrefSent({}, 'https://shop.example/coach-rider.html?rider=abc#x')).toBe('https://shop.example/coach-rider.html');
  });

  it('keeps the query (never the hash) with stripQueryParams: false', async () => {
    expect(await hrefSent({ stripQueryParams: false }, 'https://shop.example/coach-rider.html?rider=abc#x')).toBe(
      'https://shop.example/coach-rider.html?rider=abc',
    );
  });

  it('does not run the screenName hook on it: it stays an address', async () => {
    setScreenNamer(() => 'Coach');
    expect(await hrefSent({}, 'https://shop.example/coach-rider.html?rider=abc')).toBe('https://shop.example/coach-rider.html');
  });
});

describe('full snapshot sizes in debug mode', () => {
  function sinkWith(debug: boolean) {
    const ctl: { emit: ((e: RrwebEvent) => void) | null } = { emit: null };
    const record = (opts: { emit: (e: RrwebEvent) => void }) => {
      ctl.emit = opts.emit;
      return () => undefined;
    };
    const sink = new RemoteSink({ ...base, debug, recordings: { record } }, fakeFetch().fn);
    sink.start();
    return { sink, emit: (e: RrwebEvent) => ctl.emit!(e) };
  }

  it('logs each full snapshot in KB', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { sink, emit } = sinkWith(true);
    emit({ type: 2, timestamp: Date.now(), data: { html: 'x'.repeat(50_000) } });
    emit({ type: 3, timestamp: Date.now(), data: {} });
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('full snapshot'));
    expect(lines).toEqual(['[Recap] full snapshot: 50 KB']);
    sink.stop();
  });

  it('warns above 2 MB, before the 2.5 MB limit', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sink, emit } = sinkWith(true);
    emit({ type: 2, timestamp: Date.now(), data: { html: 'x'.repeat(1_900_000) } });
    expect(warn).not.toHaveBeenCalled();
    emit({ type: 2, timestamp: Date.now(), data: { html: 'x'.repeat(2_200_000) } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('2.2 MB');
    expect(sink.isRecordingPage()).toBe(true);
    sink.stop();
  });

  it('says nothing without debug', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sink, emit } = sinkWith(false);
    emit({ type: 2, timestamp: Date.now(), data: { html: 'x'.repeat(2_200_000) } });
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    sink.stop();
  });
});

describe('secret keys in the sender itself', () => {
  it('refuses to start with a secret key', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new RemoteSink({ ...base, supabase: { url: 'https://x.supabase.co', anonKey: 'sb_secret_x' } }, fakeFetch().fn);
    expect(sink.start()).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
