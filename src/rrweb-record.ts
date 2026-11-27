// dist/recap-rrweb.min.js: rrweb's `record` (only), as a plain browser script that sets
// window.rrweb.record. Recap loads it by itself when page recordings are on and the tab is sampled
// in, from the same folder as recap.min.js (or recordings.src).
//
// It exists because rrweb's own browser build is published as .umd.min.cjs, which jsDelivr serves
// as `application/node` with `nosniff`, so browsers refuse to run it. A .js file is served as
// JavaScript. The version is pinned to the one the dashboard's Replayer uses.

import { record } from 'rrweb';

const w = window as unknown as { rrweb?: Record<string, unknown> };
w.rrweb = Object.assign(w.rrweb ?? {}, { record });
