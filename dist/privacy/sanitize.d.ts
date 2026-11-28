/**
 * Strip query params and hash from a URL (they often contain tokens/PII).
 * Returns pathname only.
 */
export declare function sanitizeUrl(rawUrl: string, stripQuery?: boolean): string;
/**
 * A page address for a recording: origin and path, with the query string only when it is kept
 * (`stripQuery` false) and never the hash. Same rules as sanitizeUrl, plus the origin, because the
 * Replayer needs an absolute address to load the page's relative images and stylesheets. Never
 * passed through the screenName hook: it must stay an address.
 */
export declare function sanitizeHref(rawUrl: string, stripQuery?: boolean): string;
/**
 * The privacy marker: elements (and everything inside them) that are never tracked. No taps are
 * counted there, they are left out of recordings, and on <html> or <body> scroll depth stops too.
 * `data-recap-private` and `class="recap-private"` are the documented names; `data-ut-no-track`
 * and `ut-block` are older names that keep working. (The script tag's own `data-recap`
 * attribute is a different attribute and marks nothing.)
 */
export declare const EXCLUDE_SELECTOR = "[data-recap-private], .recap-private, [data-ut-no-track], .ut-block";
/**
 * Text that is never used: not in tap labels or headings, and replaced with * in recordings.
 * `data-recap-mask` and `class="recap-mask"` are the documented names; `ut-mask` keeps working.
 */
export declare const MASK_SELECTOR = "[data-recap-mask], .recap-mask, .ut-mask";
/**
 * Return true if an element should be completely excluded from tracking: it, or an element around
 * it, has the privacy marker (data-recap-private or class recap-private, or the older
 * data-ut-no-track or ut-block).
 */
export declare function isExcluded(el: Element): boolean;
/**
 * Return true if an element's text should never be used: it, or an element around it, has the
 * mask marker (data-recap-mask or class recap-mask, or the older ut-mask).
 */
export declare function isMasked(el: Element): boolean;
/**
 * Where tap labels may come from.
 * - `'text'`: also the element's visible text (first 50 characters) and aria-labelledby (the
 *   visible text of the elements it points to).
 * - `'attributes'`: only aria-label, title, alt and placeholder, never visible text.
 * - `'none'`: only labels you write yourself with data-ut-label.
 * data-ut-label is always used, in every mode and inside the mask marker: it is the developer's own words.
 */
export type LabelMode = 'none' | 'attributes' | 'text';
export declare function setLabelMode(mode: LabelMode): void;
export declare function getLabelMode(): LabelMode;
/**
 * The element a tap was really aimed at: the closest button, link, form control, element with a
 * role a person can activate, or element with data-ut-label. A tap on an icon inside a button is
 * a tap on the button. Falls back to the element itself.
 */
export declare const INTERACTIVE_SELECTOR: string;
export declare function interactiveTarget(el: Element): Element;
/**
 * Extract the best human-readable label for a clicked element.
 * Priority: data-ut-label > aria-label > aria-labelledby (`'text'` mode only) > title > alt >
 *           visible text (50 chars, `'text'` mode only) > placeholder.
 * Inside the mask marker (data-recap-mask, recap-mask, ut-mask), and in `'none'` mode, only data-ut-label is used.
 */
export declare function extractLabel(el: Element, mode?: LabelMode): string | null;
/** Turns a page path into the name a screen is counted under. */
export type ScreenNamer = (path: string) => string | null | undefined;
export declare function setScreenNamer(fn: ScreenNamer | null | undefined): void;
/**
 * The name a page is counted under: its path (and query string, if kept), passed through the app's
 * screenName hook when it has one. The hook's answer is used when it is a non-empty string;
 * otherwise, or if it throws, the path is used.
 */
export declare function pageName(rawUrl: string, stripQuery?: boolean): string;
/**
 * Walk backwards from an element (via previousElementSibling + parentElement)
 * to find the nearest h1-h6, within 20 traversal steps.
 * Returns innerText (truncated to 80 chars) or null.
 */
export declare function nearestHeading(el: Element): string | null;
