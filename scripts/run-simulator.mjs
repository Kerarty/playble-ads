/**
 * Rebuilds the playable, copies it into the simulator, then serves the simulator.
 *
 * The copy step is the point: the simulator must load the real single-file
 * artefact, because that is what gets uploaded to a network. Loading the game's
 * dev server instead would hide size problems and inline-asset problems, which
 * are the two things that most often get a unit rejected in review.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const playableRoot = resolve(repoRoot, 'apps/playable');
const simulatorPublic = resolve(repoRoot, 'apps/simulator/public');

/**
 * Runs a locally installed tool with this node process.
 *
 * `node_modules/.bin` shims are `.cmd` files on Windows and break on any path
 * with a space in it, which `C:\Program Files\...` always has. Running the
 * package's real entry script avoids the shell entirely.
 */
function toolScript(relPath) {
  return resolve(repoRoot, 'node_modules', relPath);
}

function run(label, scriptPath, args = [], options = {}) {
  process.stdout.write(`\n[playble] ${label}\n`);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

run('build playable', resolve(playableRoot, 'scripts/build-and-check.mjs'));

mkdirSync(simulatorPublic, { recursive: true });

/** [source artefact, destination name] */
const COPY = [
  ['dist/index.html', 'playable.html'],
  ['dist/meta.html', 'playable-meta.html'],
];

for (const [from, to] of COPY) {
  const source = resolve(playableRoot, from);
  if (!existsSync(source)) {
    process.stderr.write(`[playble] missing ${from}; the build did not produce it\n`);
    process.exit(1);
  }
  copyFileSync(source, resolve(simulatorPublic, to));
  process.stdout.write(`[playble] copied ${from} -> apps/simulator/public/${to}\n`);
}

run('serve simulator', toolScript('vite/bin/vite.js'), [], { cwd: resolve(repoRoot, 'apps/simulator') });
