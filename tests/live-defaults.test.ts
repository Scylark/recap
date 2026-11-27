import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The panel and its touch-hold are stubbed so these tests can see whether they were switched on.
// Everything else is real: capture, the gate and the sender (with fetch stubbed).
const panel = vi.hoisted(() => ({
  openPanel: vi.fn(async () => {}),
  closePanel: vi.fn(),
  isPanelOpen: vi.fn(() => false),
}));
const touch = vi.hoisted(() => ({ initTouchTrigger: vi.fn(() => () => {}) }));
vi.mock('../src/viz/panel.js', () => panel);
vi.mock('../src/capture/touch-trigger.js', () => touch);

import { Recap } from '../src/index';
import type { RrwebEvent } from '../src/remote/remote';

type Body = { url: string; payload: { events?: { type: string; screen: string | null; data: Record<string, unknown> }[] } };

const supabase = { url: 'https://x.supabase.co', anonKey: 'sb_publishable_abc' };
const tick = () => new Promise((r) => setTimeout(r, 0));

function stubFetch() {
  const bodies: Body[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    bodies.push({ url, ...JSON.parse(String(init.body)) });
    return { ok: true, status: 200 } as Response;
  });
  vi.stubGlobal('fetch', fn);
  const events = () => bodies.filter((b) => b.url.endsWith('recap_ingest')).flatMap((b) => b.payload.events ?? []);
  return { fn, bodies, events };
}

