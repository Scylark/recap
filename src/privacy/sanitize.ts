// Privacy sanitization — URL stripping, element masking, PII guards.

/**
 * Strip query params and hash from a URL (they often contain tokens/PII).
 * Returns pathname only.
 */
export function sanitizeUrl(rawUrl: string, stripQuery = true): string {
  try {
    // Handle relative paths and full URLs
    const base = typeof location !== 'undefined' ? location.href : 'https://localhost';
    const url = new URL(rawUrl, base);
    if (stripQuery) {
      return url.pathname;
    }
    return url.pathname + url.search;
  } catch {
    // Fallback: strip query manually
    return rawUrl.split('?')[0]?.split('#')[0] ?? rawUrl;
  }
}

/**
 * A page address for a recording: origin and path, with the query string only when it is kept
 * (`stripQuery` false) and never the hash. Same rules as sanitizeUrl, plus the origin, because the
 * Replayer needs an absolute address to load the page's relative images and stylesheets. Never
 * passed through the screenName hook: it must stay an address.
 */
export function sanitizeHref(rawUrl: string, stripQuery = true): string {
  try {
    const base = typeof location !== 'undefined' ? location.href : 'https://localhost';
    const url = new URL(rawUrl, base);
    return url.origin + sanitizeUrl(url.href, stripQuery);
  } catch {
    return sanitizeUrl(rawUrl, true);
  }
}

/**
 * The privacy marker: elements (and everything inside them) that are never tracked. No taps are
 * counted there, they are left out of recordings, and on <html> or <body> scroll depth stops too.
 * `data-recap-private` and `class="recap-private"` are the documented names; `data-ut-no-track`
 * and `ut-block` are older names that keep working. (The script tag's own `data-recap`
 * attribute is a different attribute and marks nothing.)
 */
export const EXCLUDE_SELECTOR = '[data-recap-private], .recap-private, [data-ut-no-track], .ut-block';

/**
 * Text that is never used: not in tap labels or headings, and replaced with * in recordings.
 * `data-recap-mask` and `class="recap-mask"` are the documented names; `ut-mask` keeps working.
 */
export const MASK_SELECTOR = '[data-recap-mask], .recap-mask, .ut-mask';

/**
 * Return true if an element should be completely excluded from tracking: it, or an element around
 * it, has the privacy marker (data-recap-private or class recap-private, or the older
 * data-ut-no-track or ut-block).
 */
export function isExcluded(el: Element): boolean {
  return el.closest(EXCLUDE_SELECTOR) !== null;
}

/**
 * Return true if an element's text should never be used: it, or an element around it, has the
 * mask marker (data-recap-mask or class recap-mask, or the older ut-mask).
 */
export function isMasked(el: Element): boolean {
  return el.closest(MASK_SELECTOR) !== null;
}

// --- Labels ---

/**
 * Where tap labels may come from.
 * - `'text'`: also the element's visible text (first 50 characters) and aria-labelledby (the
 *   visible text of the elements it points to).
 * - `'attributes'`: only aria-label, title, alt and placeholder, never visible text.
 * - `'none'`: only labels you write yourself with data-ut-label.
 * data-ut-label is always used, in every mode and inside the mask marker: it is the developer's own words.
 */
export type LabelMode = 'none' | 'attributes' | 'text';

let _labelMode: LabelMode = 'text';

export function setLabelMode(mode: LabelMode): void {
  _labelMode = mode;
}

export function getLabelMode(): LabelMode {
  return _labelMode;
}

/**
 * The element a tap was really aimed at: the closest button, link, form control, element with a
 * role a person can activate, or element with data-ut-label. A tap on an icon inside a button is
 * a tap on the button. Falls back to the element itself.
 */
export const INTERACTIVE_SELECTOR = [
  '[data-ut-label]',
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  'option',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="treeitem"]',
  '[onclick]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function interactiveTarget(el: Element): Element {
  const hit = el.closest(INTERACTIVE_SELECTOR);
  return hit && hit !== document.documentElement && hit !== document.body ? hit : el;
}

