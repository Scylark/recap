/**
 * Strip query params and hash from a URL (they often contain tokens/PII).
 * Returns pathname only.
 */
export declare function sanitizeUrl(rawUrl: string, stripQuery?: boolean): string;
/** Elements (and everything inside them) that are never tracked: no taps, no recordings. */
export declare const EXCLUDE_SELECTOR = "[data-ut-no-track], .ut-block, .recap-private";
/**
 * Return true if an element should be completely excluded from tracking: it, or an element around
 * it, has data-ut-no-track, class ut-block or class recap-private.
 */
export declare function isExcluded(el: Element): boolean;
/**
 * Return true if an element's text should never be used: it, or an element around it, has class
 * ut-mask.
 */
export declare function isMasked(el: Element): boolean;
/**
 * Where tap labels may come from.
 * - `'text'`: also the element's visible text (first 50 characters).
 * - `'attributes'`: only aria-label, aria-labelledby, title, alt and placeholder, never visible text.
 * - `'none'`: only labels you write yourself with data-ut-label.
 * data-ut-label is always used, in every mode and inside ut-mask: it is the developer's own words.
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
 * Priority: data-ut-label > aria-label > aria-labelledby > title > alt >
 *           visible text (50 chars, `'text'` mode only) > placeholder.
 * Inside ut-mask, and in `'none'` mode, only data-ut-label is used.
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
