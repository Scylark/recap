import { useEffect, useMemo, useRef, useState } from 'react';
import { Replayer } from 'rrweb';
import 'rrweb/dist/style.css';
import type { PageSnapshot } from '../lib/data';
import { type Anchor, type Tap, MAX_RECORDED_WIDTH, depthToY, pageHeightFromTaps, placeWebTap, targetKey } from '../lib/heatmap';
import { elementName, tallPageEvents } from '../lib/snapshot';
import { drawHeat } from './heat';

/**
 * A web page's heatmap: the whole page as a recorded visit saw it, drawn at its full length, with
 * the taps where they landed on it, the fold (the bottom of the window when the page opens) and how
 * far down visits scrolled. Without a recording the same map is drawn on a blank page.
 */

/** What the drawn page says about a tapped element. */
export interface PageElement {
  name: string;
  /** Acts like a control though its tag isn't one: a role, a tabindex, an onclick or a pointer cursor. */
  interactive: boolean;
}

interface Props {
  taps: Tap[];
  snapshot: PageSnapshot | null;
  /** The window the taps came from (the middle of their sizes), CSS px. */
  viewport: { width: number; height: number };
  reach: { depth: number; share: number; count: number }[];
  rage: Tap[][];
  /** Tapped elements as found on the drawn page, by selector. */
  onElements?: (elements: Map<string, PageElement>) => void;
  /** Highlight the taps on one element (a selector or a label). */
  highlight?: string | null;
}

/** Pages longer than this are cut off: a canvas can't be much taller, and nobody scrolls that far. */
const MAX_PAGE = 16000;
/** Elements matched per selector, and in all: a busy page must not stall the dashboard. */
const MATCHES_PER_SELECTOR = 20;
const MATCHES_IN_ALL = 1500;
const CONTROL_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);

