// Demo data for `npm run demo` and the public preview. Two apps:
//   * "test-shop": the real sessions captured by the end-to-end test (SDK in an Expo app → database).
//   * "demo-shop": generated sample sessions for a fuller picture.

import type { EventRow, Member, SessionRow } from '../lib/types';
import e2e from './e2e-run.json';

export interface Dataset {
  sessions: SessionRow[];
  events: EventRow[];
  members: Member[];
}

function rng(seed: number) {
  let x = seed;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

interface Btn {
  label: string | null;
  nx: number;
  ny: number;
  to?: string;
}

const SCREENS: Record<string, Btn[]> = {
  Home: [
    { label: 'Search', nx: 0.5, ny: 0.12, to: 'Search' },
    { label: 'Featured: Trail Runner', nx: 0.5, ny: 0.42, to: 'Product' },
    { label: 'New in', nx: 0.25, ny: 0.7, to: 'Search' },
    { label: null, nx: 0.75, ny: 0.7 }, // decorative banner people tap but isn't a link
  ],
  Search: [
    { label: 'Result: Trail Runner', nx: 0.5, ny: 0.3, to: 'Product' },
    { label: 'Result: Road Racer', nx: 0.5, ny: 0.48, to: 'Product' },
    { label: 'Filter', nx: 0.85, ny: 0.1 },
  ],
  Product: [
    { label: 'Size: 9', nx: 0.35, ny: 0.62 },
    { label: 'Add to basket', nx: 0.5, ny: 0.9, to: 'Basket' },
    { label: 'Reviews', nx: 0.2, ny: 0.75 },
  ],
  Basket: [
    { label: 'Apply promo code', nx: 0.5, ny: 0.66 },
    { label: 'Checkout', nx: 0.5, ny: 0.9, to: 'Checkout' },
  ],
  Checkout: [
    { label: 'Pay with Apple Pay', nx: 0.5, ny: 0.82, to: 'Confirmation' },
    { label: 'Edit address', nx: 0.8, ny: 0.3 },
  ],
  Confirmation: [{ label: 'Done', nx: 0.5, ny: 0.9 }],
};

function generate(now: number): Pick<Dataset, 'sessions' | 'events'> {
  const r = rng(7);
  const sessions: SessionRow[] = [];
  const events: EventRow[] = [];
  let eid = 100_000;
  for (let i = 0; i < 64; i++) {
    const id = `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const ios = r() < 0.58;
    const start = now - Math.floor(r() * 6.5 * 86_400_000) - 120_000;
    const evs: EventRow[] = [];
    let t = 0;
    let screen = 'Home';
    let prev: string | null = null;
    const push = (type: EventRow['type'], data: Record<string, unknown>) =>
      evs.push({ id: ++eid, session_id: id, type, t_ms: t, at: new Date(start + t).toISOString(), screen, data });

    for (let step = 0; step < 9; step++) {
      push('screen', { from: prev });
      const buttons = SCREENS[screen]!;
      // Some people leave on each screen; checkout's address step loses the most.
      const leave = { Home: 0.12, Search: 0.18, Product: 0.22, Basket: 0.2, Checkout: 0.45, Confirmation: 1 }[screen] ?? 0.2;
      // Idle taps on the screen before acting.
      const fidget = Math.floor(r() * 3);
      for (let k = 0; k < fidget; k++) {
        t += 700 + Math.floor(r() * 2500);
        const b = buttons[Math.floor(r() * buttons.length)]!;
        if (b.to) continue;
        const rage = b.label === 'Apply promo code' && r() < 0.6 ? 3 + Math.floor(r() * 3) : 1;
        for (let z = 0; z < rage; z++) {
          push('tap', jitter(b, r));
          t += 180 + Math.floor(r() * 120);
        }
      }
      if (screen === 'Product') {
        t += 900;
        push('scroll', { depth: 50, maxDepth: 55 });
        if (r() < 0.55) {
          t += 1200;
          push('scroll', { depth: 75, maxDepth: 80 });
        }
      }
      if (r() < leave && step > 0) break;
      const next = buttons.filter((b) => b.to);
      if (!next.length) break;
      const b = next[Math.floor(r() * next.length)]!;
      t += 1200 + Math.floor(r() * 4000);
      push('tap', jitter(b, r));
      if (b.label === 'Add to basket') push('custom', { name: 'added_to_basket', sku: 'TRAIL-1' });
      if (screen === 'Checkout') push('custom', { name: 'order_completed', value: 89 });
      prev = screen;
      screen = b.to!;
      t += 250;
    }
    if (r() < 0.25) {
      t += 2000;
      push('app_state', { state: 'background' });
    }
    const screens = evs.filter((e) => e.type === 'screen');
    sessions.push({
      id,
      app_id: 'demo-shop',
      started_at: new Date(start).toISOString(),
      last_seen_at: new Date(start + t).toISOString(),
      user_id: r() < 0.4 ? `usr_${4000 + i}` : null,
      platform: ios ? 'ios' : 'android',
      os_version: ios ? (r() < 0.7 ? '18.1' : '17.6') : r() < 0.6 ? '15' : '14',
      device_model: ios ? (r() < 0.5 ? 'iPhone 16' : 'iPhone 14') : r() < 0.5 ? 'Pixel 9' : 'Galaxy S24',
      app_version: r() < 0.8 ? '2.4.0' : '2.3.1',
      locale: 'en-GB',
      screen_width: ios ? 393 : 412,
      screen_height: ios ? 852 : 915,
      sdk_version: '0.1.0',
      event_count: evs.length,
      tap_count: evs.filter((e) => e.type === 'tap').length,
      screen_count: screens.length,
      first_screen: screens[0]?.screen ?? null,
      last_screen: screens[screens.length - 1]?.screen ?? null,
    });
    events.push(...evs);
  }
  return { sessions, events };
}

function jitter(b: Btn, r: () => number) {
  const nx = Math.min(1, Math.max(0, b.nx + (r() - 0.5) * 0.12));
  const ny = Math.min(1, Math.max(0, b.ny + (r() - 0.5) * 0.04));
  return { x: Math.round(nx * 393), y: Math.round(ny * 852), nx: +nx.toFixed(3), ny: +ny.toFixed(3), label: b.label };
}

export function buildDataset(now = Date.now()): Dataset {
  const g = generate(now);
  const real = e2e as unknown as { sessions: (SessionRow & { created_at?: string })[]; events: EventRow[] };
  // Shift the recorded test run so it always sits inside the default "last 7 days" window.
  const lastReal = Math.max(...real.sessions.map((s) => Date.parse(s.last_seen_at)));
  const shift = now - 3_600_000 - lastReal;
  const move = (iso: string) => new Date(Date.parse(iso) + shift).toISOString();
  return {
    sessions: [
      ...g.sessions,
      ...real.sessions.map(({ created_at: _c, ...s }) => ({ ...s, started_at: move(s.started_at), last_seen_at: move(s.last_seen_at) })),
    ],
    events: [...g.events, ...real.events.map((e) => ({ ...e, at: move(e.at) }))],
    members: [
      { email: 'demo@example.com', role: 'admin', created_at: new Date(now - 5 * 86_400_000).toISOString() },
      { email: 'design@example.com', role: 'viewer', created_at: new Date(now - 86_400_000).toISOString() },
    ],
  };
}