/** A JWT-shaped Supabase key with this role. */
function jwtKey(role: string): string {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: 'supabase', role })}.c2ln`;
}

/** A fake rrweb record function. */
function recorder() {
  const stop = vi.fn();
  const record = vi.fn((opts: { emit: (e: RrwebEvent) => void }) => {
    opts.emit({ type: 4, timestamp: Date.now(), data: { href: location.href, width: 400, height: 800 } });
    opts.emit({ type: 2, timestamp: Date.now(), data: { node: {} } });
    return stop;
  });
  return { record, stop };
}

const at = (path: string) => history.replaceState(null, '', path);
const click = () => (document.getElementById('b') as HTMLElement).click();
function altShiftY(): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Y', code: 'KeyY', altKey: true, shiftKey: true, bubbles: true, cancelable: true });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  at('/');
  document.body.innerHTML = '<button id="b">Go</button>';
});

afterEach(() => {
  Recap.destroy();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl;
  at('/');
});

describe('Recap.status()', () => {
  it("is 'not-started' before init(), then 'running'", () => {
    expect(Recap.status()).toEqual({ running: false, recording: false, reason: 'not-started' });
    Recap.init({});
    expect(Recap.status()).toEqual({ running: true, recording: false, reason: 'running' });
  });

  it('says when the page is being recorded', async () => {
    stubFetch();
    const { record } = recorder();
    Recap.init({ supabase, recordings: { record } });
    expect(record).toHaveBeenCalledTimes(1);
    expect(Recap.status()).toEqual({ running: true, recording: true, reason: 'running' });
  });

  it('logs the reason once in debug mode', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    Recap.init({ hosts: ['example.com'], debug: true });
    Recap.init({});
    Recap.status();
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('not running'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('host-not-listed');
    expect(lines[0]).toContain('localhost');
  });

  it('logs nothing about it without debug', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    Recap.init({ hosts: ['example.com'] });
    expect(log).not.toHaveBeenCalled();
  });
});

describe('hosts', () => {
  it('does nothing on a hostname that is not listed (localhost here)', async () => {
    const { fn } = stubFetch();
    Recap.init({ supabase, hosts: ['example.com', '*.example.com'] });
    click();
    Recap.track('signed_up');
    await Recap.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(Recap.isRecording()).toBe(false);
    expect(Recap.status()).toMatchObject({ running: false, reason: 'host-not-listed' });
  });

  it('starts nothing at all there, not even the panel of a local-only setup', async () => {
    Recap.init({ hosts: ['example.com'] });
    expect(touch.initTouchTrigger).not.toHaveBeenCalled();
    window.dispatchEvent(altShiftY());
    await tick();
    expect(panel.openPanel).not.toHaveBeenCalled();
  });

  it('runs on a listed hostname', async () => {
    const { events } = stubFetch();
    Recap.init({ supabase, hosts: ['localhost'] });
    await Recap.flush();
    expect(Recap.status().reason).toBe('running');
    expect(events().map((e) => e.type)).toContain('screen');
  });

  it('a later init() that lists the host starts it', () => {
    Recap.init({ hosts: ['example.com'] });
    expect(Recap.isRecording()).toBe(false);
    Recap.init({ hosts: ['example.com', 'localhost'] });
    expect(Recap.isRecording()).toBe(true);
  });
});

describe('?recap= test switches', () => {
  it('?recap=on runs regardless of hosts, sends even an unsampled session, and logs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { events } = stubFetch();
    at('/?recap=on');
    Recap.init({ hosts: ['example.com'], remote: { appId: 'site', supabase, sampleRate: 0 } });
    await Recap.flush();
    expect(Recap.status().reason).toBe('running');
    expect(events().map((e) => e.type)).toContain('screen');
    expect(log.mock.calls.some((c) => String(c[0]).startsWith('[Recap] running'))).toBe(true);
    expect(sessionStorage.getItem('recap-switch')).toBe('on');
  });

  it('?recap=record also records this tab, whatever recordings.sampleRate says', () => {
    stubFetch();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { record } = recorder();
    at('/?recap=record');
    Recap.init({ supabase, hosts: ['example.com'], recordings: { record, sampleRate: 0 } });
    expect(record).toHaveBeenCalledTimes(1);
    expect(Recap.status()).toMatchObject({ running: true, recording: true });
  });

  it('without the switch, sampleRate 0 records nothing', () => {
    stubFetch();
    const { record } = recorder();
    Recap.init({ supabase, recordings: { record, sampleRate: 0 } });
    expect(record).not.toHaveBeenCalled();
    expect(Recap.status()).toMatchObject({ running: true, recording: false });
  });

  it('?recap=off stops Recap in this tab, also on the next page, until ?recap=auto', async () => {
    const { fn } = stubFetch();
    at('/?recap=off');
    Recap.init({ supabase });
    click();
    await Recap.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(Recap.status().reason).toBe('switched-off');

    // The next page in the same tab, without the switch in the address.
    Recap.destroy();
    at('/next');
    Recap.init({ supabase });
    expect(Recap.status().reason).toBe('switched-off');

    Recap.destroy();
    at('/next?recap=auto');
    Recap.init({ supabase });
    expect(Recap.status().reason).toBe('running');
    expect(sessionStorage.getItem('recap-switch')).toBeNull();
  });
});

describe('excludePaths', () => {
  it('runs nothing on a matching page', async () => {
    const { fn } = stubFetch();
    at('/admin/users');
    Recap.init({ supabase, excludePaths: ['/admin'] });
    click();
    Recap.track('opened');
    await Recap.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(Recap.status()).toMatchObject({ running: false, reason: 'excluded-path' });
  });

  it('accepts RegExps', () => {
    at('/orders/42');
    Recap.init({ excludePaths: [/^\/orders\/\d+/] });
    expect(Recap.status().reason).toBe('excluded-path');
  });

  it('in a single-page app, stops capture on an excluded page and page recording for the rest of the page load', async () => {
    const { events } = stubFetch();
    const { record, stop } = recorder();
    Recap.init({ supabase, excludePaths: ['/account'], recordings: { record } });
    expect(record).toHaveBeenCalledTimes(1);
    await Recap.flush();

    history.pushState({}, '', '/account');
    click();
    Recap.track('account_opened');
    expect(Recap.status()).toMatchObject({ running: false, reason: 'excluded-path' });
    expect(stop).toHaveBeenCalled();

    history.pushState({}, '', '/shop');
    click();
    await Recap.flush();
    expect(Recap.status()).toEqual({ running: true, recording: false, reason: 'running' });
    const sent = events();
    expect(sent.map((e) => e.screen)).not.toContain('/account');
    expect(sent.filter((e) => e.type === 'custom')).toHaveLength(0);
    expect(sent.filter((e) => e.type === 'tap').map((e) => e.screen)).toEqual(['/shop']);
    expect(record).toHaveBeenCalledTimes(1); // not started again on this page load
  });

  it('starting on an excluded page, it begins when the app leaves it, without recording the page', async () => {
    const { events } = stubFetch();
    const { record } = recorder();
    at('/account');
    Recap.init({ supabase, excludePaths: ['/account'], recordings: { record } });
    history.pushState({}, '', '/');
    await Recap.flush();
    expect(Recap.status().reason).toBe('running');
    expect(events().map((e) => e.type)).toEqual(['screen']);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('page addresses in recordings', () => {
  async function metaHref(extra: Record<string, unknown>): Promise<unknown> {
    const { bodies } = stubFetch();
    const { record } = recorder(); // its Meta event carries location.href
    at('/coach-rider.html?rider=abc#x');
    Recap.init({ supabase, recordings: { record }, ...extra });
    await Recap.flush();
    await Recap.flush();
    const dom = bodies.filter((b) => b.url.endsWith('recap_dom')).flatMap((b) => (b.payload as unknown as { events: RrwebEvent[] }).events);
    return (dom.find((e) => e.type === 4)?.['data'] as { href?: string } | undefined)?.href;
  }

  it('keep origin and path, never the query string or hash', async () => {
    expect(await metaHref({})).toBe(`${location.origin}/coach-rider.html`);
  });

  it('keep the query string (not the hash) with stripQueryParams: false', async () => {
    expect(await metaHref({ stripQueryParams: false })).toBe(`${location.origin}/coach-rider.html?rider=abc`);
  });
});

describe('Global Privacy Control', () => {
  const gpc = () => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true });

  it('is respected by default once sending: nothing is captured', async () => {
    gpc();
    const { fn } = stubFetch();
    Recap.init({ supabase });
    click();
    await Recap.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(Recap.status()).toMatchObject({ running: false, reason: 'gpc' });
  });

  it('respectGPC: false opts out of that', async () => {
    gpc();
    const { events } = stubFetch();
    Recap.init({ supabase, respectGPC: false });
    await Recap.flush();
    expect(events().map((e) => e.type)).toContain('screen');
  });

  it('does not stop a local-only setup, where nothing leaves the browser', () => {
    gpc();
    Recap.init({});
    expect(Recap.status().reason).toBe('running');
    Recap.destroy();
    Recap.init({ respectGPC: true });
    expect(Recap.status().reason).toBe('gpc');
  });

  it('applies from connect() on', async () => {
    gpc();
    const { fn } = stubFetch();
    Recap.init({});
    Recap.connect({ appId: 'site', supabase });
    click();
    await Recap.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(Recap.status().reason).toBe('gpc');
  });
});

describe('secret keys', () => {
  it('refuses a service_role key with a console error and sends nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fn } = stubFetch();
    Recap.init({ supabase: { url: supabase.url, anonKey: jwtKey('service_role') } });
    click();
    Recap.track('x');
    await Recap.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(Recap.status()).toMatchObject({ running: false, reason: 'secret-key' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('service_role');
  });

  it('refuses an sb_secret_ key, also through connect()', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fn } = stubFetch();
    Recap.init({});
    Recap.connect({ appId: 'site', supabase: { url: supabase.url, anonKey: 'sb_secret_abc' } });
    click();
    await Recap.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(Recap.status().reason).toBe('secret-key');
    expect(String(error.mock.calls[0]![0])).toContain('sb_secret_');
  });

  it('lets the anon key through', async () => {
    const { events } = stubFetch();
    Recap.init({ supabase: { url: supabase.url, anonKey: jwtKey('anon') } });
    await Recap.flush();
    expect(events().length).toBeGreaterThan(0);
  });
});

describe('iframes', () => {
  const framed = () => vi.stubGlobal('top', {});

  it('nothing runs in a frame once sending', async () => {
    framed();
    const { fn } = stubFetch();
    Recap.init({ supabase });
    click();
    await Recap.flush();
    expect(fn).not.toHaveBeenCalled();
    expect(Recap.status().reason).toBe('in-frame');
  });

  it('allowInFrames: true runs there', async () => {
    framed();
    const { events } = stubFetch();
    Recap.init({ supabase, allowInFrames: true });
    await Recap.flush();
    expect(events().map((e) => e.type)).toContain('screen');
  });

  it('a local-only setup still runs in frames (prototypes inside artefacts)', () => {
    framed();
    Recap.init({});
    expect(Recap.status().reason).toBe('running');
  });
});

describe('the panel once sending to a dashboard', () => {
  it('is off by default: no panel, shortcut or touch-hold', async () => {
    stubFetch();
    Recap.init({ supabase, showPanel: true });
    expect(touch.initTouchTrigger).not.toHaveBeenCalled();
    window.dispatchEvent(altShiftY());
    await tick();
    expect(panel.openPanel).not.toHaveBeenCalled();
  });

  it('panel: true turns it on', async () => {
    stubFetch();
    Recap.init({ supabase, panel: true });
    expect(touch.initTouchTrigger).toHaveBeenCalledTimes(1);
    window.dispatchEvent(altShiftY());
    await vi.waitFor(() => expect(panel.openPanel).toHaveBeenCalledTimes(1));
  });

  it('connect() after init() turns it off', async () => {
    stubFetch();
    const stopTouch = vi.fn();
    touch.initTouchTrigger.mockImplementation(() => stopTouch);
    Recap.init({});
    expect(touch.initTouchTrigger).toHaveBeenCalledTimes(1);
    Recap.connect({ appId: 'site', supabase });
    expect(stopTouch).toHaveBeenCalled();
    window.dispatchEvent(altShiftY());
    await tick();
    expect(panel.openPanel).not.toHaveBeenCalled();
    touch.initTouchTrigger.mockImplementation(() => () => {});
  });

  it("uses 'attributes' tap labels, as before", async () => {
    const { events } = stubFetch();
    document.body.innerHTML = '<button id="b" aria-label="Checkout">Jo Bloggs basket</button>';
    Recap.init({ supabase });
    click();
    await Recap.flush();
    await tick();
    await Recap.flush();
    expect(events().find((e) => e.type === 'tap')?.data['label']).toBe('Checkout');
  });
});
