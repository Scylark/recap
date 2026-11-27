import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initScrollCapture,
  getMaxScrollDepth,
  resetScrollState,
  pauseScrollCapture,
  resumeScrollCapture,
} from '../../src/capture/scroll.js';

// Sentinels are placed on the next tick, after the host has rendered.
const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('scroll capture', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetScrollState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes and returns a cleanup function', () => {
    const handler = vi.fn();
    const cleanup = initScrollCapture(handler);
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('cleanup removes sentinels from DOM', async () => {
    const handler = vi.fn();
    const cleanup = initScrollCapture(handler);
    await nextTick();
    const sentinelsBefore = document.querySelectorAll('[data-recap-sentinel]').length;
    expect(sentinelsBefore).toBe(4);
    cleanup();
    const sentinelsAfter = document.querySelectorAll('[data-recap-sentinel]').length;
    expect(sentinelsAfter).toBe(0);
  });

  it('getMaxScrollDepth returns 0 initially', () => {
    expect(getMaxScrollDepth()).toBe(0);
  });

  it('sentinels have correct percentage values', async () => {
    const handler = vi.fn();
    const cleanup = initScrollCapture(handler);
    await nextTick();
    const sentinels = document.querySelectorAll('[data-recap-sentinel]');
    const pcts = Array.from(sentinels).map((s) =>
      Number(s.getAttribute('data-recap-sentinel'))
    );
    expect(pcts).toEqual(expect.arrayContaining([25, 50, 75, 100]));
    cleanup();
  });

  it('places sentinels against the page as it is after a late render', async () => {
    const handler = vi.fn();
    const cleanup = initScrollCapture(handler);
    // Simulate an SPA that renders its content after init has run.
    Object.defineProperty(document.body, 'scrollHeight', { configurable: true, value: 3000 });
    await nextTick();
    const half = document.querySelector('[data-recap-sentinel="50"]') as HTMLElement;
    expect(half.style.top).toBe('1500px');
    cleanup();
    delete (document.body as unknown as Record<string, unknown>)['scrollHeight'];
  });

  it('leaves no sentinels when cleaned up before the first tick', async () => {
    const handler = vi.fn();
    const cleanup = initScrollCapture(handler);
    cleanup();
    await nextTick();
    expect(document.querySelectorAll('[data-recap-sentinel]').length).toBe(0);
  });

  it('suppresses capture while paused, and resumes after resumeScrollCapture', async () => {
    // Mirror real rAF's async ordering: `raf` is only invoked once we call it
    // ourselves, after onScroll's synchronous `ticking = true` has already run.
    // A rAF stub that calls back synchronously would run the callback (which
    // sets `ticking = false`) before that assignment, getting overwritten back
    // to `true` and permanently wedging the tracker after the first scroll.
    let raf: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      raf = cb;
      return 0;
    });
    const handler = vi.fn();
    const cleanup = initScrollCapture(handler);
    await nextTick();

    pauseScrollCapture();
    window.dispatchEvent(new Event('scroll'));
    raf?.(0);
    expect(handler).not.toHaveBeenCalled();

    resumeScrollCapture();
    window.dispatchEvent(new Event('scroll'));
    raf?.(0);
    expect(handler).toHaveBeenCalled();

    cleanup();
  });

  it('waits for <body> when started from a script in <head>', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const body = document.body;
    document.documentElement.removeChild(body);
    const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    const cleanup = initScrollCapture(vi.fn());
    await nextTick();
    expect(errors).not.toHaveBeenCalled();
    document.documentElement.appendChild(body);
    state.mockReturnValue('interactive');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await nextTick();
    expect(document.querySelectorAll('[data-recap-sentinel]').length).toBe(4);
    expect(errors).not.toHaveBeenCalled();
    cleanup();
    state.mockRestore();
    errors.mockRestore();
  });
});
