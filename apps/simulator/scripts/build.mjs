/**
 * Builds the simulator as a static site, playable artefacts included.
 *
 * Two steps, and the order matters: the playable has to be built and copied
 * into `public/` before Vite runs, or the page ships without it and 404s on the
 * iframe.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '../..');

function run(label, script, args = [], options = {}) {
  process.stdout.write(`\n[playble] ${label}\n`);
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) {
    process.stderr.write(`[playble] ${label} failed\n`);
    process.exit(result.status ?? 1);
  }
}

const buildScript = resolve(repoRoot, 'apps/playable/scripts/build-and-check.mjs');

// Skippable when CI already built the artefacts, but by default this is the one
// command that produces a complete deployable site.
if (process.env.PLAYBLE_SKIP_PLAYABLE_BUILD !== '1') {
  run('build playable', buildScript);
}

mkdirSync(resolve(appRoot, 'public'), { recursive: true });

for (const [from, to] of [
  ['dist/index.html', 'playable.html'],
  ['dist/meta.html', 'playable-meta.html'],
]) {
  const source = resolve(repoRoot, 'apps/playable', from);
  if (!existsSync(source)) {
    process.stderr.write(`[playble] missing apps/playable/${from}\n`);
    process.exit(1);
  }
  copyFileSync(source, resolve(appRoot, 'public', to));
}

run('build simulator', resolve(repoRoot, 'node_modules/vite/bin/vite.js'), ['build'], {
  cwd: appRoot,
});
