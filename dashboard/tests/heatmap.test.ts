import { describe, expect, it } from 'vitest';
import {
  aboveFoldShare,
  busiestDevice,
  depthToY,
  deviceClass,
  isDeadTap,
  layoutViewport,
  pageHeightFromTaps,
  placeWebTap,
  rageTaps,
  recordingOrder,
  scrollReach,
  toTap,
  targetsCsv,
  topTargets,
  type Anchor,
  type TapRow,
} from '../src/lib/heatmap';
import { fixViewportUnits, tallPageEvents } from '../src/lib/snapshot';

const webTap = (data: Record<string, unknown>, over: Partial<TapRow> = {}): TapRow => ({
  sessionId: 's1',
  tMs: 0,
  platform: 'web',
  vw: 390,
  vh: 844,
  data,
  ...over,
});

describe('device classes', () => {
  it('splits at the usual breakpoints', () => {
    expect(deviceClass(375)).toBe('phone');
    expect(deviceClass(599)).toBe('phone');
    expect(deviceClass(600)).toBe('tablet');
    expect(deviceClass(1023)).toBe('tablet');
    expect(deviceClass(1024)).toBe('desktop');
    expect(deviceClass(null)).toBe('phone');
  });

  it('takes the window from the tap itself before the session', () => {
    // x / nx is the window at the tap: 400 / 0.5 = 800, a tablet, though the session said 390.
    const t = toTap(webTap({ x: 400, y: 300, nx: 0.5, ny: 0.5, pageY: 1300 }));
    expect(t.vw).toBe(800);
    expect(t.vh).toBe(600);
    expect(t.device).toBe('tablet');
    expect(t.pageY).toBe(1300);
  });

  it('opens on the busiest device, phone on a tie', () => {
    const phone = toTap(webTap({ x: 100, y: 100, nx: 0.25, ny: 0.1 }));
    const desk = toTap(webTap({ x: 720, y: 100, nx: 0.5, ny: 0.1 }));
    expect(busiestDevice([phone, desk, desk])).toBe('desktop');
    expect(busiestDevice([phone, desk])).toBe('phone');
    expect(busiestDevice([])).toBe('phone');
    expect(layoutViewport([], 'desktop')).toEqual({ width: 1440, height: 900 });
  });
});

describe('placing web taps', () => {
  it('puts a tap where it was on the page, not in the first screenful', () => {
    const t = toTap(webTap({ x: 195, y: 400, nx: 0.5, ny: 400 / 844, pageY: 2400 }));
    const p = placeWebTap(t, 390, 3000);
    expect(p.x).toBeCloseTo(195);
    expect(p.y).toBeCloseTo(2400);
  });

  it('moves a tap from a narrower phone across by its share, and keeps its depth in CSS px', () => {
    const t = toTap(webTap({ x: 187.5, y: 100, nx: 0.5, ny: 100 / 812, pageY: 1000 }, { vw: 375, vh: 812 }));
    const p = placeWebTap(t, 390, 3000);
    expect(p.x).toBeCloseTo(195);
    expect(p.y).toBeCloseTo(1000);
  });

  it('does not stretch a desktop tap down a wider recording', () => {
    const t = toTap(webTap({ x: 720, y: 400, nx: 0.5, ny: 400 / 900, pageY: 3000 }, { vw: 1440, vh: 900 }));
    expect(placeWebTap(t, 1920, 6000).y).toBeCloseTo(3000);
  });

  it('takes the session window when the tap works out within 2% of it, so 1024 stays desktop', () => {
    // round(x) / nx gives 1023.3 for a 1024 px window; the session says 1024.
    const t = toTap(webTap({ x: 307, y: 100, nx: 0.3, ny: 0.125, pageY: 100 }, { vw: 1024, vh: 800 }));
    expect(t.vw).toBe(1024);
    expect(t.device).toBe('desktop');
  });

  it('draws a tap on a bar pinned to the bottom of the window on the bar, at the bottom of the page', () => {
    // Tapped 30 px above the bottom of an 844 px window, scrolled to 1500.
    const t = toTap(webTap({ x: 195, y: 814, nx: 0.5, ny: 814 / 844, pageY: 2314 }));
    const bar: Anchor = { left: 0, top: 2936, width: 390, height: 64, pinned: 'bottom' };
    const p = placeWebTap(t, 390, 3000, [bar]);
    expect(p.y).toBeCloseTo(2970);
    expect(p.onElement).toBe(true);
  });

  it('draws a tap on a bar pinned to the top at its place in the window', () => {
    const t = toTap(webTap({ x: 360, y: 28, nx: 360 / 390, ny: 28 / 844, pageY: 1828 }));
    const head: Anchor = { left: 0, top: 0, width: 390, height: 56, pinned: 'top' };
    expect(placeWebTap(t, 390, 3000, [head]).y).toBeCloseTo(28);
  });

  it('keeps a tap inside the element it hit, choosing the nearest when a selector matches several', () => {
    const t = toTap(webTap({ x: 195, y: 300, nx: 0.5, ny: 300 / 844, pageY: 1310 }));
    const rows: Anchor[] = [
      { left: 24, top: 600, width: 342, height: 52, pinned: null },
      { left: 24, top: 1240, width: 342, height: 52, pinned: null },
    ];
    const p = placeWebTap(t, 390, 3000, rows);
    expect(p.y).toBeCloseTo(1292);
    expect(p.x).toBeCloseTo(195);
  });

  it('sizes a page with no recording to its lowest tap', () => {
    const t = toTap(webTap({ x: 10, y: 100, nx: 10 / 390, ny: 100 / 844, pageY: 2000 }));
    expect(pageHeightFromTaps([t], 844)).toBe(2744);
    expect(pageHeightFromTaps([], 844)).toBe(844);
  });
});

