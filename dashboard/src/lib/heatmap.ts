/**
 * Heatmaps for websites: where taps landed on the whole page, not just the part of it on screen.
 *
 * A web tap carries its position in the window (x, y, and nx/ny as shares of the window) and how far
 * down the page it was (pageY). The phone SDK's taps are shares of the screen, which is right for an
 * app screen, but on a web page that scrolls it folds every tap into the first screenful. Here web
 * taps go where they were on the page, at the layout width of the device class they came from, and
 * taps on a fixed bar (a bottom tab bar, a top header) go where the bar is drawn.
 *
 * Pure functions: the page itself (the newest recording of the screen) is drawn by PageHeatmap.
 */

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

export const DEVICE_CLASSES: { key: DeviceClass; label: string }[] = [
  { key: 'phone', label: 'Phone' },
  { key: 'tablet', label: 'Tablet' },
  { key: 'desktop', label: 'Desktop' },
];

/** Typical window sizes, used when a session didn't say its own. */
export const TYPICAL_VIEWPORT: Record<DeviceClass, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
};

/** Phone below 600 px wide, tablet below 1024, desktop above: the usual breakpoints. */
export function deviceClass(width: number | null | undefined): DeviceClass {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 'phone';
  if (w < 600) return 'phone';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

/** One tap as stored, with what its session said about the device. */
export interface TapRow {
  sessionId: string;
  tMs: number;
  platform: string | null;
  /** The window (web) or screen (apps) size the session reported. */
  vw: number | null;
  vh: number | null;
  data: Record<string, unknown>;
}

/** A tap ready to place. */
export interface Tap {
  sessionId: string;
  tMs: number;
  web: boolean;
  device: DeviceClass;
  /** Shares of the window or screen. */
  nx: number;
  ny: number;
  /** CSS px in the window, and down the page (web). */
  clientX: number;
  clientY: number;
  pageY: number | null;
  vw: number;
  vh: number;
  selector: string | null;
  label: string | null;
  tag: string | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function toTap(r: TapRow): Tap {
  const d = r.data ?? {};
  const web = r.platform === 'web';
  const nx = clamp(num(d.nx) ?? 0, 0, 1);
  const ny = clamp(num(d.ny) ?? 0, 0, 1);
  const x = num(d.x);
  const y = num(d.y);
  // The session's size is the window when the visit started; a tap's own x / nx is the window at the tap.
  const vwFromTap = x !== null && nx > 0.02 ? x / nx : null;
  const vhFromTap = y !== null && ny > 0.02 ? y / ny : null;
  const vw = Math.round(vwFromTap ?? num(r.vw) ?? TYPICAL_VIEWPORT.phone.width);
  const vh = Math.round(vhFromTap ?? num(r.vh) ?? TYPICAL_VIEWPORT.phone.height);
  const pageY = web ? num(d.pageY) : null;
  return {
    sessionId: r.sessionId,
    tMs: r.tMs,
    web,
    device: deviceClass(vw),
    nx,
    ny,
    clientX: x ?? nx * vw,
    clientY: y ?? ny * vh,
    pageY: pageY !== null && pageY >= 0 ? pageY : null,
    vw,
    vh,
    selector: str(d.selector),
    label: str(d.label),
    tag: str(d.tag),
  };
}

export function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export function countByDevice(taps: Tap[]): Record<DeviceClass, number> {
  const out: Record<DeviceClass, number> = { phone: 0, tablet: 0, desktop: 0 };
  for (const t of taps) out[t.device]++;
  return out;
}

/** The device class to open on: the one with the most taps (phone on a tie, as most visits are). */
export function busiestDevice(taps: Tap[]): DeviceClass {
  const c = countByDevice(taps);
  return DEVICE_CLASSES.map((d) => d.key).reduce((best, k) => (c[k] > c[best] ? k : best), 'phone' as DeviceClass);
}

/** The window the map is drawn for: the middle of the windows the taps came from. */
export function layoutViewport(taps: Tap[], device: DeviceClass): { width: number; height: number } {
  const w = median(taps.map((t) => t.vw));
  const h = median(taps.map((t) => t.vh));
  const typical = TYPICAL_VIEWPORT[device];
  return { width: Math.round(w ?? typical.width), height: Math.round(h ?? typical.height) };
}

/** Where an element sits on the drawn page, and whether it stays put while the page scrolls. */
export interface Anchor {
  left: number;
  top: number;
  width: number;
  height: number;
  /** 'top' / 'bottom': fixed or sticky to that edge of the window. */
  pinned: 'top' | 'bottom' | null;
}

export interface Placed {
  x: number;
  y: number;
  tap: Tap;
  /** True when the tap was matched to an element on the drawn page. */
  onElement: boolean;
}

/**
 * Where a web tap goes on a page drawn `width` px wide and `pageHeight` px tall.
 *
 * Across the page: its share of the window, so taps from 375 and 430 px phones line up. Down: its
 * page position, or, on a bar pinned to the top or bottom of the window, its distance from that edge
 * (the drawn page shows a bottom bar at the very bottom). When the tapped element is found on the
 * drawn page the tap is kept inside it, which absorbs small differences in layout between phones.
 */
export function placeWebTap(
  tap: Tap,
  width: number,
  pageHeight: number,
  anchors?: Anchor[] | null,
): Placed {
  const scale = tap.vw > 0 ? width / tap.vw : 1;
  let x = tap.nx * width;
  let y = (tap.pageY ?? tap.clientY) * scale;
  const pickPinned = (a: Anchor) =>
    a.pinned === 'bottom' ? pageHeight - (tap.vh - tap.clientY) * scale : a.pinned === 'top' ? tap.clientY * scale : y;
  let onElement = false;
  if (anchors && anchors.length) {
    // Several elements can share a selector (rows in a list): take the one nearest the tap.
    let best: Anchor | null = null;
    let bestD = Infinity;
    for (const a of anchors) {
      const ty = pickPinned(a);
      const dx = x < a.left ? a.left - x : x > a.left + a.width ? x - a.left - a.width : 0;
      const dy = ty < a.top ? a.top - ty : ty > a.top + a.height ? ty - a.top - a.height : 0;
      const d = dx * dx + dy * dy;
      if (d < bestD) (bestD = d), (best = a);
    }
    if (best) {
      y = pickPinned(best);
      x = clamp(x, best.left, best.left + best.width);
      y = clamp(y, best.top, best.top + best.height);
      onElement = true;
    }
  }
  return { x: clamp(x, 0, width), y: clamp(y, 0, Math.max(0, pageHeight)), tap, onElement };
}

/** How tall to draw a page with no recording: deep enough for the lowest tap, and at least a window. */
export function pageHeightFromTaps(taps: Tap[], width: number, viewportHeight: number): number {
  let deepest = viewportHeight;
  for (const t of taps) {
    const scale = t.vw > 0 ? width / t.vw : 1;
    deepest = Math.max(deepest, ((t.pageY ?? t.clientY) + (t.vh - t.clientY)) * scale);
  }
  return Math.round(deepest);
}

/**
 * How far down the page visits got: for each depth, the share of visits to this screen that
 * scrolled at least that far. Scroll depth is a share of the scrollable distance, as the SDK reports
 * it (0 at the top, 100 with the bottom of the page on screen). A visit that never scrolled counts
 * as 0, and a page shorter than the window counts as seen in full.
 */
export function scrollReach(
  visits: string[],
  maxDepth: Map<string, number>,
  depths: number[] = [25, 50, 75, 100],
): { depth: number; share: number; count: number }[] {
  const unique = [...new Set(visits)];
  const n = unique.length;
  return depths.map((depth) => {
    const count = unique.filter((s) => (maxDepth.get(s) ?? 0) >= depth).length;
    return { depth, count, share: n ? count / n : 0 };
  });
}

/** Where on the drawn page a scroll depth puts the bottom of the window. */
export function depthToY(depth: number, pageHeight: number, viewportHeight: number): number {
  const scrollable = Math.max(0, pageHeight - viewportHeight);
  return Math.min(pageHeight, viewportHeight + (scrollable * clamp(depth, 0, 100)) / 100);
}

/**
 * Taps in quick succession on the same spot: someone tapping something that didn't respond.
 * Three or more taps within a second and 30 px of each other in one visit count as one rage tap.
 */
export function rageTaps(taps: Tap[], windowMs = 1000, radius = 30, min = 3): Tap[][] {
  const bySession = new Map<string, Tap[]>();
  for (const t of taps) {
    const list = bySession.get(t.sessionId) ?? [];
    list.push(t);
    bySession.set(t.sessionId, list);
  }
  const out: Tap[][] = [];
  for (const list of bySession.values()) {
    list.sort((a, b) => a.tMs - b.tMs);
    let i = 0;
    while (i < list.length) {
      const group = [list[i]!];
      let j = i + 1;
      while (j < list.length) {
        const prev = group[group.length - 1]!;
        const t = list[j]!;
        const dy = (t.pageY ?? t.clientY) - (prev.pageY ?? prev.clientY);
        if (t.tMs - prev.tMs <= windowMs && Math.hypot(t.clientX - prev.clientX, dy) <= radius) {
          group.push(t);
          j++;
        } else break;
      }
      if (group.length >= min) out.push(group);
      i = group.length >= min ? j : i + 1;
    }
  }
  return out;
}

/** Elements tapped most, by label when the page names them, else by the element's selector. */
export function topTargets(taps: Tap[], name?: (selector: string) => string | null): { key: string; name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const t of taps) {
    const key = t.label ? `label:${t.label}` : t.selector ? `sel:${t.selector}` : null;
    if (!key) continue;
    const prev = counts.get(key);
    if (prev) prev.count++;
    else counts.set(key, { name: t.label ?? (t.selector ? name?.(t.selector) ?? t.selector : ''), count: 1 });
  }
  return [...counts.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count);
}
