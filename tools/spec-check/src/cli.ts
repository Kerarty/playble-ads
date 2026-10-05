#!/usr/bin/env node
/**
 * `playble-spec-check <file.html>`
 *
 * Exits non-zero on any error, so it works as a CI gate as-is.
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { checkPlayable, type NetworkSpec } from './check.js';

/**
 * Specs mirror `@playble/adapters`. Kept as data here on purpose: the check has
 * to work on a build that does not import the SDK at all, and hard-coding the
 * numbers here means the checker is usable before anything else builds.
 */
const SPECS: readonly NetworkSpec[] = [
  { id: 'meta', name: 'Meta (Facebook / Instagram)', maxBytes: 2 * 1024 * 1024, exitCall: 'onCTAClick', forbidsMraid: true },
  { id: 'liftoff', name: 'Liftoff', maxBytes: 700 * 1024, exitCall: 'download', forbidsMraid: false },
  { id: 'applovin', name: 'AppLovin MAX', maxBytes: 4 * 1024 * 1024, exitCall: 'mraid.open', forbidsMraid: false },
  { id: 'google', name: 'Google Ads / AdMob', maxBytes: 5 * 1024 * 1024, exitCall: 'ExitApi', forbidsMraid: false },
  { id: 'tiktok', name: 'TikTok Ads', maxBytes: 5 * 1024 * 1024, exitCall: 'openAppStore', forbidsMraid: false },
  { id: 'mintegral', name: 'Mintegral', maxBytes: 5 * 1024 * 1024, exitCall: 'openAppStore', forbidsMraid: false },
  { id: 'unity', name: 'Unity Ads', maxBytes: 5 * 1024 * 1024, exitCall: 'mraid.open', forbidsMraid: false },
];

const RED = '[31m';
const YELLOW = '[33m';
const GREEN = '[32m';
const DIM = '[2m';
const RESET = '[0m';

function main(): void {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: playble-spec-check <built-file.html>');
    process.exit(2);
  }

  let html: string;
  let bytes: number;
  try {
    html = readFileSync(target, 'utf8');
    bytes = statSync(target).size;
  } catch {
    console.error(`cannot read ${target}`);
    process.exit(2);
    // `exit` does not return, but the compiler does not know that.
    throw new Error('unreachable');
  }

  // `--network=<id>` states which network this artefact targets, so the check
  // can require that network's exit call. Without it the exit call is skipped,
  // which is what you want when inspecting an arbitrary file.
  const networkArg = process.argv.find((a) => a.startsWith('--network='));
  const forNetwork = networkArg?.slice('--network='.length);

  const result = checkPlayable({ html, bytes, specs: SPECS, ...(forNetwork ? { forNetwork } : {}) });

  console.log(`${basename(target)}  ${DIM}${(bytes / 1024).toFixed(1)} KB${RESET}`);

  for (const finding of result.findings) {
    const tag = finding.severity === 'error' ? `${RED}error${RESET}` : `${YELLOW}warn ${RESET}`;
    console.log(`  ${tag} ${finding.rule}  ${DIM}${finding.network}${RESET}`);
    console.log(`        ${finding.message}`);
    if (finding.hint) console.log(`        ${DIM}${finding.hint}${RESET}`);
  }

  if (result.ok) {
    console.log(`${GREEN}OK${RESET} ${DIM}accepted by: ${result.size.largestAccepting ?? 'unknown'}${RESET}`);
  } else {
    const errors = result.findings.filter((f) => f.severity === 'error').length;
    console.log(`${RED}FAILED${RESET} ${errors} error(s)`);
  }

  process.exit(result.ok ? 0 : 1);
}

main();
