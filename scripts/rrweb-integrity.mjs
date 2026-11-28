// The subresource integrity hash of dist/recap-rrweb.min.js, which the script-tag build puts into
// dist/recap.min.js (see vite.config.ts) so Recap only runs the recorder it was built with.
// `npm run build` builds recap-rrweb.min.js first for this reason.
//
//   node scripts/rrweb-integrity.mjs    print the hash of dist/recap-rrweb.min.js

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RRWEB_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'recap-rrweb.min.js');

/** "sha384-…" for a file's bytes, as browsers check it. */
export function integrityOf(file = RRWEB_DIST) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new Error(
      `${file} is missing: build it first (vite build --mode rrweb). recap.min.js carries its integrity hash.`,
    );
  }
  return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(integrityOf());
}
