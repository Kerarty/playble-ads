/**
 * Captures the screenshots used in the README.
 *
 * They have to be taken from the built artefact in a real browser. An earlier
 * set was captured before the layout fix and showed the board jammed into the
 * top-left corner, which is exactly the kind of thing that gets a repo screenshotted
 * and believed.
 *
 * Usage: npm run simulator, then node scripts/screenshots.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../docs/images');

const SIMULATOR = 'http://localhost:5174';
// No `debug=1`: the readout is for development, and it sits in the middle of
// the shot. The README is the first thing anyone sees of this project.
const PLAYABLE = `${SIMULATOR}/playable.html?network=unity`;

const CHROME_CANDIDATES =
  process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ];

const up = await fetch(`${SIMULATOR}/`).then((r) => r.ok).catch(() => false);
if (!up) {
  process.stderr.write(
    `[playble] the simulator is not running on ${SIMULATOR}.\n` +
      `[playble] start it with "npm run simulator" first.\n`,
  );
  process.exit(2);
}

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  process.stderr.write('[playble] no Chrome or Edge found on this machine\n');
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });

/**
 * Plays forward until the CTA is on screen.
 *
 * Same approach as the smoke test: real pointer events at coordinates taken
 * from the overlay transform, because anything else would be checking the game
 * against itself.
 */
function playUntilCta(limit) {
  const P = window.__playble;
  const canvas = document.querySelector('canvas');
  const cr = canvas.getBoundingClientRect();
  const m = new DOMMatrix(getComputedStyle(document.querySelector('.playble-overlay')).transform);
  const fire = (type, d) =>
    new PointerEvent(type, {
      clientX: cr.x + m.f + d.x * m.a,
      clientY: cr.y + m.e + d.y * m.d,
      bubbles: true,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
    });

  return (async () => {
    for (let i = 0; i < limit; i += 1) {
      const wrap = document.querySelector('.playble-cta');
      if (wrap && !wrap.hidden && getComputedStyle(wrap).display !== 'none') {
        return { reached: true, merges: P.input.moveCount };
      }
      let pair = null;
      for (let tier = 0; tier < 8 && !pair; tier += 1) pair = P.scene.findPair(tier);
      if (!pair) {
        await new Promise((r) => setTimeout(r, 60));
        continue;
      }
      const a = P.scene.cellCenter(pair[0].col, pair[0].row);
      const b = P.scene.cellCenter(pair[1].col, pair[1].row);
      canvas.dispatchEvent(fire('pointerdown', a));
      dispatchEvent(fire('pointermove', b));
      dispatchEvent(fire('pointerup', b));
      await new Promise((r) => setTimeout(r, 100));
    }
    return { reached: false, merges: P.input.moveCount };
  })();
}

/**
 * Plays exactly `count` merges.
 *
 * Used for the level shot. The first level opens with three blocks, which
 * photographs as an almost empty board; a few merges in shows the mechanic
 * instead of the warm-up.
 */
function playMerges(count) {
  const P = window.__playble;
  const canvas = document.querySelector('canvas');
  const cr = canvas.getBoundingClientRect();
  const m = new DOMMatrix(getComputedStyle(document.querySelector('.playble-overlay')).transform);
  const fire = (type, d) =>
    new PointerEvent(type, {
      clientX: cr.x + m.f + d.x * m.a,
      clientY: cr.y + m.e + d.y * m.d,
      bubbles: true,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
    });

  return (async () => {
    const target = P.input.moveCount + count;
    let stalls = 0;
    while (P.input.moveCount < target && stalls < 120) {
      let pair = null;
      for (let tier = 0; tier < 8 && !pair; tier += 1) pair = P.scene.findPair(tier);
      if (!pair) {
        stalls += 1;
        await new Promise((r) => setTimeout(r, 80));
        continue;
      }
      stalls = 0;
      const a = P.scene.cellCenter(pair[0].col, pair[0].row);
      const b = P.scene.cellCenter(pair[1].col, pair[1].row);
      canvas.dispatchEvent(fire('pointerdown', a));
      dispatchEvent(fire('pointermove', b));
      dispatchEvent(fire('pointerup', b));
      await new Promise((r) => setTimeout(r, 110));
    }
    return P.input.moveCount;
  })();
}

const browser = await chromium.launch({ executablePath, headless: true });

try {
  // --- the unit itself, at the slot shape a phone actually gets --------
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await phone.goto(PLAYABLE);
  await phone.waitForFunction(() => window.__playble && window.__playble.scene.blocksInPlay > 0, {
    timeout: 20000,
  });
  await phone.waitForTimeout(700);

  // A few merges in, so the shot shows the mechanic rather than the warm-up.
  const merges = await phone.evaluate(playMerges, 9);
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: resolve(outDir, 'playable-level.png') });
  process.stdout.write(`  ok   docs/images/playable-level.png  (${merges} merges in)\n`);

  // Generous limit: at 2x device pixel ratio the frame rate is lower, and the
  // CTA beat is gated on reaching the goal tier, so it takes a while.
  const round = await phone.evaluate(playUntilCta, 500);
  if (!round.reached) {
    process.stderr.write('[playble] warning: the CTA never appeared; the shot will not show it\n');
  } else {
    process.stdout.write(`  ok   played to the CTA in ${round.merges} merges\n`);
  }
  await phone.waitForTimeout(700);
  await phone.screenshot({ path: resolve(outDir, 'playable-cta.png') });
  process.stdout.write('  ok   docs/images/playable-cta.png\n');
  await phone.close();

  // --- the simulator, running the unit inside a network container -------
  const sim = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await sim.goto(SIMULATOR);
  await sim.waitForSelector('iframe', { timeout: 20000 });
  await sim.waitForFunction(
    () => {
      const w = document.querySelector('iframe').contentWindow;
      return w && w.__playble && w.__playble.scene.blocksInPlay > 0;
    },
    { timeout: 20000 },
  );
  await sim.waitForTimeout(1200);
  await sim.screenshot({ path: resolve(outDir, 'simulator-mraid.png') });
  process.stdout.write('  ok   docs/images/simulator-mraid.png\n');
  await sim.close();
} finally {
  await browser.close();
}

process.stdout.write('[playble] screenshots written\n');
