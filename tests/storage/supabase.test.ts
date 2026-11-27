import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBatch,
  describeBrowser,
  pendingCount,
  sendToSupabase,
  setSupabase,
  toIngestEvents,
} from '../../src/storage/supabase.js';
import type { AnyEvent } from '../../src/types.js';

const vp = { width: 1000, height: 800 };
const events: AnyEvent[] = [
  { type: 'navigation', sessionId: 's', timestamp: 0, url: '/', viewport: vp, from: '', to: '/', method: 'pageload' },
  {
    type: 'click', sessionId: 's', timestamp: 1500, url: '/', viewport: vp,
    pageX: 500, pageY: 1200, clientX: 500, clientY: 400, elementX: 0.5, elementY: 0.5,
    selector: 'button.buy', tagName: 'BUTTON', label: 'Buy', nearestHeading: null, pageRegion: 'center',
  },
  { type: 'scroll', sessionId: 's', timestamp: 2000, url: '/', viewport: vp, depth: 50, maxDepth: 55 },
  { type: 'visibility', sessionId: 's', timestamp: 3000, url: '/', viewport: vp, state: 'hidden' },
  { type: 'resize', sessionId: 's', timestamp: 3500, url: '/', viewport: vp },
];

describe('supabase transport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps web events onto the mobile event types', () => {
    const out = toIngestEvents(events, 10_000, 9_000);
    expect(out.map((e) => e.type)).toEqual(['screen', 'tap', 'scroll', 'app_state']);
    expect(out[0]).toMatchObject({ t: 1000, screen: '/', data: { from: null, method: 'pageload' } });
    expect(out[1]!.data).toMatchObject({ x: 500, y: 400, nx: 0.5, ny: 0.5, pageY: 1200, label: 'Buy' });
    expect(out[1]!.t).toBe(2500);
    expect(out[2]!.data).toEqual({ depth: 50, maxDepth: 55 });
    expect(out[3]!.data).toEqual({ state: 'background' });
    expect(out[1]!.at).toBe(new Date(11_500).toISOString());
  });

  it('labels the session as web with a coarse browser name', () => {
    const b = buildBatch(events, { appId: 'shop-web', sessionId: 'abc', startMs: 0, timeOrigin: 0 });
    expect(b.appId).toBe('shop-web');
    expect((b.session as { device: { platform: string } }).device.platform).toBe('web');
    expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe('Safari on Mac');
    expect(describeBrowser('Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36')).toBe('Chrome on Android');
  });

  it('posts to recap_ingest with the anon key and retries failures once only', async () => {
    setSupabase({ url: 'https://x.supabase.co/', anonKey: 'sb_publishable_123', appId: 'shop-web' });
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await sendToSupabase(events.slice(0, 2), 'abc');
    expect(pendingCount()).toBe(2);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://x.supabase.co/rest/v1/rpc/recap_ingest');
    expect(init.headers.apikey).toBe('sb_publishable_123');
    expect(init.headers.Authorization).toBeUndefined();

    await sendToSupabase(events.slice(2, 3), 'abc');
    expect(pendingCount()).toBe(0);
    const sent = JSON.parse(fetchMock.mock.calls[1]![1].body).payload.events;
    expect(sent.map((e: { type: string }) => e.type)).toEqual(['screen', 'tap', 'scroll']);
  });
});
