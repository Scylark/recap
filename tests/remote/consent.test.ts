import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Recap } from '../../src/index';

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
});
