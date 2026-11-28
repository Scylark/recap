import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Recap } from '../../src/index';
import { resetSessionId } from '../../src/capture/session';

type Body = { url: string; payload: { events?: { type: string; data: Record<string, unknown> }[] } };

const supabase = { url: 'https://x.supabase.co', anonKey: 'sb_publishable_abc' };
const tick = () => new Promise((r) => setTimeout(r, 0));

function stubFetch() {
  const bodies: Body[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      bodies.push({ url, ...JSON.parse(String(init.body)) });
      return { ok: true, status: 200 } as Response;
    }),
  );
  const events = () => bodies.filter((b) => b.url.endsWith('recap_ingest')).flatMap((b) => b.payload.events ?? []);
  return { bodies, events };
}

describe('web consent', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '<button id="b">Go</button>';
  });

  afterEach(() => {
    Recap.destroy();
    vi.unstubAllGlobals();
  });

  it('with requireConsent, records and sends nothing until optIn()', async () => {
    const { bodies, events } = stubFetch();
    Recap.init({ appId: 'site', supabase, requireConsent: true, panel: false });
    (document.getElementById('b') as HTMLElement).click();
    Recap.track('signed_up');
    await Recap.flush();
    expect(Recap.isRecording()).toBe(false);
    expect(bodies).toHaveLength(0);

    Recap.optIn();
    expect(Recap.isRecording()).toBe(true);
    Recap.track('signed_up');
    await Recap.flush();
    await tick();
    await Recap.flush();
    // The session starts on the page they were on, and nothing from before opting in is sent.
    expect(events().map((e) => e.type)).toEqual(['screen', 'custom']);
    expect(localStorage.getItem('recap-consent')).toBe('granted');
  });

  it('remembers the opt-in in this browser', async () => {
    Recap.optIn(); // before init: just remembered
    const { events } = stubFetch();
    Recap.init({ appId: 'site', supabase, requireConsent: true, panel: false });
    await Recap.flush();
    expect(events().map((e) => e.type)).toContain('screen');
  });

  it('optOut() stops sending, deletes what is waiting and forgets the browser id', async () => {
    const { events } = stubFetch();
    Recap.init({ appId: 'site', supabase, panel: false });
    await Recap.flush();
    expect(localStorage.getItem('recap-remote-anon')).not.toBeNull();
    const sent = events().length;

    Recap.track('queued_before_opt_out');
    Recap.optOut();
    (document.getElementById('b') as HTMLElement).click();
    Recap.track('after_opt_out');
    await Recap.flush();
    await tick();

    expect(events().length).toBe(sent);
    expect(Recap.isRecording()).toBe(false);
    expect(localStorage.getItem('recap-remote-anon')).toBeNull();
    expect(localStorage.getItem('recap-consent')).toBe('denied');
  });

  it('an opt-out holds on the next page, even without requireConsent', async () => {
    Recap.optOut();
    const { bodies } = stubFetch();
    Recap.init({ appId: 'site', supabase, panel: false });
    await Recap.flush();
    expect(bodies).toHaveLength(0);
    Recap.optIn();
    await Recap.flush();
    expect(bodies.length).toBeGreaterThan(0);
  });

  it('follows an opt-out made in another tab', async () => {
    const { events } = stubFetch();
    Recap.init({ appId: 'site', supabase, panel: false });
    (document.getElementById('b') as HTMLElement).click();
    await Recap.flush();
    const before = events().length;
    expect(before).toBeGreaterThan(0);
    // Another tab of the same site opts out: it writes the shared key, and this tab gets a storage event.
    localStorage.setItem('recap-consent', 'denied');
    window.dispatchEvent(new StorageEvent('storage', { key: 'recap-consent', newValue: 'denied' }));
    expect(Recap.isRecording()).toBe(false);
    (document.getElementById('b') as HTMLElement).click();
    Recap.track('after_opt_out');
    await Recap.flush();
    expect(events().length).toBe(before);
    expect(localStorage.getItem('recap-remote-anon')).toBeNull();
  });

  describe('the session in this tab', () => {
    // A fresh page load: no session id remembered by the module.
    beforeEach(() => resetSessionId());

    const sessionIds = (bodies: Body[]) =>
      bodies
        .filter((b) => b.url.endsWith('recap_ingest'))
        .map((b) => (b.payload as unknown as { session: { id: string } }).session.id);

    it('with requireConsent, no session id is written until optIn()', () => {
      stubFetch();
      Recap.init({ appId: 'site', supabase, requireConsent: true, panel: false });
      (document.getElementById('b') as HTMLElement).click();
      expect(sessionStorage.getItem('recap-session-id')).toBeNull();
      Recap.optIn();
      expect(sessionStorage.getItem('recap-session-id')).not.toBeNull();
    });

    it('after optOut(), a later optIn() in the same tab starts a new session', async () => {
      const { bodies } = stubFetch();
      const record = vi.fn(() => () => undefined);
      Recap.init({ appId: 'site', supabase, panel: false, recordings: { record } });
      await Recap.flush();
      const [first] = sessionIds(bodies);
      expect(first).toBeDefined();
      expect(sessionStorage.getItem('recap-remote-rec')).toBe('1');

      Recap.optOut();
      for (const key of ['recap-session-id', 'recap-remote-start', 'recap-remote-uploaded', 'recap-remote-sampled', 'recap-remote-rec']) {
        expect(sessionStorage.getItem(key), key).toBeNull();
      }
      (document.getElementById('b') as HTMLElement).click();
      expect(sessionStorage.getItem('recap-session-id')).toBeNull(); // nothing written while opted out

      Recap.optIn();
      await Recap.flush();
      await tick();
      await Recap.flush();
      const ids = sessionIds(bodies);
      expect(new Set(ids).size).toBe(2);
      expect(ids[ids.length - 1]).not.toBe(first);
      expect(Recap.getSessionId()).not.toBe(first);
    });

    it('an opt-out in another tab forgets this tab\'s session too', async () => {
      stubFetch();
      Recap.init({ appId: 'site', supabase, panel: false });
      await Recap.flush();
      expect(sessionStorage.getItem('recap-remote-start')).not.toBeNull();
      localStorage.setItem('recap-consent', 'denied');
      window.dispatchEvent(new StorageEvent('storage', { key: 'recap-consent', newValue: 'denied' }));
      expect(sessionStorage.getItem('recap-session-id')).toBeNull();
      expect(sessionStorage.getItem('recap-remote-start')).toBeNull();
    });
  });
});
