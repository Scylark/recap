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

  // Production library build, in three passes:
  // - `vite build`: the ES and CommonJS modules from src/index.ts. Importing them starts nothing.
  // - `vite build --mode script-tag`: dist/recap.min.js from src/browser.ts, which starts itself
  //   from its <script> tag's data-* attributes.
  // - `vite build --mode rrweb`: dist/recap-rrweb.min.js, rrweb's `record` only, as a plain browser
  //   script that sets window.rrweb. Recap loads it on its own when a tab is sampled in for page
  //   recordings. It is a .js file because jsDelivr serves rrweb's own .umd.min.cjs as
  //   application/node with nosniff, which browsers refuse to run.
  if (mode === 'rrweb') {
    return {
      // rrweb's bundle sets up its CSS parser (postcss, about 70 kB) at the top level, so it is
      // kept even though only the Replayer uses it. Marking that set-up as free of side effects
      // (and bare property reads of it) lets the build leave it out. If a later rrweb changes
      // shape, the pattern simply stops matching and the file is bigger, never broken.
      plugins: [
        {
          name: 'recap-rrweb-pure-postcss',
          transform(code: string, id: string) {
            if (!/[\\/]rrweb[\\/]dist[\\/]rrweb\.js$/.test(id)) return null;
            return code.replace(
              /__toESM(\$1)?\(\(\/\* @__PURE__ \*\/ __commonJSMin/g,
              (_m, n: string | undefined) => `__toESM${n ?? ''}(/* @__PURE__ */ (/* @__PURE__ */ __commonJSMin`,
            );
          },
        },
      ],
      build: {
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, 'src/rrweb-record.ts'),
          name: 'RecapRrweb',
          formats: ['iife'],
          fileName: () => 'recap-rrweb.min.js',
        },
        rollupOptions: {
          treeshake: { propertyReadSideEffects: false },
        },
        minify: 'terser',
        // rrweb uses class fields. Lowering them to ES2020 makes esbuild put helper functions
        // outside the IIFE, as page globals; every browser Recap supports runs ES2022 as it is.
        target: 'es2022',
        reportCompressedSize: true,
      },
    };
  }

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
