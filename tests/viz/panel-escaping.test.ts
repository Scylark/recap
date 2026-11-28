// Page paths are shown in the researcher panel as text, never as markup.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyEvent } from '../../src/types.js';

const EVIL = '/<img src=x id=injected onerror=alert(1)>';
const viewport = { width: 1440, height: 900 };
const events: AnyEvent[] = [
  { sessionId: 'session-123', timestamp: 0, type: 'navigation', url: '/', viewport, from: '', to: '/', method: 'pageload' },
  { sessionId: 'session-123', timestamp: 1000, type: 'navigation', url: EVIL, viewport, from: '/', to: EVIL, method: 'pushState' },
  { sessionId: 'session-123', timestamp: 5000, type: 'navigation', url: '/', viewport, from: EVIL, to: '/', method: 'pushState' },
];

vi.mock('../../src/storage/idb.js', () => ({
  getAllSessions: vi.fn(async () => [{ sessionId: 'session-123', startTime: 0, eventCount: 3 }]),
  getSessionEvents: vi.fn(async () => events),
  clearAllSessions: vi.fn(async () => undefined),
}));
vi.mock('../../src/storage/buffer.js', () => ({ clearBuffer: vi.fn() }));
vi.mock('../../src/capture/session.js', () => ({
  getSessionId: vi.fn(() => 'session-123'),
  getSessionName: vi.fn(() => null),
}));
vi.mock('../../src/viz/heatmap.js', () => ({
  renderHeatmap: vi.fn(),
  showHeatmap: vi.fn(),
  hideHeatmap: vi.fn(),
  isHeatmapVisible: vi.fn(() => true),
  initHeatmapCanvas: vi.fn(),
}));
vi.mock('../../src/viz/scroll-depth.js', () => ({
  showScrollDepthOverlay: vi.fn(),
  hideScrollDepthOverlay: vi.fn(),
  isScrollDepthVisible: vi.fn(() => false),
  updateScrollDepthOverlay: vi.fn(),
}));
vi.mock('../../src/viz/screenshot.js', () => ({ enterScreenshotMode: vi.fn(), downloadHeatmapPNG: vi.fn() }));
vi.mock('../../src/viz/flow-diagram.js', () => ({ downloadFlowDiagram: vi.fn(() => true) }));
vi.mock('../../src/capture/clicks.js', () => ({ pauseClickCapture: vi.fn(), resumeClickCapture: vi.fn() }));
vi.mock('../../src/capture/navigation.js', () => ({ pauseNavigationCapture: vi.fn(), resumeNavigationCapture: vi.fn() }));
vi.mock('../../src/capture/scroll.js', () => ({ pauseScrollCapture: vi.fn(), resumeScrollCapture: vi.fn() }));

import { openPanel, destroyPanel } from '../../src/viz/panel.js';
import { buildTimelineHTML } from '../../src/viz/timeline-view.js';

describe('page paths in the panel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    destroyPanel();
    history.replaceState(null, '', '/');
    document.body.innerHTML = '';
  });

  it('are escaped in the timeline rows', () => {
    const host = document.createElement('div');
    host.innerHTML = buildTimelineHTML(events, 'session-123');
    expect(host.querySelector('#injected')).toBeNull();
    expect(host.textContent).toContain(EVIL);
  });

  it('are escaped in the heatmap filter bar', async () => {
    await openPanel();
    const tab = (name: string) => document.querySelector<HTMLButtonElement>(`.recap-panel-tab[data-tab="${name}"]`)!;
    tab('timeline').click();
    const rows = document.querySelectorAll<HTMLElement>('.recap-panel-tl-row');
    expect(rows.length).toBeGreaterThan(1);
    // The visit to EVIL filters the heatmap to it. The panel then moves the page there and sends a
    // popstate, which would clear the filter here: EVIL can't be a real pathname (a screen name
    // from the screenName hook can be anything), so keep that popstate from the panel.
    const dispatch = window.dispatchEvent.bind(window);
    vi.spyOn(window, 'dispatchEvent').mockImplementation((e: Event) => (e.type === 'popstate' ? true : dispatch(e)));
    rows[1]!.click();
    tab('heatmap').click();
    const bar = document.querySelector(".recap-panel-filter-bar strong");
    expect(bar?.textContent).toBe(EVIL);
    expect(document.querySelector('#injected')).toBeNull();
  });
});
