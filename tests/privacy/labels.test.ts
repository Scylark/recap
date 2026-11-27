import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractLabel,
  interactiveTarget,
  isExcluded,
  nearestHeading,
  pageName,
  setLabelMode,
  setScreenNamer,
} from '../../src/privacy/sanitize.js';
import { initClickCapture } from '../../src/capture/clicks.js';
import { initScrollCapture, resetScrollState } from '../../src/capture/scroll.js';
import { initNavigationCapture } from '../../src/capture/navigation.js';
import type { ClickEvent, NavigationEvent } from '../../src/types.js';

const html = (markup: string) => {
  document.body.innerHTML = markup;
};
const $ = (sel: string) => document.querySelector(sel)!;

afterEach(() => {
  setLabelMode('text');
  setScreenNamer(null);
  document.body.innerHTML = '';
  document.body.className = '';
  document.documentElement.className = '';
});

describe('recap-private', () => {
  it('excludes the element and everything inside it, like data-ut-no-track', () => {
    html('<section class="recap-private"><div><button id="b">Pay</button></div></section><button id="ok">OK</button>');
    expect(isExcluded($('#b'))).toBe(true);
    expect(isExcluded($('#ok'))).toBe(false);
  });

  it('stops taps inside it from being counted', () => {
    html('<div class="recap-private"><button id="b"><span id="s">Ride: Box Hill</span></button></div><button id="ok">OK</button>');
    const seen: ClickEvent[] = [];
    const stop = initClickCapture((e) => seen.push(e));
    ($('#s') as HTMLElement).click();
    ($('#ok') as HTMLElement).click();
    stop();
    expect(seen.map((e) => e.label)).toEqual(['OK']);
  });

  it('stops scroll depth on a page marked private as a whole', async () => {
    resetScrollState();
    let raf: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      raf = cb;
      return 0;
    });
    document.body.classList.add('recap-private');
    const handler = vi.fn();
    const stop = initScrollCapture(handler);
    await new Promise((r) => setTimeout(r, 0));
    window.dispatchEvent(new Event('scroll'));
    raf?.(0);
    expect(handler).not.toHaveBeenCalled();
    document.body.classList.remove('recap-private');
    window.dispatchEvent(new Event('scroll'));
    raf?.(0);
    expect(handler).toHaveBeenCalled();
    stop();
    vi.unstubAllGlobals();
  });
});

describe('label modes', () => {
  beforeEach(() => {
    html(`
      <button id="text">Delete ride</button>
      <button id="aria" aria-label="Close">×</button>
      <button id="own" data-ut-label="Save plan">Save “Tuesday intervals”</button>
      <input id="ph" placeholder="Search" />
      <span id="name">Jo Bloggs</span><button id="by" aria-labelledby="name">x</button>`);
  });

  it("'text' uses visible text after the attributes (the default)", () => {
    expect(extractLabel($('#text'))).toBe('Delete ride');
    expect(extractLabel($('#aria'))).toBe('Close');
  });

  it("'attributes' never uses visible text", () => {
    setLabelMode('attributes');
    expect(extractLabel($('#text'))).toBeNull();
    expect(extractLabel($('#aria'))).toBe('Close');
    expect(extractLabel($('#ph'))).toBe('Search');
    expect(extractLabel($('#own'))).toBe('Save plan');
  });

  it("'none' uses only data-ut-label", () => {
    setLabelMode('none');
    expect(extractLabel($('#aria'))).toBeNull();
    expect(extractLabel($('#ph'))).toBeNull();
    expect(extractLabel($('#own'))).toBe('Save plan');
  });

  it('reads aria-labelledby with several ids', () => {
    html('<span id="a">Next</span><span id="b">week</span><button id="x" aria-labelledby="a b"></button>');
    expect(extractLabel($('#x'))).toBe('Next week');
  });
});

