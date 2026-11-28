// Demo data for `npm run demo` and the public preview. Two apps:
//   * "test-shop": the real sessions captured by the end-to-end test (SDK in an Expo app → database).
//   * "demo-shop": generated sample sessions for a fuller picture.

import type { StorageSettings } from '../lib/data';
import type { EventRow, Member, SessionRow } from '../lib/types';
import e2e from './e2e-run.json';

export interface Dataset {
  sessions: SessionRow[];
  events: EventRow[];
  members: Member[];
  screenshots: ScreenshotRow[];
  frames: FrameRow[];
  settings: StorageSettings;
}

export interface FrameRow {
  session_id: string;
  app_id: string;
  t_ms: number;
  image: string | null;
}

/** Stand-in recordings for two in three of the sample app's sessions: a frame per screen and per press, with checkout hidden for privacy. */
function demoFrames(sessions: SessionRow[], events: EventRow[]): FrameRow[] {
  const out: FrameRow[] = [];
  const cache = new Map<string, string>();
  const pic = (screen: string, pressed: string | null = null) => {
    const k = screen + '|' + (pressed ?? '');
    if (!cache.has(k)) cache.set(k, wireframe(screen, pressed));
    return cache.get(k)!;
  };
  const bySession = new Map<string, EventRow[]>();
  for (const e of events) (bySession.get(e.session_id) ?? bySession.set(e.session_id, []).get(e.session_id)!).push(e);
  let n = 0;
  for (const s of sessions) {
    if (s.app_id !== 'demo-shop') continue;
    // Every third session has no recording, as on a site that samples or has hit its recordings limit.
    if (n++ % 3 === 2) continue;
    let last: string | null | undefined;
    const add = (t: number, image: string | null) => {
      if (image === last) return;
      last = image;
      out.push({ session_id: s.id, app_id: s.app_id, t_ms: t, image });
    };
    for (const e of (bySession.get(s.id) ?? []).sort((a, b) => a.t_ms - b.t_ms)) {
      const screen = e.screen ?? 'Home';
      const hidden = screen === 'Checkout';
      if (e.type === 'screen') add(e.t_ms, hidden ? null : pic(screen));
      else if (e.type === 'tap' && !hidden) {
        add(e.t_ms, pic(screen, (e.data.label as string | null) ?? null));
        add(e.t_ms + 250, pic(screen));
      }
    }
  }
  return out;
}

export interface ScreenshotRow {
  app_id: string;
  screen: string;
  platform: string;
  app_version: string;
  width: number;
  height: number;
  image: string;
  captured_at: string;
}

function rng(seed: number) {
  let x = seed;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}

export interface Btn {
  label: string | null;
  nx: number;
  ny: number;
  to?: string;
}

export const SCREENS: Record<string, Btn[]> = {
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
  // People, each with one or more visits over four weeks, so retention has something to show.
  const plan: { start: number; anon: string; user: string | null; ios: boolean; version: string }[] = [];
  for (let u = 0; u < 70; u++) {
    const ios = r() < 0.58;
    const user = r() < 0.4 ? `usr_${4000 + u}` : null;
    const anon = `a0000000-0000-4000-8000-${String(u).padStart(12, '0')}`;
    let start = now - Math.floor(r() * 27 * 86_400_000) - 120_000;
    do {
      plan.push({ start, anon, user, ios, version: start > now - 12 * 86_400_000 ? '2.4.0' : '2.3.1' });
      start += Math.floor((0.3 + r() * 4) * 86_400_000);
    } while (start < now - 60_000 && r() < 0.62);
  }
  for (let i = 0; i < plan.length; i++) {
    const id = `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const { start, anon, user, ios, version } = plan[i]!;
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
      user_id: user,
      anonymous_id: anon,
      platform: ios ? 'ios' : 'android',
      os_version: ios ? (r() < 0.7 ? '18.1' : '17.6') : r() < 0.6 ? '15' : '14',
      device_model: ios ? (r() < 0.5 ? 'iPhone 16' : 'iPhone 14') : r() < 0.5 ? 'Pixel 9' : 'Galaxy S24',
      app_version: version,
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
  // Shift the recorded test run so it sits inside the default "last 7 days" window, behind the fuller sample app.
  const lastReal = Math.max(...real.sessions.map((s) => Date.parse(s.last_seen_at)));
  const shift = now - 2 * 86_400_000 - lastReal;
  const move = (iso: string) => new Date(Date.parse(iso) + shift).toISOString();
  const frames = demoFrames(g.sessions, g.events);
  const replayBytes = new Map<string, number>();
  for (const f of frames) replayBytes.set(f.session_id, (replayBytes.get(f.session_id) ?? 0) + (f.image?.length ?? 0));
  const withRecording = (s: SessionRow): SessionRow => {
    const replay_bytes = replayBytes.get(s.id) ?? 0;
    return { ...s, replay_bytes, dom_bytes: 0, has_recording: replay_bytes > 0 };
  };
  return {
    sessions: [
      ...g.sessions.map(withRecording),
      ...real.sessions.map(({ created_at: _c, ...s }) =>
        withRecording({ ...s, started_at: move(s.started_at), last_seen_at: move(s.last_seen_at) }),
      ),
    ],
    events: [...g.events, ...real.events.map((e) => ({ ...e, at: move(e.at) }))],
    members: [
      { email: 'demo@example.com', role: 'admin', created_at: new Date(now - 5 * 86_400_000).toISOString() },
      { email: 'design@example.com', role: 'viewer', created_at: new Date(now - 86_400_000).toISOString() },
    ],
    frames,
    settings: {
      id: 1,
      keep_days: 90,
      session_sample: 1,
      replay_sample: 1,
      max_frames: 600,
      daily_sessions: null,
      max_db_mb: 400,
      max_replay_mb: 300,
      max_visit_replay_mb: 10,
      last_purge_at: null,
      updated_at: new Date(now - 86_400_000).toISOString(),
      updated_by: null,
    },
    screenshots: Object.keys(SCREENS).map((screen) => ({
      app_id: 'demo-shop',
      screen,
      platform: 'ios',
      app_version: '1.3.0',
      width: 393,
      height: 852,
      image: wireframe(screen),
      captured_at: new Date(now - 2 * 86_400_000).toISOString(),
    })),
  };
}

/** A simple drawn stand-in for a real screen picture, built from the demo screen's buttons. */
function wireframe(screen: string, pressed: string | null = null): string {
  const W = 393;
  const H = 852;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts = [
    `<rect width="${W}" height="${H}" fill="#f6f7f9"/>`,
    `<rect width="${W}" height="96" fill="#ffffff"/>`,
    `<text x="24" y="72" font-family="system-ui,sans-serif" font-size="26" font-weight="700" fill="#1d2330">${esc(screen)}</text>`,
  ];
  for (const b of SCREENS[screen] ?? []) {
    const cx = b.nx * W;
    const cy = b.ny * H;
    const bw = b.label ? Math.min(W - 48, 60 + b.label.length * 11) : 150;
    const bh = b.label ? 52 : 110;
    const primary = !!b.to;
    const down = pressed != null && b.label === pressed;
    parts.push(
      `<rect x="${cx - bw / 2}" y="${cy - bh / 2}" width="${bw}" height="${bh}" rx="12" fill="${down ? (primary ? '#1d4fa8' : '#e2e8f0') : primary ? '#2f6fde' : '#ffffff'}" stroke="#d5d9e0"/>`,
    );
    parts.push(
      `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" fill="${primary ? '#ffffff' : '#4a5263'}">${esc(b.label ?? 'Banner')}</text>`,
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
