import { describe, it, expect } from 'vitest';
import { eventsInVisit, generateTimeline, visitWindowMs } from '../../src/analysis/timeline.js';
import type { AnyEvent, NavigationEvent } from '../../src/types.js';

// --- Event factories ---

function nav(ts: number, from: string, to: string, method: NavigationEvent['method'] = 'pushState'): AnyEvent {
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

function click(ts: number, url: string): AnyEvent {
  return {
    sessionId: 'test',
    timestamp: ts,
    type: 'click',
    url,
    viewport: { width: 1440, height: 900 },
    pageX: 100, pageY: 200, clientX: 100, clientY: 200,
    elementX: 0.5, elementY: 0.5,
    selector: 'button',
    tagName: 'BUTTON',
    label: null,
    nearestHeading: null,
    pageRegion: 'center',
  };
}

// --- Tests ---

describe('generateTimeline — empty events', () => {
  it('returns empty array', () => {
    expect(generateTimeline([])).toEqual([]);
  });
});

describe('generateTimeline — single page session', () => {
  const events: AnyEvent[] = [
    click(0, '/dashboard'),
    click(5000, '/dashboard'),
  ];

  it('returns one entry', () => {
    const result = generateTimeline(events);
    expect(result).toHaveLength(1);
  });

  it('sets arrivalTime to 0', () => {
    const [entry] = generateTimeline(events);
    expect(entry!.arrivalTime).toBe(0);
  });

  it('calculates duration from first to last event', () => {
    const [entry] = generateTimeline(events);
    expect(entry!.duration).toBe(5); // 5000ms = 5s
  });

  it('tags end of session', () => {
    const [entry] = generateTimeline(events);
    expect(entry!.tags).toContain('end of session');
  });

  it('does not tag end of session for current session', () => {
    const [entry] = generateTimeline(events, true);
    expect(entry!.tags).not.toContain('end of session');
    expect(entry!.duration).toBeNull();
  });
});

describe('generateTimeline — linear session (no backtracks)', () => {
  const events: AnyEvent[] = [
    nav(0, '', '/dashboard', 'pageload'),
    click(3000, '/dashboard'),
    nav(8000, '/dashboard', '/reports'),
    click(12000, '/reports'),
    nav(22000, '/reports', '/reports/filter'),
    click(24000, '/reports/filter'),
  ];

  const result = generateTimeline(events);

  it('returns 3 entries', () => {
    expect(result).toHaveLength(3);
  });

  it('first entry is dashboard with arrivalTime near 0', () => {
    expect(result[0]!.pagePath).toBe('/dashboard');
    expect(result[0]!.arrivalTime).toBeCloseTo(0, 1);
  });

  it('second entry has first task tag', () => {
    expect(result[1]!.pagePath).toBe('/reports');
    expect(result[1]!.tags).toContain('first task');
  });

  it('no backtrack tags in linear session', () => {
    expect(result.some(v => v.tags.includes('backtrack'))).toBe(false);
  });

  it('all visit numbers are 1', () => {
    expect(result.every(v => v.visitNumber === 1)).toBe(true);
  });

  it('durations are correct', () => {
    expect(result[0]!.duration).toBeCloseTo(8, 1);  // 8000ms
    expect(result[1]!.duration).toBeCloseTo(14, 1); // 14000ms
    // Last entry: from last nav to last event = 24000-22000 = 2000ms
    expect(result[2]!.duration).toBeCloseTo(2, 1);
  });

  it('last entry has end of session tag', () => {
    expect(result[2]!.tags).toContain('end of session');
  });
});

describe('generateTimeline — backtrack session (A → B → A)', () => {
  const events: AnyEvent[] = [
    nav(0, '', '/dashboard', 'pageload'),
    nav(8000, '/dashboard', '/reports'),
    nav(22000, '/reports', '/dashboard', 'popstate'),
  ];

  const result = generateTimeline(events);

  it('returns 3 entries', () => {
    expect(result).toHaveLength(3);
  });

  it('second /dashboard visit has backtrack tag', () => {
    const revisit = result[2]!;
    expect(revisit.pagePath).toBe('/dashboard');
    expect(revisit.isRevisit).toBe(true);
    expect(revisit.visitNumber).toBe(2);
    expect(revisit.tags).toContain('backtrack');
  });

  it('first /dashboard visit has no backtrack tag', () => {
    expect(result[0]!.tags).not.toContain('backtrack');
    expect(result[0]!.isRevisit).toBe(false);
    expect(result[0]!.visitNumber).toBe(1);
  });
});

describe('generateTimeline — multiple revisits (A → B → A → C → A)', () => {
  const events: AnyEvent[] = [
    nav(0, '', '/dashboard', 'pageload'),
    nav(10000, '/dashboard', '/reports'),
    nav(20000, '/reports', '/dashboard', 'popstate'),
    nav(30000, '/dashboard', '/search'),
    nav(40000, '/search', '/dashboard', 'popstate'),
  ];

  const result = generateTimeline(events);

  it('returns 5 entries', () => {
    expect(result).toHaveLength(5);
  });

  it('tracks visit numbers correctly for /dashboard', () => {
    const visits = result.filter(v => v.pagePath === '/dashboard');
    expect(visits.map(v => v.visitNumber)).toEqual([1, 2, 3]);
  });

  it('both revisits to /dashboard are tagged backtrack', () => {
    const revisits = result.filter(v => v.pagePath === '/dashboard' && v.visitNumber > 1);
    expect(revisits).toHaveLength(2);
    revisits.forEach(v => expect(v.tags).toContain('backtrack'));
  });
});

describe('generateTimeline — long pause and brief visit', () => {
  const events: AnyEvent[] = [
    nav(0, '', '/dashboard', 'pageload'),
    nav(35000, '/dashboard', '/reports'),  // 35s = long pause
    nav(36500, '/reports', '/checkout'),   // 1.5s = brief visit
    click(50000, '/checkout'),
  ];

  const result = generateTimeline(events);

  it('tags long pause correctly', () => {
    expect(result[0]!.pagePath).toBe('/dashboard');
    expect(result[0]!.duration).toBeCloseTo(35, 1);
    expect(result[0]!.tags).toContain('long pause');
  });

  it('tags brief visit correctly', () => {
    expect(result[1]!.pagePath).toBe('/reports');
    expect(result[1]!.duration).toBeCloseTo(1.5, 1);
    expect(result[1]!.tags).toContain('brief visit');
  });

  it('does not tag the last entry as brief visit', () => {
    // Last entry is /checkout — short duration shouldn't get brief visit
    const last = result[result.length - 1]!;
    expect(last.tags).not.toContain('brief visit');
  });
});

describe('generateTimeline — current session (in progress)', () => {
  const events: AnyEvent[] = [
    nav(0, '', '/dashboard', 'pageload'),
    nav(8000, '/dashboard', '/reports'),
    click(10000, '/reports'),
  ];

  const result = generateTimeline(events, true);

  it('last entry has null duration', () => {
    expect(result[result.length - 1]!.duration).toBeNull();
  });

  it('last entry has no end of session tag', () => {
    expect(result[result.length - 1]!.tags).not.toContain('end of session');
  });

  it('non-last entries still have durations', () => {
    expect(result[0]!.duration).toBeCloseTo(8, 1);
  });
});

describe('generateTimeline — pageload first nav', () => {
  const events: AnyEvent[] = [
    nav(500, '', '/dashboard', 'pageload'),
    nav(8500, '/dashboard', '/reports'),
  ];

  const result = generateTimeline(events);

  it('first entry arrivalTime is 0', () => {
    expect(result[0]!.arrivalTime).toBe(0);
  });

  it('second entry arrivalTime is 8s', () => {
    expect(result[1]!.arrivalTime).toBeCloseTo(8, 1);
  });
});

describe('visit windows select the clicks for one visit', () => {
  // Session: home at 1000ms, phone 3000-6000 then again 8000-end, pad in between.
  // Clicks use absolute timestamps, the same clock as the navigation events.
  const events: AnyEvent[] = [
    nav(1000, '', '/', 'pageload'),
    nav(3000, '/', '/phone'),
    click(3500, '/phone'),
    nav(6000, '/phone', '/pad'),
    click(6200, '/pad'),
    nav(8000, '/pad', '/phone'),
    click(8500, '/phone'),
    click(9000, '/phone'),
  ];

  function clicksFor(visitIndex: number): number[] {
    const visits = generateTimeline(events);
    const sessionStartMs = Math.min(...events.map((e) => e.timestamp));
    const isLast = visitIndex === visits.length - 1;
    const range = visitWindowMs(visits[visitIndex]!, sessionStartMs, isLast);
    return events
      .filter((e): e is AnyEvent & { type: 'click' } => e.type === 'click')
      .filter((c) => c.url === visits[visitIndex]!.pagePath)
      .filter((c) => c.timestamp >= range.visitStartMs && (range.visitEndMs === null || c.timestamp < range.visitEndMs))
      .map((c) => c.timestamp);
  }

  it('first visit to /phone contains only its own click', () => {
    expect(clicksFor(1)).toEqual([3500]);
  });

  it('second visit to /phone contains only its own clicks, including the final one', () => {
    expect(clicksFor(3)).toEqual([8500, 9000]);
  });
});

describe('per-visit scroll depth', () => {
  // First /phone visit scrolls to the bottom; the second visit does not scroll at all.
  const events: AnyEvent[] = [
    nav(1000, '', '/phone', 'pageload'),
    { sessionId: 'test', timestamp: 1500, type: 'scroll', url: '/phone', viewport: { width: 1440, height: 900 }, depth: 100, maxDepth: 100 },
    nav(3000, '/phone', '/pad'),
    nav(5000, '/pad', '/phone'),
    click(5500, '/phone'),
  ];

  function maxDepthFor(visitIndex: number): number {
    const visits = generateTimeline(events);
    const start = Math.min(...events.map((e) => e.timestamp));
    const range = visitWindowMs(visits[visitIndex]!, start, visitIndex === visits.length - 1);
    return eventsInVisit(events, { pagePath: visits[visitIndex]!.pagePath, ...range })
      .filter((e): e is AnyEvent & { type: 'scroll' } => e.type === 'scroll')
      .reduce((m, e) => Math.max(m, e.depth), 0);
  }

  it('the visit that scrolled reports its depth', () => {
    expect(maxDepthFor(0)).toBe(100);
  });

  it('a later visit with no scrolling reports 0, not the earlier visit\'s 100', () => {
    expect(maxDepthFor(2)).toBe(0);
  });
});
