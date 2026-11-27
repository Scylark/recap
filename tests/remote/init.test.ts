import { afterEach, describe, expect, it, vi } from 'vitest';
import { Recap } from '../../src/index';

describe('Recap.init with Supabase settings', () => {
  afterEach(() => {
    Recap.destroy();
    vi.unstubAllGlobals();
  });

  it('sends page views and custom events to recap_ingest once, as platform web', async () => {
    const bodies: { url: string; payload: { appId: string; events: { type: string }[]; session: { device: { platform: string } } } }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        bodies.push({ url, ...JSON.parse(String(init.body)) });
        return { ok: true, status: 200 } as Response;
      }),
    );
    Recap.destroy(); // undo the auto-start from importing the module
    Recap.init({ appId: 'site', supabase: { url: 'https://x.supabase.co', anonKey: 'sb_publishable_abc' }, touchTrigger: false });
    Recap.track('signed_up', { plan: 'pro' });
    await Recap.flush();
    const ingest = bodies.filter((b) => b.url.endsWith('/rpc/recap_ingest'));
    expect(ingest.length).toBeGreaterThan(0);
    expect(ingest[0]!.payload.appId).toBe('site');
    expect(ingest[0]!.payload.session.device.platform).toBe('web');
    const types = ingest.flatMap((b) => b.payload.events.map((e) => e.type));
    expect(types).toContain('screen');
    expect(types.filter((t) => t === 'custom')).toHaveLength(1);
  });

  it('sends nothing without Supabase settings', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    Recap.destroy();
    Recap.init({ touchTrigger: false });
    Recap.track('ignored');
    await Recap.flush();
    expect(f).not.toHaveBeenCalled();
  });
});
