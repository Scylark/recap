import { describe, it, expect, afterEach } from 'vitest';
import {
  showScrollDepthOverlay,
  hideScrollDepthOverlay,
  updateScrollDepthOverlay,
} from '../../src/viz/scroll-depth.js';
import type { ScrollEvent } from '../../src/types.js';

function scrollEvent(maxDepth: number): ScrollEvent {
  return {
    sessionId: 'test',
    timestamp: 1,
    type: 'scroll',
    url: location.pathname,
    viewport: { width: 1440, height: 900 },
    depth: maxDepth,
    maxDepth,
  };
}

// The overlay's full-height strip is the fixed, 16px-wide element.
function overlayStrip(): HTMLDivElement {
  const el = [...document.querySelectorAll<HTMLDivElement>('div[aria-hidden="true"]')].find(
    (d) => d.style.position === 'fixed' && d.style.width === '16px'
  );
  if (!el) throw new Error('overlay not found');
  return el;
}

function labelText(): string | null {
  const el = [...document.querySelectorAll<HTMLDivElement>('div[aria-hidden="true"]')].find(
    (d) => d.style.position === 'fixed' && d.textContent?.includes('%')
  );
  return el && el.style.display !== 'none' ? el.textContent : null;
}

describe('scroll depth overlay', () => {
  afterEach(() => {
    hideScrollDepthOverlay();
  });

  it('comes back after an empty visit when that visit has scroll data', () => {
    showScrollDepthOverlay([scrollEvent(60)]);
    expect(overlayStrip().style.opacity).toBe('0.75');

    // Selecting a visit with no scrolling keeps the view on and reads 0%...
    updateScrollDepthOverlay([]);
    expect(overlayStrip().style.opacity).toBe('0.75');
    expect(labelText()).toBe('◄ 0%');

    // ...and selecting a visit with scrolling updates the reading without a toggle.
    updateScrollDepthOverlay([scrollEvent(60)]);
    expect(overlayStrip().style.opacity).toBe('0.75');
    expect(labelText()).toBe('◄ 60%');
  });

  it('reads 0% on a page with no scroll data, even if other pages have data', () => {
    showScrollDepthOverlay([scrollEvent(60)]);
    updateScrollDepthOverlay([{ ...scrollEvent(80), url: '/somewhere-else' }]);
    expect(overlayStrip().style.opacity).toBe('0.75');
    expect(labelText()).toBe('◄ 0%');
  });

  it('is hidden once switched off', () => {
    showScrollDepthOverlay([scrollEvent(60)]);
    hideScrollDepthOverlay();
    updateScrollDepthOverlay([scrollEvent(60)]);
    expect(overlayStrip().style.opacity).toBe('0');
  });
});
