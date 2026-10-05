/**
 * Builds and checks every network-specific artefact.
 *
 * `vite build` emits all three entries in one pass (they share a config and a
 * dependency graph), so there is one build command and three artefacts to check.
 * Every artefact is validated against *every* network's spec, not just its own:
 * a regression that pulls MRAID back into the Meta build has to fail here rather
 * than in an upload review two days later.
 *
 * Usage: node scripts/build-and-check.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '../..');

/**
 * Why each artefact exists. `mraid` and `meta` cannot be the same file, because
 * Meta forbids the MRAID reference the others require.
 */
const ARTEFACTS = [
  { entry: 'index', name: 'index.html', for: 'development and the local simulator', network: null, uploadable: false },
  { entry: 'meta', name: 'meta.html', for: 'Meta and Moloco', network: 'meta', uploadable: true },
  { entry: 'mraid', name: 'mraid.html', for: 'AppLovin, Unity, IronSource, Vungle', network: 'unity', uploadable: true },
];

/**
 * Runs a locally installed tool with this node process.
 *
 * Two things this deliberately avoids:
 *
 *  - `npx`, because some machines have a version manager in front of node that
 *    refuses to delegate to it, and a build that only works when npx is trusted
 *    fails on someone else's laptop;
 *  - `node_modules/.bin/*` shims, because on Windows those are `.cmd` files and
 *    running them through a shell breaks on any path containing a space
 *    (`C:\Program Files\...`).
 *
 * Pointing at each package's real JS entry and running it with `process.execPath`
 * sidesteps both.
 */
function toolScript(relPath) {
  return resolve(repoRoot, 'node_modules', relPath);
}

function runTool(label, scriptPath, args, options = {}) {
  process.stdout.write(`\n[playble] ${label}\n`);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    process.stderr.write(`[playble] ${label} failed\n`);
    process.exit(result.status ?? 1);
  }
  return result;
}

const TSC = toolScript('typescript/bin/tsc');
const VITE = toolScript('vite/bin/vite.js');

runTool('typecheck', TSC, ['--build'], { cwd: repoRoot });

// Each target is a separate Vite invocation: the single-file plugin disables
// code splitting, which Vite does not allow alongside several inputs.
for (const artefact of ARTEFACTS) {
  runTool(`bundle ${artefact.name}`, VITE, ['build', '--mode', 'production'], {
    cwd: appRoot,
    env: { ...process.env, PLAYBLE_ENTRY: artefact.entry },
  });
}

const specCheck = resolve(repoRoot, 'tools/spec-check/dist/cli.js');
const distDir = resolve(appRoot, 'dist');

let failed = false;

for (const artefact of ARTEFACTS) {
  const path = resolve(distDir, artefact.name);
  if (!existsSync(path)) {
    process.stderr.write(`[playble] missing artefact ${artefact.name}\n`);
    failed = true;
    continue;
  }

  const kb = (statSync(path).size / 1024).toFixed(1);
  process.stdout.write(`\n[playble] checking ${artefact.name} (${kb} KB) for ${artefact.for}\n`);

  // Naming the target network makes the checker require that network's exit
  // call, which is how we catch an adapter that failed to make it into a build.
  const args = artefact.network ? [specCheck, path, `--network=${artefact.network}`] : [specCheck, path];
  const result = spawnSync('node', args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) failed = true;
}

if (failed) {
  process.stderr.write('\n[playble] build failed spec validation\n');
  process.exit(1);
}

process.stdout.write('\n[playble] all artefacts pass spec validation\n');