describe('scroll reach', () => {
  it('counts each visit once, and a visit that never scrolled as 0', () => {
    const depth = new Map([
      ['a', 100],
      ['b', 50],
    ]);
    const r = scrollReach(['a', 'b', 'c', 'a'], depth);
    expect(r.map((x) => x.count)).toEqual([2, 2, 1, 1]);
    expect(r[0]!.share).toBeCloseTo(2 / 3);
  });

  it('puts a depth at the bottom of the window at that scroll', () => {
    expect(depthToY(0, 3000, 844)).toBe(844);
    expect(depthToY(50, 3000, 844)).toBe(1922);
    expect(depthToY(100, 3000, 844)).toBe(3000);
    expect(depthToY(100, 500, 844)).toBe(500);
  });
});

describe('rage and dead taps', () => {
  const at = (tMs: number, x: number, pageY: number, data: Record<string, unknown> = {}) =>
    toTap(webTap({ x, y: 300, nx: x / 390, ny: 300 / 844, pageY, ...data }, { tMs }));

  it('finds three quick taps on one spot, once', () => {
    const g = rageTaps([at(0, 100, 900), at(300, 104, 902), at(600, 98, 899), at(800, 101, 900), at(5000, 100, 900)]);
    expect(g).toHaveLength(1);
    expect(g[0]).toHaveLength(4);
  });

  it('ignores slow taps and taps far apart', () => {
    expect(rageTaps([at(0, 100, 900), at(1500, 100, 900), at(3000, 100, 900)])).toHaveLength(0);
    expect(rageTaps([at(0, 100, 900), at(200, 200, 900), at(400, 300, 900)])).toHaveLength(0);
  });

  it('does not call a control dead when the recorded page shows it is one', () => {
    const div = at(0, 1, 1, { tag: 'DIV', selector: '#card' });
    expect(isDeadTap(div)).toBe(true);
    expect(isDeadTap(div, (sel) => (sel === '#card' ? true : undefined))).toBe(false);
    expect(isDeadTap(div, () => false)).toBe(true);
  });

  it('calls a tap on a div dead, and a link, a labelled element or an app tap not', () => {
    expect(isDeadTap(at(0, 1, 1, { tag: 'DIV' }))).toBe(true);
    expect(isDeadTap(at(0, 1, 1, { tag: 'A' }))).toBe(false);
    expect(isDeadTap(at(0, 1, 1, { tag: 'DIV', label: 'Card' }))).toBe(false);
    expect(isDeadTap(toTap({ ...webTap({ x: 1, y: 1, nx: 0.1, ny: 0.1, tag: 'DIV' }), platform: 'ios' }))).toBe(false);
  });

  it('ranks elements by taps and counts the visits that tapped each', () => {
    const a = toTap(webTap({ x: 1, y: 1, nx: 0.1, ny: 0.1, label: 'Buy', tag: 'BUTTON' }, { sessionId: 'a' }));
    const b = toTap(webTap({ x: 1, y: 1, nx: 0.1, ny: 0.1, label: 'Buy', tag: 'BUTTON' }, { sessionId: 'b' }));
    const c = toTap(webTap({ x: 1, y: 1, nx: 0.1, ny: 0.1, selector: '#price', tag: 'DIV' }, { sessionId: 'a' }));
    const top = topTargets([a, b, a, c], (sel) => (sel === '#price' ? '£30' : null));
    expect(top[0]).toMatchObject({ name: 'Buy', count: 3, visits: 2, dead: false });
    expect(top[1]).toMatchObject({ name: '£30', count: 1, visits: 1, dead: true });
  });
});

