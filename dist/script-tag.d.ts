import type { RecapConfig } from './types.js';
/**
 * Whether a script tag loads Recap: it has a data-recap attribute, or its file is one of Recap's
 * own. Other scripts with "recap" in their address (Google's recaptcha__en.js) don't count.
 */
export declare function isRecapScript(s: HTMLScriptElement): boolean;
/** The tag that loaded Recap: the one running now, or else a tag that is clearly Recap's. */
export declare function findRecapScript(doc?: Document): HTMLScriptElement | null;
/** Settings from a script tag's data-* attributes. */
export declare function readScriptConfig(el: HTMLScriptElement): RecapConfig;
/**
 * Start Recap from its script tag. With data-auto-init="false" it only remembers the tag's settings,
 * and starts when the page calls Recap.init() (to pass a screenName function, for example).
 */
export declare function autoInit(doc?: Document): void;
