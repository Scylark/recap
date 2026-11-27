// The script-tag build (dist/recap.min.js): the same API as the module, on window.Recap, and it
// starts itself from the tag's data-* attributes. The ES and CommonJS builds come from index.ts and
// start nothing until Recap.init().

import { Recap, summarize } from './index.js';
import { autoInit } from './script-tag.js';

/**
 * window.Recap: the API itself, so a page can call Recap.init(), Recap.optIn(), Recap.status() and
 * the rest. The module's named exports are on it too (Recap.Recap, Recap.default, Recap.summarize),
 * as they were when window.Recap was the module namespace. The methods don't use `this`, so these
 * copies are the same functions.
 */
const api = { ...Recap, Recap, default: Recap, summarize };

export default api;

if (typeof window !== 'undefined' && typeof document !== 'undefined') autoInit();
