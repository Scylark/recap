import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractLabel, isExcluded, isMasked, nearestHeading, setLabelMode } from '../../src/privacy/sanitize.js';
import { initClickCapture } from '../../src/capture/clicks.js';
import { initScrollCapture, resetScrollState } from '../../src/capture/scroll.js';
import { findRecapScript, isRecapScript } from '../../src/script-tag.js';
import type { ClickEvent } from '../../src/types.js';

const html = (markup: string) => {
  document.body.innerHTML = markup;
};
const $ = (sel: string) => document.querySelector(sel)!;

afterEach(() => {
  setLabelMode('text');
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  document.body.removeAttribute('data-recap-private');
  document.documentElement.removeAttribute('data-recap-private');
  vi.unstubAllGlobals();
});

function tapsOn(...selectors: string[]): Array<string | null> {
  const seen: ClickEvent[] = [];
  const stop = initClickCapture((e) => seen.push(e));
  for (const s of selectors) ($(s) as HTMLElement).click();
  stop();
  return seen.map((e) => e.label);
}

describe('the privacy marker: data-recap-private', () => {
  it('stops taps on the element and everything inside it', () => {
    html('<section data-recap-private><div><button id="in"><span id="s">Rider: Jo</span></button></div></section><button id="ok">OK</button>');
    expect(isExcluded($('#s'))).toBe(true);
    expect(tapsOn('#s', '#in', '#ok')).toEqual(['OK']);
  });

  it('keeps the older names working: recap-private, data-ut-no-track and ut-block', () => {
    html(`
      <div class="recap-private"><button id="a">A</button></div>
      <div data-ut-no-track><button id="b">B</button></div>
      <div class="ut-block"><button id="c">C</button></div>
      <button id="ok">OK</button>`);
    expect(tapsOn('#a', '#b', '#c', '#ok')).toEqual(['OK']);
  });

  for (const where of ['html', 'body'] as const) {
    it(`on <${where}>, stops scroll depth for the page`, async () => {
      resetScrollState();
      let raf: FrameRequestCallback | null = null;
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        raf = cb;
        return 0;
      });
      const el = where === 'html' ? document.documentElement : document.body;
      el.setAttribute('data-recap-private', '');
      const handler = vi.fn();
      const stop = initScrollCapture(handler);
      await new Promise((r) => setTimeout(r, 0));
      window.dispatchEvent(new Event('scroll'));
      raf?.(0);
      expect(handler).not.toHaveBeenCalled();
      el.removeAttribute('data-recap-private');
      window.dispatchEvent(new Event('scroll'));
      raf?.(0);
      expect(handler).toHaveBeenCalled();
      stop();
    });
  }
});

describe('the mask marker: data-recap-mask', () => {
  it('keeps its text, aria-label and title out of labels, leaving only data-ut-label', () => {
    html(`
      <div data-recap-mask><button id="a" aria-label="Pay Jo Bloggs">Pay</button><button id="own" data-ut-label="Pay">Jo</button></div>
      <div class="recap-mask"><button id="b" title="Ride with Sam">Ride</button></div>
      <div class="ut-mask"><button id="c">Old name</button></div>`);
    expect(isMasked($('#a'))).toBe(true);
    expect(extractLabel($('#a'))).toBeNull();
    expect(extractLabel($('#own'))).toBe('Pay');
    expect(extractLabel($('#b'))).toBeNull();
    expect(extractLabel($('#c'))).toBeNull();
  });

  it('keeps masked headings and aria-labelledby text out', () => {
    html(`
      <h2 data-recap-mask>Jo Bloggs's rides</h2><button id="near">Open</button>
      <span id="who" class="recap-mask">Jo Bloggs</span><button id="by" aria-labelledby="who">x</button>`);
    expect(nearestHeading($('#near'))).toBeNull();
    expect(extractLabel($('#by'), 'attributes')).toBeNull();
  });
});

describe("the script tag's data-recap attribute", () => {
  it('is not a privacy or mask marker', () => {
    html('<div data-recap><button id="b" aria-label="Buy">Buy</button></div>');
    expect(isExcluded($('#b'))).toBe(false);
    expect(isMasked($('#b'))).toBe(false);
    expect(tapsOn('#b')).toEqual(['Buy']);
  });

  it('is not confused with the markers when finding Recap\'s tag', () => {
    const other = document.createElement('script');
    other.setAttribute('src', '/js/chat-widget.js');
    other.setAttribute('data-recap-private', '');
    other.setAttribute('data-recap-mask', '');
    expect(isRecapScript(other)).toBe(false);
    document.head.append(other);
    expect(findRecapScript()).toBeNull();
    const mine = document.createElement('script');
    mine.setAttribute('src', '/assets/a1b2.js');
    mine.setAttribute('data-recap', '');
    document.head.append(mine);
    expect(findRecapScript()).toBe(mine);
  });
});
