/**
 * Playable smoke test.
 *
 * Why this is a script and not a unit test: the failures that matter here only
 * appear once a real browser is running the real build. The renderer and the
 * input path disagreeing about where a block is, the board dead-ending with
 * nothing to merge, the CTA never appearing - all of those pass the unit tests
 * and fail in the actual game. Every one of them was found by driving the built
 * artefact, not by reading code.
 *
 * Runs against the Chrome or Edge already installed on the machine, so nothing
 * has to be downloaded. The simulator is expected to be running already
 * (`npm run simulator`); if it is not, the script says so instead of hanging.
 *
 * Usage: node scripts/smoke.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

/**
 * Browsers to drive, in preference order.
 *
 * The machine's own Chrome or Edge is used rather than a Playwright-managed
 * download: it keeps the dependency small and means a developer running this
 * locally gets the same browser CI does, instead of a 150 MB second install.
 */
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

const SIMULATOR = 'http://localhost:5174';

/** Slot shapes a real unit gets served into. */
const SLOTS = [
  { name: 'phone portrait', width: 390, height: 844 },
  { name: 'small portrait', width: 320, height: 480 },
  { name: 'landscape', width: 1000, height: 700 },
  { name: 'square-ish', width: 503, height: 437 },
];

/** Networks whose exit path has to be exercised, not assumed. */
const NETWORKS = [
  { name: 'mraid-generic', runtime: 'unity', exit: 'mraid.open' },
  { name: 'meta', runtime: 'meta', exit: 'FbPlayableAd.onCTAClick' },
  { name: 'google', runtime: 'google', exit: 'ExitApi.exit' },
  { name: 'mintegral', runtime: 'mintegral', exit: 'window.install' },
  { name: 'tiktok', runtime: 'tiktok', exit: 'window.openAppStore' },
  { name: 'liftoff', runtime: 'liftoff', exit: 'download' },
];

const failures = [];

