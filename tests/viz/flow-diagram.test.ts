import { describe, it, expect } from 'vitest';
import { generateFlowSVG } from '../../src/viz/flow-diagram.js';
import type { NavigationEvent } from '../../src/types.js';

function nav(ts: number, from: string, to: string, method: NavigationEvent['method'] = 'pushState'): NavigationEvent {
  return {
    sessionId: 'test',
    timestamp: ts,
    type: 'navigation',
    url: to,
    viewport: { width: 1440, height: 900 },
    from,
    to,
    method,
  };
}

// Home -> Phone -> Pad -> Phone (back) -> Home (back) -> Pad (skip ahead)
const session: NavigationEvent[] = [
  nav(0, '', '/', 'pageload'),
  nav(1000, '/', '/phone'),
  nav(2000, '/phone', '/pad'),
  nav(3000, '/pad', '/phone'),
  nav(4000, '/phone', '/'),
  nav(5000, '/', '/pad'),
];

describe('flow diagram', () => {
  it('says so when there are no navigations', () => {
    expect(generateFlowSVG([])).toContain('No navigation events recorded');
  });

  it('draws forward moves as solid blue lines and backtracks as dashed orange arcs', () => {
    const svg = generateFlowSVG(session);
    expect(svg).toContain('stroke="#4299e1"'); // forward
    expect(svg).toMatch(/stroke="#f6ad55"[^>]*stroke-dasharray/); // backtrack arc
  });

  it('keeps one box per page, in order of first visit', () => {
    const svg = generateFlowSVG(session);
    const boxes = svg.match(/<rect x="[\d.]+" y="[\d.]+" width="180"/g) ?? [];
    expect(boxes).toHaveLength(3);
    const home = svg.indexOf('/ (Home)');
    const phone = svg.indexOf('>/phone<');
    const pad = svg.indexOf('>/pad<');
    expect(home).toBeLessThan(phone);
    expect(phone).toBeLessThan(pad);
  });

  it('merges repeat use of the same move into one badge with its step numbers', () => {
    // Steps: 1 Home→Phone, 2 Phone→Pad, 3 Pad→Phone, 4 Phone→Home, 5 Home→Pad, 6 Pad→Phone, 7 Phone→Pad
    const repeated = [...session, nav(6000, '/pad', '/phone'), nav(7000, '/phone', '/pad')];
    const svg = generateFlowSVG(repeated);
    expect(svg).toContain('>2,7<'); // Phone→Pad, used twice, in one badge
    expect(svg).toContain('>3,6<'); // Pad→Phone, used twice, in one badge
  });

  it('uses the black background, white text and the Recap footer', () => {
    const svg = generateFlowSVG(session);
    expect(svg).toContain('fill="#09090b"');
    expect(svg).toContain('fill="#fafafa"');
    expect(svg).toContain('>www.recap-ux.com</text>');
    expect(svg).toContain('text-anchor="end"');
  });

  it('escapes page addresses', () => {
    const svg = generateFlowSVG([nav(0, '', '/a?x=<b>', 'pageload'), nav(1, '/a?x=<b>', '/c')]);
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;');
  });
});
