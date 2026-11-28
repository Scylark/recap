// dist/recap-rrweb.min.js: rrweb's `record` (only), as a plain browser script. Recap loads it by
// itself when page recordings are on and the tab is sampled in, from the same folder as
// recap.min.js (or recordings.src), checked against the hash recap.min.js was built with.
//
// It exists because rrweb's own browser build is published as .umd.min.cjs, which jsDelivr serves
// as `application/node` with `nosniff`, so browsers refuse to run it. A .js file is served as
// JavaScript. The version is pinned to the one the dashboard's Replayer uses.
//
// The build exposes `record` as window.RecapRrweb.record, which is what Recap uses. It is also set
// as window.rrweb.record when the page has no rrweb of its own, as earlier versions did; a page's
// own rrweb is left alone.

import { record } from 'rrweb';

const w = window as unknown as { rrweb?: Record<string, unknown> };
if (!w.rrweb?.['record']) w.rrweb = Object.assign(w.rrweb ?? {}, { record });

export { record };
