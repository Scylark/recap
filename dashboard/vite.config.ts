import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static build: the output in dist/ can be hosted anywhere (Vercel, Netlify, Cloudflare Pages, S3, nginx).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { fs: { allow: ['..'] } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as never);
