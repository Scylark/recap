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
  // A tap's own x / nx is the window at the tap; the session's size is the window when the visit began.
  // x is rounded, so x / nx is a pixel or two out (1023 or 1025 for a 1024 window, across a device
  // boundary): the session's size wins when it is within 2%, as it is unless the window was resized.
  const near = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 && Math.abs(a - b) <= b * 0.02 ? b : a ?? b);
  const vw = Math.round(near(x !== null && nx > 0.02 ? x / nx : null, num(r.vw)) ?? TYPICAL_VIEWPORT.phone.width);
  const vh = Math.round(near(y !== null && ny > 0.02 ? y / ny : null, num(r.vh)) ?? TYPICAL_VIEWPORT.phone.height);
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
 * page position in CSS px, unscaled: a wider window doesn't make a page's text taller, so scaling by
 * width put a 1440 px desktop tap at y 3000 at y 4000 on a 1920 px recording. On a bar pinned to the
 * top or bottom of the window: its distance from that edge (the drawn page shows a bottom bar at the
 * very bottom). When the tapped element is found on the drawn page the tap is kept inside it, which
 * absorbs small differences in layout between windows.
 */
export function placeWebTap(
  tap: Tap,
  width: number,
  pageHeight: number,
  anchors?: Anchor[] | null,
): Placed {
  let x = tap.nx * width;
  let y = tap.pageY ?? tap.clientY;
  const pickPinned = (a: Anchor) =>
    a.pinned === 'bottom' ? pageHeight - (tap.vh - tap.clientY) : a.pinned === 'top' ? tap.clientY : y;
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
export function pageHeightFromTaps(taps: Tap[], viewportHeight: number): number {
  let deepest = viewportHeight;
  for (const t of taps) deepest = Math.max(deepest, (t.pageY ?? t.clientY) + (t.vh - t.clientY));
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

/** What a page can be tapped to do. Anything else tapped is a "dead" tap: it looked tappable and wasn't. */
const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY', 'OPTION', 'VIDEO', 'AUDIO']);

/** Whether the element a selector found on the recorded page acts like a control (see PageHeatmap). */
export type InteractiveLookup = (selector: string) => boolean | undefined;

/**
 * A web tap on something that isn't a link, button or form field, and has no data-ut-label. The web
 * script reports the nearest link or button around what was hit, so a tap that still lands on a
 * <div> or a price found nothing to do. A <div> that is a control in other ways (role="button", a
 * tabindex, an onclick, a pointer cursor) reports its own tag, so when the recorded page shows the
 * element is one of those it isn't dead. App taps don't say what they hit, so they never count.
 */
export function isDeadTap(t: Tap, interactive?: InteractiveLookup): boolean {
  if (!t.web || !t.tag || t.label || INTERACTIVE.has(t.tag.toUpperCase())) return false;
  return !(t.selector && interactive?.(t.selector) === true);
}

export interface Target {
  key: string;
  name: string;
  count: number;
  /** Visits that tapped it at least once. */
  visits: number;
  /** Not a link, button or form field (see isDeadTap). */
  dead: boolean;
}

/** The key a tap is grouped under: its label when the page names it, else its selector. */
export const targetKey = (t: Tap): string | null => (t.label ? `label:${t.label}` : t.selector ? `sel:${t.selector}` : null);

/** Elements tapped most, by label when the page names them, else by the element's selector. */
export function topTargets(taps: Tap[], name?: (selector: string) => string | null, interactive?: InteractiveLookup): Target[] {
  const out = new Map<string, Target & { sessions: Set<string> }>();
  for (const t of taps) {
    const key = targetKey(t);
    if (!key) continue;
    let v = out.get(key);
    if (!v) {
      v = { key, name: t.label ?? (t.selector ? name?.(t.selector) ?? t.selector : ''), count: 0, visits: 0, dead: isDeadTap(t, interactive), sessions: new Set() };
      out.set(key, v);
    }
    v.count++;
    v.sessions.add(t.sessionId);
  }
  return [...out.values()]
    .map(({ sessions, ...v }) => ({ ...v, visits: sessions.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Share of taps that were above the fold of the window they were made in. Only taps that say where on
 * the page they were (web scripts from 1.3): an older tap without pageY would always read as above.
 */
export function aboveFoldShare(taps: Tap[]): number | null {
  const known = taps.filter((t) => t.web && t.pageY !== null);
  if (!known.length) return null;
  return known.filter((t) => t.pageY! < t.vh).length / known.length;
}

/**
 * Most tapped as CSV, for a report. Names come from recorded pages, which a visitor's browser wrote,
 * so a cell that a spreadsheet would run as a formula (=, +, -, @, tab, return) starts with a quote.
 */
export function targetsCsv(targets: Target[], visits: number): string {
  const cell = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['Element', 'Selector or label', 'Taps', 'Visits that tapped', 'Share of visits', 'Dead tap']];
  for (const t of targets)
    rows.push([t.name, t.key.replace(/^(label|sel):/, ''), String(t.count), String(t.visits), visits ? `${Math.round((t.visits / visits) * 100)}%` : '', t.dead ? 'yes' : 'no']);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** One visit to a screen that may have a recording of it. */
export interface RecordedVisit {
  sessionId: string;
  tMs: number;
  startedAt: string;
  /** When the same visit moved to another screen (session timeline), if it did. */
  untilMs?: number;
  /** The visit's window width, to prefer recordings at the width the taps came from. */
  width?: number | null;
}

/**
 * The order to try recordings in: nearest the taps' window width first (to the nearest 50 px), then
 * newest. Pure.
 */
export function recordingOrder(visits: RecordedVisit[], width?: number | null): RecordedVisit[] {
  const seen = new Set<string>();
  const unique = visits.filter((v) => {
    const key = `${v.sessionId}:${v.tMs}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
  const gap = (v: RecordedVisit) => (width && v.width ? Math.round(Math.abs(v.width - width) / 50) : 0);
  const at = (v: RecordedVisit) => Date.parse(v.startedAt) + v.tMs;
  return unique.sort((a, b) => gap(a) - gap(b) || at(b) - at(a));
}
