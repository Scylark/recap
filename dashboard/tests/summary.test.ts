import { describe, expect, it } from 'vitest';
import { mobileSummary, summaryForAI, toRecapEvents } from '../src/lib/summary';
import type { EventRow, SessionRow } from '../src/lib/types';

const session: SessionRow = {
  id: '11111111-1111-4111-8111-111111111111',
  app_id: 'demo',
  started_at: '2026-11-26T10:00:00.000Z',
  last_seen_at: '2026-11-26T10:01:00.000Z',
  user_id: null,
  platform: 'ios',
  os_version: '18.1',
  device_model: 'iPhone 16',
  app_version: '1.2.0',
  locale: 'en-GB',
  screen_width: 393,
  screen_height: 852,
  sdk_version: '0.1.0',
  event_count: 6,
  tap_count: 4,
  screen_count: 2,
  first_screen: 'Home',
  last_screen: 'Basket',
};

let id = 0;
const ev = (type: EventRow['type'], t: number, screen: string, data: Record<string, unknown>): EventRow => ({
  id: ++id, session_id: session.id, type, t_ms: t, at: session.started_at, screen, data,
});

const events: EventRow[] = [
  ev('screen', 0, 'Home', { from: null }),
  ev('tap', 2000, 'Home', { x: 196, y: 700, nx: 0.5, ny: 0.82, label: 'Shop now' }),
  ev('screen', 2300, 'Basket', { from: 'Home' }),
  ev('tap', 5000, 'Basket', { x: 300, y: 800, nx: 0.76, ny: 0.94, label: null }),
  ev('tap', 5200, 'Basket', { x: 301, y: 801, nx: 0.77, ny: 0.94, label: null }),
  ev('tap', 5400, 'Basket', { x: 300, y: 800, nx: 0.76, ny: 0.94, label: null }),
  ev('custom', 6000, 'Basket', { name: 'checkout_failed', reason: 'card' }),
];

describe('mobile summary', () => {
  it('maps screens to navigation and taps to clicks', () => {
    const out = toRecapEvents(session, events);
    expect(out[0]).toMatchObject({ type: 'navigation', method: 'pageload', to: 'Home' });
    expect(out[1]).toMatchObject({ type: 'click', label: 'Shop now', pageRegion: 'bottom-center' });
    expect(out[3]).toMatchObject({ type: 'click', pageRegion: 'bottom-right', tagName: 'tap' });
  });

  it('produces a summary with screens, rapid taps and custom events', () => {
    const s = mobileSummary(session, events);
    expect(s.meta.duration).toBe(60);
    expect(s.meta.totalClicks).toBe(4);
    expect(s.pages.map((p) => p.url)).toEqual(expect.arrayContaining(['Home', 'Basket']));
    expect(s.patterns.navigationPath).toEqual(['Home', 'Basket']);
    expect(s.patterns.rapidClicks.length).toBeGreaterThan(0);
    expect(s.customEvents[0]).toMatchObject({ name: 'checkout_failed', props: { reason: 'card' } });
    expect(s.app).toMatchObject({ platform: 'ios', appVersion: '1.2.0' });
  });

  it('renders paste-ready text with the mobile prompt', () => {
    const text = summaryForAI(session, events);
    expect(text).toContain('mobile app');
    expect(text).toContain('"Shop now"');
    expect(text).not.toContain('promptTemplate');
  });
});