describe('drawing a recorded page at full length', () => {
  it('turns window-height units into the pixels they were', () => {
    expect(fixViewportUnits('min-height:100vh;height:50dvh', 390, 844)).toBe('min-height:844px;height:422px');
    expect(fixViewportUnits('width:10vmax;height:10vmin', 390, 844)).toBe('width:84.4px;height:39px');
    expect(fixViewportUnits('margin:.5vh', 390, 844)).toBe('margin:4.22px');
    expect(fixViewportUnits('width:100vw', 390, 844)).toBe('width:100vw');
    expect(fixViewportUnits('top:-10vh;height:1.5vh', 390, 844)).toBe('top:-84.4px;height:12.66px');
  });

  it('reads a long run of digits in one pass (an uploaded page cannot freeze the tab)', () => {
    const css = 'a{height:1vh}' + '1'.repeat(20000) + 'x' + '9'.repeat(20000) + 'vh';
    const t0 = performance.now();
    const out = fixViewportUnits(css, 390, 844);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(out.startsWith('a{height:8.44px}')).toBe(true);
  });

  it('fixes style text, inlined stylesheets and style attributes without changing the original', () => {
    const node = {
      type: 0,
      id: 1,
      childNodes: [
        {
          type: 2,
          id: 2,
          tagName: 'style',
          attributes: {},
          childNodes: [{ type: 3, id: 3, textContent: '.a{height:100vh}', isStyle: true }],
        },
        { type: 2, id: 4, tagName: 'link', attributes: { _cssText: '.b{min-height:100dvh}' }, childNodes: [] },
        { type: 2, id: 5, tagName: 'div', attributes: { style: 'height:50vh' }, childNodes: [] },
      ],
    };
    const events = [
      { type: 4, timestamp: 1, data: { width: 390, height: 844 } },
      { type: 2, timestamp: 2, data: { node, initialOffset: { top: 900, left: 0 } } },
    ];
    const out = tallPageEvents(events, 390, 844);
    const fixed = (out[1]!.data as { node: typeof node; initialOffset: unknown }).node;
    expect((fixed.childNodes[0] as { childNodes: { textContent: string }[] }).childNodes[0]!.textContent).toBe('.a{height:844px}');
    expect((fixed.childNodes[1]!.attributes as Record<string, string>)._cssText).toBe('.b{min-height:844px}');
    expect((fixed.childNodes[2]!.attributes as Record<string, string>).style).toBe('height:422px');
    expect((out[1]!.data as { initialOffset: unknown }).initialOffset).toEqual({ top: 0, left: 0 });
    expect(node.childNodes[2]!.attributes).toEqual({ style: 'height:50vh' });
  });
});

describe('for reports', () => {
  it('counts the taps made without scrolling', () => {
    const top = toTap(webTap({ x: 1, y: 100, nx: 0.1, ny: 100 / 844, pageY: 100 }));
    const low = toTap(webTap({ x: 1, y: 100, nx: 0.1, ny: 100 / 844, pageY: 1600 }));
    expect(aboveFoldShare([top, low, low, top])).toBe(0.5);
    expect(aboveFoldShare([])).toBeNull();
    // A tap from a script before 1.3 has no page position: left out, not counted as above.
    const old = toTap(webTap({ x: 1, y: 100, nx: 0.1, ny: 100 / 844 }));
    expect(aboveFoldShare([old, low])).toBe(0);
    expect(aboveFoldShare([old])).toBeNull();
  });

  it('writes Most tapped as CSV that a spreadsheet will not run as a formula', () => {
    const csv = targetsCsv(
      [
        { key: 'label:Buy now', name: 'Buy now', count: 12, visits: 9, dead: false },
        { key: 'sel:#price', name: '=HYPERLINK("http://x")', count: 3, visits: 2, dead: true },
        { key: 'sel:#a', name: 'Plans, prices', count: 1, visits: 1, dead: false },
      ],
      30,
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Element,Selector or label,Taps,Visits that tapped,Share of visits,Dead tap');
    expect(lines[1]).toBe('Buy now,Buy now,12,9,30%,no');
    expect(lines[2]).toBe('"\'=HYPERLINK(""http://x"")",#price,3,2,7%,yes');
    expect(lines[3]).toBe('"Plans, prices",#a,1,1,3%,no');
  });
});

describe('which recording to draw', () => {
  it('prefers the width the taps came from (to 50 px), then the newest', () => {
    const v = (id: string, width: number, day: number) => ({ sessionId: id, tMs: 0, startedAt: `2026-11-${day}T10:00:00.000Z`, width });
    const order = recordingOrder([v('wide-new', 1920, 27), v('match-old', 1440, 20), v('match-new', 1440, 26), v('near', 1460, 27)], 1440);
    expect(order.map((o) => o.sessionId)).toEqual(['near', 'match-new', 'match-old', 'wide-new']);
  });

  it('tries each visit to a screen once', () => {
    const v = { sessionId: 'a', tMs: 5, startedAt: '2026-11-27T10:00:00.000Z' };
    expect(recordingOrder([v, { ...v }, { ...v, tMs: 9 }])).toHaveLength(2);
  });
});
