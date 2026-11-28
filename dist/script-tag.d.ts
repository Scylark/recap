import type { RecapConfig } from './types.js';
/**
 * Subresource integrity for Recap's own recap-rrweb.min.js, so a changed file next to recap.min.js
 * is refused instead of run. Empty outside the script-tag build (tests, module builds).
 */
export declare const RRWEB_INTEGRITY: string;
/**
 * Whether a script tag loads Recap: it has a data-recap attribute, or its file is one of Recap's
 * own. Other scripts with "recap" in their address (Google's recaptcha__en.js) don't count, and
 * neither do the privacy markers (data-recap-private, data-recap-mask): they are other attributes.
 */
export declare function isRecapScript(s: HTMLScriptElement): boolean;
/** The tag that loaded Recap: the one running now, or else a tag that is clearly Recap's. */
export declare function findRecapScript(doc?: Document): HTMLScriptElement | null;
/**
 * Where recap-rrweb.min.js is, next to the Recap script: the same folder
 * (…/dist/recap.min.js → …/dist/recap-rrweb.min.js), or the package's dist folder when the tag
 * loads the package root (https://unpkg.com/recap-ux@1.3.0).
 */
export declare function rrwebNextTo(script: HTMLScriptElement | null): string | null;
/** Settings from a script tag's data-* attributes. */
export declare function readScriptConfig(el: HTMLScriptElement): RecapConfig;
/**
 * Start Recap from its script tag. With data-auto-init="false" it only remembers the tag's settings,
 * and starts when the page calls Recap.init() (to pass a screenName function, for example).
 */
export declare function autoInit(doc?: Document): void;