export function PageHeatmap({ taps, snapshot, viewport, reach, rage, onElements, highlight = null }: Props) {
  // Clamped again here: the page and its canvas are this wide, whatever a recording claims.
  const width = Math.max(200, Math.min(MAX_RECORDED_WIDTH, Math.round(snapshot?.width || viewport.width)));
  // The fold of a typical window at this size (the middle of the visits'). Depths stay in CSS px.
  const foldCss = Math.round(viewport.height) || snapshot?.height || 0;
  // The recorded visitor's own window: their 100vh is what the page was laid out with.
  const builtHeight = snapshot?.height || foldCss;
  const box = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [fit, setFit] = useState(width);
  const [built, setBuilt] = useState<{ key: string; height: number; pass: number } | null>(null);
  const [anchors, setAnchors] = useState<{ key: string; map: Map<string, Anchor[]> } | null>(null);
  const [failed, setFailed] = useState(false);
  const snapKey = snapshot ? `${snapshot.sessionId}:${snapshot.events[1]?.timestamp ?? 0}:${width}` : '';
  const page = built && built.key === snapKey ? built : null;
  const selectors = useMemo(() => [...new Set(taps.map((t) => t.selector).filter((s): s is string => !!s))], [taps]);
  const selectorsKey = selectors.join('\n');
  const anchorMap = anchors && anchors.key === `${snapKey}|${selectorsKey}` ? anchors.map : null;

  // Fit the page into the space there is.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit(el.clientWidth));
    ro.observe(el);
    setFit(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, (fit || width) / width);

  // Build the recorded page at full length, once per recording (not again when only the taps change).
  useEffect(() => {
    const el = holder.current;
    setFailed(false);
    frame.current = null;
    if (!el || !snapshot) return;
    el.innerHTML = '';
    let r: Replayer | null = null;
    const timers: number[] = [];
    try {
      const events = tallPageEvents(snapshot.events, width, builtHeight);
      r = new Replayer(events as unknown as ConstructorParameters<typeof Replayer>[0], {
        root: el,
        showWarning: false,
        mouseTail: false,
        triggerFocus: false,
        skipInactive: false,
        insertStyleRules: [
          'html, body { overflow: visible !important; scroll-behavior: auto !important; }',
          '*, *::before, *::after { animation: none !important; transition: none !important; }',
        ],
      });
      r.pause(0);
    } catch {
      setFailed(true);
      return;
    }
    const iframe = r.iframe;
    frame.current = iframe;
    let pass = 0;
    const measure = () => {
      const doc = iframe.contentDocument;
      if (!doc || !doc.documentElement) return;
      const natural = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0, builtHeight);
      const height = Math.min(MAX_PAGE, Math.round(natural));
      iframe.setAttribute('height', String(height));
      iframe.style.height = `${height}px`;
      if (iframe.parentElement) iframe.parentElement.style.height = `${height}px`;
      setBuilt({ key: snapKey, height, pass: ++pass });
    };
    // Again once fonts and pictures have loaded, which can change the page's length.
    for (const ms of [60, 600, 1800]) timers.push(window.setTimeout(measure, ms));
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      frame.current = null;
      r?.destroy();
      el.innerHTML = '';
    };
  }, [snapKey, width, builtHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Find the tapped elements on the drawn page: where they are, whether they stay on screen, their names.
  useEffect(() => {
    const iframe = frame.current;
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow;
    if (!page || !doc || !win) return;
    const map = new Map<string, Anchor[]>();
    const elements = new Map<string, PageElement>();
    let budget = MATCHES_IN_ALL;
    for (const sel of selectors) {
      if (budget <= 0) break;
      let found: Element[] = [];
      try {
        found = Array.from(doc.querySelectorAll(sel)).slice(0, Math.min(MATCHES_PER_SELECTOR, budget));
      } catch {
        continue; // a selector this page can't parse
      }
      budget -= found.length;
      const list: Anchor[] = [];
      for (const node of found) {
        const rect = node.getBoundingClientRect();
        if (!rect.width && !rect.height) continue;
        list.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, pinned: pinnedEdge(node, win, page.height) });
      }
      if (list.length) map.set(sel, list);
      if (found[0]) elements.set(sel, { name: elementName(found[0]), interactive: actsLikeControl(found[0], win) });
    }
    setAnchors({ key: `${snapKey}|${selectorsKey}`, map });
    onElements?.(elements);
  }, [page, selectorsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pageHeight = page?.height ?? Math.min(MAX_PAGE, pageHeightFromTaps(taps, foldCss));
  const placed = useMemo(
    () => taps.map((t) => placeWebTap(t, width, pageHeight, t.selector ? anchorMap?.get(t.selector) : null)),
    [taps, width, pageHeight, anchorMap],
  );
  const hot = useMemo(() => (highlight ? placed.filter((p) => targetKey(p.tap) === highlight) : []), [placed, highlight]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    drawHeat(c, placed, width, pageHeight, Math.min(28, Math.max(14, width / 24)));
  }, [placed, width, pageHeight]);

  const rageSpots = useMemo(
    () => rage.map((g) => ({ n: g.length, at: placeWebTap(g[0]!, width, pageHeight, g[0]!.selector ? anchorMap?.get(g[0]!.selector) : null) })),
    [rage, width, pageHeight, anchorMap],
  );

  return (
    <div ref={box} className="page-map-box" style={{ width: `min(100%, ${width}px)` }}>
      <div className="page-map" style={{ width: width * scale, height: pageHeight * scale }}>
        <div className="page-map-inner" style={{ width, height: pageHeight, transform: `scale(${scale})` }}>
          <div ref={holder} className="page-map-page" aria-hidden="true" />
          {(!snapshot || failed) && <div className="page-map-grid" />}
          <canvas
            ref={canvas}
            className="page-map-heat"
            style={{ width, height: pageHeight }}
            role="img"
            aria-label={`${taps.length} taps on a page ${width} px wide`}
          />
        </div>
        <div className="page-map-marks">
          {foldCss < pageHeight && (
            <div className="page-map-line fold" style={{ top: foldCss * scale }}>
              <span>Fold: seen without scrolling</span>
            </div>
          )}
          {reach
            .filter((r) => r.depth < 100 || pageHeight > foldCss)
            .map((r) => {
              const y = depthToY(r.depth, pageHeight, foldCss) * scale;
              return (
                <div key={r.depth} className="page-map-line" style={{ top: Math.max(0, y - 1) }}>
                  <span>
                    {Math.round(r.share * 100)}% {r.depth === 100 ? 'reached the end' : 'scrolled this far'}
                  </span>
                </div>
              );
            })}
          {rageSpots.map((s, i) => (
            <div key={i} className="page-map-rage" style={{ left: s.at.x * scale, top: s.at.y * scale }} title={`${s.n} quick taps in one spot`} />
          ))}
          {hot.map((p, i) => (
            <div key={i} className="page-map-hot" style={{ left: p.x * scale, top: p.y * scale }} />
          ))}
          {taps.length === 0 && <div className="page-map-empty">No taps on this screen at this size</div>}
          {failed && <div className="page-map-note">The recorded page couldn't be drawn, so the taps are on a blank page.</div>}
        </div>
      </div>
    </div>
  );
}

/** Whether an element stays put on screen while the page scrolls, and at which edge. */
function pinnedEdge(el: Element, win: Window, pageHeight: number): Anchor['pinned'] {
  let depth = 0;
  for (let n: Element | null = el; n && n !== n.ownerDocument.documentElement && depth < 25; n = n.parentElement, depth++) {
    const cs = win.getComputedStyle(n);
    if (cs.position === 'fixed') {
      const r = n.getBoundingClientRect();
      return r.top + r.height / 2 > pageHeight / 2 ? 'bottom' : 'top';
    }
    if (cs.position === 'sticky') return cs.top === 'auto' && cs.bottom !== 'auto' ? 'bottom' : 'top';
  }
  return null;
}

/** A control in all but tag: a role, a tabindex, an onclick or a pointer cursor (which the page set). */
function actsLikeControl(el: Element, win: Window): boolean {
  const role = el.getAttribute('role')?.trim().toLowerCase();
  if (role && CONTROL_ROLES.has(role)) return true;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) >= 0) return true;
  if (el.hasAttribute('onclick')) return true;
  try {
    return win.getComputedStyle(el).cursor === 'pointer';
  } catch {
    return false;
  }
}