function textOf(el: Element): string {
  const htmlEl = el as HTMLElement;
  // innerText not available in all environments (e.g. jsdom); fall back to textContent
  return (htmlEl.innerText ?? htmlEl.textContent ?? '').trim();
}

/**
 * Extract the best human-readable label for a clicked element.
 * Priority: data-ut-label > aria-label > aria-labelledby (`'text'` mode only) > title > alt >
 *           visible text (50 chars, `'text'` mode only) > placeholder.
 * Inside the mask marker (data-recap-mask, recap-mask, ut-mask), and in `'none'` mode, only data-ut-label is used.
 */
export function extractLabel(el: Element, mode: LabelMode = _labelMode): string | null {
  // 1. Explicit label: the developer's own words, always allowed.
  const utLabel = el.getAttribute('data-ut-label');
  if (utLabel) return utLabel.trim();

  if (mode === 'none' || isMasked(el)) return null;

  // 2. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();

  // 3. aria-labelledby: one or more ids. It reads the visible text of the elements it points to
  // (a name next to a Delete button, say), so only in 'text' mode. Skips labels that are masked or private.
  const labelledBy = mode === 'text' ? el.getAttribute('aria-labelledby') : null;
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => (id ? document.getElementById(id) : null))
      .filter((ref): ref is HTMLElement => !!ref && !isMasked(ref) && !isExcluded(ref))
      .map((ref) => textOf(ref))
      .filter(Boolean);
    if (parts.length) return parts.join(' ').slice(0, 80);
  }

  // 4. title
  const title = el.getAttribute('title');
  if (title?.trim()) return title.trim();

  // 5. alt (images)
  const alt = el.getAttribute('alt');
  if (alt?.trim()) return alt.trim();

  // 6. Visible text, truncated to 50 chars
  if (mode === 'text') {
    const t = textOf(el);
    if (t.length > 0) return t.slice(0, 50);
  }

  // 7. placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder?.trim()) return placeholder.trim();

  return null;
}

// --- Screen names ---

/** Turns a page path into the name a screen is counted under. */
export type ScreenNamer = (path: string) => string | null | undefined;

let _screenNamer: ScreenNamer | null = null;

export function setScreenNamer(fn: ScreenNamer | null | undefined): void {
  _screenNamer = fn ?? null;
}

/**
 * The name a page is counted under: its path (and query string, if kept), passed through the app's
 * screenName hook when it has one. The hook's answer is used when it is a non-empty string;
 * otherwise, or if it throws, the path is used.
 */
export function pageName(rawUrl: string, stripQuery = true): string {
  const path = sanitizeUrl(rawUrl, stripQuery);
  if (!_screenNamer) return path;
  try {
    const named = _screenNamer(path);
    return typeof named === 'string' && named.trim() ? named.trim() : path;
  } catch (err) {
    console.error('[Recap] screenName threw; using the path:', err);
    return path;
  }
}

/**
 * Walk backwards from an element (via previousElementSibling + parentElement)
 * to find the nearest h1-h6, within 20 traversal steps.
 * Returns innerText (truncated to 80 chars) or null.
 */
export function nearestHeading(el: Element): string | null {
  const headings = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  let steps = 0;
  let current: Element | null = el;

  while (current && steps < 20) {
    // Walk back through previous siblings
    let sib = current.previousElementSibling;
    while (sib && steps < 20) {
      steps++;
      if (headings.has(sib.tagName)) {
        if (isMasked(sib) || isExcluded(sib)) return null;
        const htmlSib = sib as HTMLElement;
        const text = (htmlSib.innerText ?? htmlSib.textContent ?? '').trim();
        return text.slice(0, 80) || null;
      }
      sib = sib.previousElementSibling;
    }
    // Move up to parent
    current = current.parentElement;
    steps++;
  }

  return null;
}