describe('ut-mask', () => {
  it('covers aria-label, title, alt, aria-labelledby, placeholder and text, but not data-ut-label', () => {
    html(`
      <div class="ut-mask">
        <button id="aria" aria-label="Ride with Sam">x</button>
        <a id="title" href="#" title="Sam's birthday ride">x</a>
        <img id="alt" alt="Photo of Sam" />
        <input id="ph" placeholder="Sam's notes" />
        <button id="text">Sam</button>
        <button id="own" data-ut-label="Open ride">Sam's ride</button>
      </div>
      <span id="who" class="ut-mask">Sam</span><button id="by" aria-labelledby="who"></button>`);
    for (const id of ['aria', 'title', 'alt', 'ph', 'text', 'by']) {
      expect(extractLabel($(`#${id}`)), id).toBeNull();
    }
    expect(extractLabel($('#own'))).toBe('Open ride');
  });

  it('hides a masked heading', () => {
    html('<h2 class="ut-mask">Sam’s plan</h2><button id="b">Go</button>');
    expect(nearestHeading($('#b'))).toBeNull();
  });
});

describe('the element a tap is aimed at', () => {
  it('is the closest button, link or labelled element, not the icon inside it', () => {
    html(`
      <button id="btn" data-ut-label="Start workout"><svg id="icon"><path id="p"/></svg><span id="s">Start</span></button>
      <a id="link" href="/plan"><img id="img" alt="" /></a>
      <div id="card" role="button"><span id="inner">Card</span></div>
      <p id="plain">Just text</p>`);
    expect(interactiveTarget($('#p'))).toBe($('#btn'));
    expect(interactiveTarget($('#s'))).toBe($('#btn'));
    expect(interactiveTarget($('#img'))).toBe($('#link'));
    expect(interactiveTarget($('#inner'))).toBe($('#card'));
    expect(interactiveTarget($('#plain'))).toBe($('#plain'));
  });

  it("gives taps the button's label, selector and tag", () => {
    html('<button data-ut-label="Start workout"><svg><path id="p"/></svg></button>');
    const seen: ClickEvent[] = [];
    const stop = initClickCapture((e) => seen.push(e));
    $('#p').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    stop();
    expect(seen[0]).toMatchObject({
      label: 'Start workout',
      tagName: 'BUTTON',
      selector: '[data-ut-label="Start workout"]',
      dataAttributes: { 'data-ut-label': 'Start workout' },
    });
  });

  it("sends no heading text outside 'text' mode", () => {
    setLabelMode('attributes');
    html('<h2>Sam’s plan</h2><button id="b" aria-label="Go">Go</button>');
    const seen: ClickEvent[] = [];
    const stop = initClickCapture((e) => seen.push(e));
    ($('#b') as HTMLElement).click();
    stop();
    expect(seen[0]).toMatchObject({ label: 'Go', nearestHeading: null });
  });
});

describe('screenName', () => {
  it('names pages through the hook, falling back to the path', () => {
    setScreenNamer((p) => p.replace(/\.html$/, ''));
    expect(pageName('https://x.test/app/dashboard.html?ride=1')).toBe('/app/dashboard');
    setScreenNamer(() => null);
    expect(pageName('/app/rides')).toBe('/app/rides');
    setScreenNamer(() => {
      throw new Error('bad hook');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(pageName('/app/rides')).toBe('/app/rides');
    err.mockRestore();
  });

  it('is used for page views, and two paths with one name are one screen', () => {
    setScreenNamer((p) => p.replace(/\.html$/, ''));
    history.replaceState({}, '', '/app/dashboard');
    const seen: NavigationEvent[] = [];
    const stop = initNavigationCapture((e) => seen.push(e));
    history.pushState({}, '', '/app/dashboard.html'); // same screen: no page view
    history.pushState({}, '', '/app/plan.html');
    stop();
    expect(seen.map((e) => [e.method, e.from, e.to])).toEqual([
      ['pageload', '', '/app/dashboard'],
      ['pushState', '/app/dashboard', '/app/plan'],
    ]);
  });

  it('is used for taps', () => {
    setScreenNamer((p) => p.replace(/\.html$/, ''));
    history.replaceState({}, '', '/app/plan.html');
    html('<button id="b">Go</button>');
    const seen: ClickEvent[] = [];
    const stop = initClickCapture((e) => seen.push(e));
    ($('#b') as HTMLElement).click();
    stop();
    expect(seen[0]!.url).toBe('/app/plan');
  });
});
