import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static build: the output in dist/ can be hosted anywhere (Vercel, Netlify, Cloudflare Pages, S3, nginx).
export default defineConfig({
  plugins: [react()],
  base: './',
  // Port 3000 matches Supabase's default Site URL, so email sign-in links work locally with no extra setup.
  server: { port: 3000, fs: { allow: ['..'] } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as never);
