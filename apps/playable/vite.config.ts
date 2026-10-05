import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Build config for the shipped units.
 *
 * Ad networks do not serve a project - they receive one `index.html`. Every
 * network that accepts HTML5 requires a single self-contained file with no
 * external requests, so `viteSingleFile` inlines the JS and CSS, and
 * `assetsInlineLimit` is set high enough to swallow binary assets too.
 *
 * One build per target rather than one build with three inputs: the single-file
 * plugin sets `codeSplitting: false`, which Vite refuses to combine with
 * multiple inputs. `PLAYBLE_ENTRY` picks the entry; see
 * `scripts/build-and-check.mjs`.
 *
 * The split exists because Meta rejects any unit containing the string "mraid"
 * anywhere - including in a code path the bundle never executes - so the MRAID
 * adapter must be absent from the module graph, not merely unused.
 *
 * `target: 'es2019'` is deliberate: a large share of playable traffic still
 * arrives from in-app WebViews that predate es2020.
 */
const ENTRY = process.env.PLAYBLE_ENTRY ?? 'index';

export default defineConfig({
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],

  build: {
    target: 'es2019',
    outDir: 'dist',
    emptyOutDir: false,
    assetsInlineLimit: 10 * 1024 * 1024,
    cssCodeSplit: false,
    reportCompressedSize: true,
    rollupOptions: {
      input: resolveEntry(ENTRY),
      output: {
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});

function resolveEntry(name) {
  if (name !== 'index' && name !== 'meta' && name !== 'mraid') {
    throw new Error(`unknown PLAYBLE_ENTRY "${name}" (expected index, meta or mraid)`);
  }
  return `${name}.html`;
}
