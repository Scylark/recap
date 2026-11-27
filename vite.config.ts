import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command, mode }) => {
  if (command === 'serve') {
    // Dev server: serves examples/basic.html with the source loaded directly
    return {
      root: 'examples',
      // appType defaults to 'spa', which serves index.html as the fallback for
      // all unknown routes. This means Vite's full-page reload after a file
      // change won't 404 when the browser is on a pushState URL like /reports.
      server: { open: '/' },
      // The demo page reuses the Expo test shop's .env, so the same Supabase keys send web
      // sessions to the same dashboard. Without that file the demo stays offline-only.
      envDir: resolve(__dirname, 'examples/expo-test-shop'),
      envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
      resolve: {
        alias: {
          // Map the CDN script reference to local source so changes hot-reload
          'recap-ux': resolve(__dirname, 'src/index.ts'),
        },
      },
    };
  }

  // Production library build, in two passes:
  // - `vite build`: the ES and CommonJS modules from src/index.ts. Importing them starts nothing.
  // - `vite build --mode script-tag`: dist/recap.min.js from src/browser.ts, which starts itself
  //   from its <script> tag's data-* attributes.
  const scriptTag = mode === 'script-tag';
  return {
    build: {
      emptyOutDir: !scriptTag, // the second pass adds to the first one's output
      lib: {
        entry: resolve(__dirname, scriptTag ? 'src/browser.ts' : 'src/index.ts'),
        name: 'Recap',
        formats: scriptTag ? ['umd'] : ['es', 'cjs'],
        fileName: (format) => {
          if (format === 'umd') return 'recap.min.js';
          if (format === 'es') return 'recap.esm.js';
          return 'recap.cjs.js';
        },
      },
      rollupOptions: {
        external: ['react', 'react-dom'],
        output: {
          globals: {
            react: 'React',
            'react-dom': 'ReactDOM',
          },
          exports: 'named',
        },
      },
      minify: 'terser',
      target: 'es2020',
      reportCompressedSize: true,
    },
  };
});
