import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * The simulator serves the built playable out of `public/`, so it exercises the
 * real single-file artefact rather than a dev-server build of the game. That
 * distinction matters: size and inline-asset behaviour are exactly what gets a
 * unit rejected in review, and neither is visible in a dev build.
 */
export default defineConfig({
  publicDir: 'public',
  // Relative asset paths, so the site works under a GitHub Pages project path
  // like /playble-ads/ as well as at a domain root.
  base: './',
  server: {
    port: 5174,
    strictPort: true,
    fs: {
      // The playable is loaded into an iframe and reaches for the debug handles
      // on `window`, so it has to be same-origin. Vite already serves `public/`
      // same-origin; this allows the workspace root in case anything resolves
      // outside it.
      allow: [resolve(import.meta.dirname, '../..')],
    },
  },
  build: {
    target: 'es2019',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
