// The script-tag build (dist/recap.min.js): the same API as the module, on window.Recap, and it
// starts itself from the tag's data-* attributes. The ES and CommonJS builds come from index.ts and
// start nothing until Recap.init().

import { autoInit } from './script-tag.js';

export * from './index.js';
export { default } from './index.js';

if (typeof window !== 'undefined' && typeof document !== 'undefined') autoInit();