function check(ok, label, detail = '') {
  process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}\n`);
  if (!ok) failures.push(`${label}${detail ? `: ${detail}` : ''}`);
}

/**
 * Plays a round by dispatching real pointer events at real screen coordinates.
 *
 * The coordinates are derived from the DOM overlay's transform, which is what
 * the player sees. Deriving them from the game state instead would test the
 * game against itself and would not notice the two disagreeing.
 */
function playRound(maxMoves) {
  const P = window.__playble;
  const canvas = document.querySelector('canvas');
  const cr = canvas.getBoundingClientRect();
  const m = document
    .querySelector('.playble-overlay')
    .style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
  const fx = parseFloat(m[1]);
  const fy = parseFloat(m[2]);
  const fs = parseFloat(m[3]);

  const fire = (type, d) =>
    new PointerEvent(type, {
      clientX: cr.x + fx + d.x * fs,
      clientY: cr.y + fy + d.y * fs,
      bubbles: true,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'touch',
      button: 0,
      buttons: 1,
    });

  // Any tier, not just 0 and 1. A board that has run down to only tier-2 pairs
  // is still perfectly playable, and a driver that only looks at the first two
  // tiers calls it stuck when it is not.
  const findAnyPair = () => {
    for (let tier = 0; tier < 8; tier += 1) {
      const pair = P.scene.findPair(tier);
      if (pair) return pair;
    }
    return null;
  };

  return (async () => {
    let stalls = 0;
    for (let i = 0; i < maxMoves; i += 1) {
      const wrap = document.querySelector('.playble-cta');
      if (wrap && !wrap.hidden && getComputedStyle(wrap).display !== 'none') {
        return { reachedCta: true, merges: P.input.moveCount, stalls };
      }
      const pair = findAnyPair();
      if (!pair) {
        stalls += 1;
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
    return { reachedCta: false, merges: P.input.moveCount, stalls };
  })();
}

const up = await fetch(`${SIMULATOR}/`).then((r) => r.ok).catch(() => false);
if (!up) {
  process.stderr.write(
    `[playble] the simulator is not running on ${SIMULATOR}.\n` +
      `[playble] start it with "npm run simulator" in another terminal, then run this again.\n`,
  );
  process.exit(2);
}

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  process.stderr.write('[playble] no Chrome or Edge found on this machine\n');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath, headless: true });

try {
  // --- the unit is playable in every slot shape -----------------------
  process.stdout.write('\n[playble] slot shapes\n');

  for (const slot of SLOTS) {
    const page = await browser.newPage({ viewport: { width: slot.width, height: slot.height } });
    await page.goto(`${SIMULATOR}/playable.html?network=unity&debug=1`);
    await page.waitForFunction(() => window.__playble && window.__playble.scene.blocksInPlay > 0, {
      timeout: 20000,
    });
    await page.waitForTimeout(250);

    // The renderer and the DOM overlays are two coordinate systems that have to
    // agree. Nothing throws when they do not, so this compares them.
    const drift = await page.evaluate(() => Math.round(window.__playble.measureDrift().driftPx * 10) / 10);
    check(drift === 0, `${slot.name}: renderer matches overlays`, `drift ${drift}px`);

    // The grid has to fit the design box and stay tappable.
    const layout = await page.evaluate(() => {
      const L = window.__playble.scene.currentLayout;
      const scale = window.__playble.viewportFitScale;
      return {
        cell: L.cell,
        overflowX: L.left < 0,
        overflowY: L.top + L.cell * 5 > 1280,
        cellCssPx: Math.round(L.cell * scale),
      };
    });
    check(
      !layout.overflowX && !layout.overflowY && layout.cellCssPx >= 24,
      `${slot.name}: board fits and is tappable`,
      `cell ${layout.cell} design px, ${layout.cellCssPx} css px`,
    );

    // And the thing that actually matters: can it be played to the CTA.
    const round = await page.evaluate(playRound, 220);
    check(
      round.reachedCta,
      `${slot.name}: round reaches the CTA`,
      `${round.merges} merges, ${round.stalls} stalls`,
    );

    await page.close();
  }

  // --- each network exits the way it says it does ---------------------
  process.stdout.write('\n[playble] network exits\n');

  const sim = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  for (const network of NETWORKS) {
    await sim.goto(SIMULATOR);
    await sim.waitForSelector('select', { timeout: 20000 });

    await sim.selectOption('select', network.name);

    // Switching the network reloads the iframe, so the handle has to be read
    // again afterwards rather than reused.
    const detected = await sim.evaluate(async (expected) => {
      const frame = document.querySelector('iframe');
      for (let i = 0; i < 200; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        const P = frame.contentWindow && frame.contentWindow.__playble;
        if (P && P.playable.network.id === expected) return P.playable.network.id;
      }
      const P = frame.contentWindow && frame.contentWindow.__playble;
      return P ? P.playable.network.id : 'no playable';
    }, network.runtime);
    check(detected === network.runtime, `${network.name}: detected`, `got ${detected}`);

    const tapped = await sim.evaluate(async () => {
      const frame = document.querySelector('iframe');
      const w = frame.contentWindow;
      const P = w.__playble;
      const canvas = w.document.querySelector('canvas');
      const cr = canvas.getBoundingClientRect();
      const m = w.document
        .querySelector('.playble-overlay')
        .style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\)/);
      const fx = parseFloat(m[1]);
      const fy = parseFloat(m[2]);
      const fs = parseFloat(m[3]);
      const fire = (type, d) =>
        new w.PointerEvent(type, {
          clientX: cr.x + fx + d.x * fs,
          clientY: cr.y + fy + d.y * fs,
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
          pointerType: 'touch',
          button: 0,
          buttons: 1,
        });

      for (let i = 0; i < 200; i += 1) {
        const button = w.document.querySelector('.playble-cta__button');
        if (button && w.getComputedStyle(button).display !== 'none') {
          button.click();
          await new Promise((r) => setTimeout(r, 400));
          const badge = document.querySelector('.exit-badge');
          return badge ? badge.textContent.trim() : 'no badge';
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
        w.dispatchEvent(fire('pointermove', b));
        w.dispatchEvent(fire('pointerup', b));
        await new Promise((r) => setTimeout(r, 100));
      }
      return 'never reached the CTA';
    });

    check(
      tapped.includes(network.exit),
      `${network.name}: exits via ${network.exit}`,
      `badge says "${tapped}"`,
    );
  }

  await sim.close();
} finally {
  await browser.close();
}

process.stdout.write('\n');
if (failures.length > 0) {
  process.stderr.write(`[playble] smoke test failed, ${failures.length} problem(s):\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write('[playble] smoke test passed\n');
