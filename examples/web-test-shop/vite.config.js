import { defineConfig } from 'vite';
import { resolve } from 'path';

// Uses the Recap web SDK straight from this repo's source, so changes show up immediately.
export default defineConfig({
  resolve: { alias: { 'recap-ux': resolve(__dirname, '../../src/index.ts') } },
  server: { fs: { allow: [resolve(__dirname, '../..')] } },
});
