/**
 * Playable boot sequence.
 *
 * Wires four things together and gets out of the way:
 *
 *   @playble/core       who is running us, and how do we reach the store
 *   @playble/engine     the loop, the tweens, the adaptive quality
 *   ./game              the actual game (board, scene, input, script)
 *   ./ui                the DOM overlays (copy, CTA, debug)
 *
 * The order is the boot order and it is deliberate: network detection first (the
 * CTA position depends on it), then the stage, then the game, then the script
 * that drives them. Anything that could throw during boot lands in a catch that
 * shows a message, because a blank black rectangle is the worst possible outcome
 * in a unit nobody is watching while they debug.
 */
import './style.css';
import type { Container } from 'pixi.js';
import { createPlayble, type Adapter, type NetworkId, type Playable } from '@playble/core';
import { AdaptiveQuality, Tweens, Viewport, createLoop, createStage } from '@playble/engine';
import { Scene } from './game/scenes.js';
import { InputController } from './game/input.js';
import { Director } from './game/director.js';
import { AudioBus } from './game/audio.js';
import { LEVELS, evaluateBoard } from './game/board.js';
import { scriptById, type BeatAction } from './game/script.js';
import { createCopy, createCta, createDebug } from './ui/cta.js';

export interface StartOptions {
  adapters: readonly Adapter[];
  /** Build target, shown in the debug overlay. */
  target: string;
  variant: string;
  debug: boolean;
  /** Pins a network, for the simulator and QA deep links. */
  forcedNetwork?: string | undefined;
  storeUrl: string;
}

export async function startPlayable(options: StartOptions): Promise<void> {
  const { target, variant, debug: debugOn } = options;

  const playable = createPlayble({
    config: {
      storeUrl: options.storeUrl,
      debug: debugOn,
      ...(options.forcedNetwork ? { network: options.forcedNetwork as NetworkId } : {}),
    },
    adapters: options.adapters,
  });

  const root = document.getElementById('playble-root');
  if (!root) throw new Error('#playble-root is missing from the document');

  const viewport = new Viewport();
  const tweens = new Tweens();
  const quality = new AdaptiveQuality({
    targetFps: playable.config.targetFps,
    enabled: playable.config.autoQuality,
    lowFpsThreshold: playable.config.lowFpsThreshold,
  });

  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.inset = '0';
  root.append(host);

  const rect = (): DOMRect => host.getBoundingClientRect();

  const stage = await createStage({
    width: Math.max(1, Math.round(rect().width)),
    height: Math.max(1, Math.round(rect().height)),
  });
  host.append(stage.app.canvas);
  stage.app.canvas.id = 'playble-canvas';

  viewport.measure(host);

  const scene = new Scene(stage.world, tweens, viewport.design.width, viewport.design.height);
  const audio = new AudioBus({ mode: playable.config.audio, volume: playable.config.volume });

  /**
   * DOM overlays live inside a design-space layer.
   *
   * They are positioned in design pixels and transformed with the fitted box, so
   * a CTA at the bottom of the 720×1280 design is at the bottom of the ad in any
   * slot. The layer must not intercept pointer events itself - only its children
   * that are meant to be clickable do.
   */
  const overlayLayer = document.createElement('div');
  overlayLayer.className = 'playble-overlay';
  root.append(overlayLayer);

  const copy = createCopy(overlayLayer);
  const debug = debugOn ? createDebug(overlayLayer) : null;

  // The CTA sits above whatever chrome the network draws at the bottom. The
  // inset comes from the runtime's network profile rather than being guessed, and
  // is converted into design pixels so the button lands in the same place in a
  // 320x480 slot as in a full-screen one.
  const cta = createCta(overlayLayer, {
    safeBottom: viewport.insetToDesign(playable.network.bottomUiInset),
    label: 'УСТАНОВИТЬ',
    sublabel: 'бесплатно',
    onTap: () => {
      playable.install();
    },
  });

  let currentLevel = 0;
  let ctaShown = false;

  const director = new Director({
    beats: scriptById(variant).beats,
    hooks: { runAction },
  });

  function loadLevel(index: number): void {
    const level = LEVELS[index];
    if (!level) return;
    currentLevel = index;

    audio.resetProgress();
    scene.loadLayout(level.layout);
    // Every level starts on tier 0, so that is the pair the hint points at.
    scene.hintFirstPair(0);
    playable.track('level_start', { level: index, name: level.name });
  }

  const input = new InputController(stage.app.canvas, scene, tweens, (x, y) => viewport.toDesign(x, y, rect()), {
    onMerge: (tier, moves) => {
      audio.playMerge();
      playable.track('merge', { tier, moves });

      const level = LEVELS[currentLevel];
      if (!level) return;

      const result = evaluateBoard(scene.board, level.goal);
      if (!result.done) return;

      if (result.outcome === 'won') {
        scene.clearHint();
        scene.celebrate();
        audio.playWin();
        playable.reportWin({ moves, durationMs: Math.round(director.elapsedSeconds * 1000) });
        director.notify('win');
      } else {
        // Stuck. An ad should never punish, so restart the level rather than
        // showing a fail state - the player leaves with a win or with nothing.
        playable.track('stuck', { level: currentLevel });
        loadLevel(currentLevel);
      }
    },
    onFirstInteraction: (action) => {
      // Audio unlocks here, on a real gesture, which is the only moment mobile
      // autoplay policy permits.
      audio.unlock();
      audio.setMuted(false);
      playable.notifyInteraction(action);
      director.notify('first-interaction');
    },
    onInvalidDrop: () => {
      audio.playInvalid();
      playable.track('invalid_drop');
    },
  });

  input.attach();

  function runAction(action: BeatAction): void {
    switch (action.type) {
      case 'show-copy':
        copy.show(action.text, action.sub);
        break;
      case 'hide-copy':
        copy.hide();
        break;
      case 'start-level':
        loadLevel(action.index);
        break;

      // A sanity check rather than a normal beat: if the board has no merge
      // available at a moment the script expects one, top it up. The rules
      // already prevent this, so it only fires if a level layout is edited into
      // something unsolvable - in which case the ad would otherwise sit there
      // looking broken.
      case 'hint-merge':
        scene.ensurePlayable();
        scene.hintFirstPair(action.tier);
        break;

      case 'celebrate':
        scene.celebrate();
        copy.celebrate();
        break;
      case 'show-cta':
        if (ctaShown) return;
        ctaShown = true;
        copy.hide();
        cta.show();
        playable.showCta();
        audio.playCta();
        break;
      case 'show-funnel':
        if (debug) debug.setText(debugText());
        break;
    }
  }

  // --- viewport --------------------------------------------------------
  /**
   * Resizes the canvas and refits the design box into it.
   *
   * Four things have to agree, and getting this wrong is what produces a
   * squashed playable:
   *
   *  1. the canvas element's CSS box — always the full slot;
   *  2. the renderer's backbuffer — slot × dpr × quality scale;
   *  3. the world transform — design space (720×1280) mapped into the backbuffer
   *     at a uniform scale, centred;
   *  4. the DOM overlays — positioned in design space, so they move with the game
   *     rather than being pinned to the slot.
   *
   * The canvas covering the whole slot while the design box only fills the middle
   * is intentional: it means the letterbox area still shows the game's background
   * instead of a bare strip of page colour.
   */
  function refit(): void {
    const slot = viewport.slot;
    const backbuffer = viewport.backbufferSize(quality.current.resolutionScale);

    stage.resize(backbuffer.width, backbuffer.height);

    const canvas = stage.app.canvas;
    canvas.style.width = `${slot.width}px`;
    canvas.style.height = `${slot.height}px`;

    const design = viewport.design;
    const fit = viewport.fitted;

    /**
     * The world transform maps design space onto the backbuffer.
     *
     * A design point has to arrive on screen at `fit.x + designX * fit.scale`
     * CSS pixels, and the canvas element then stretches its backbuffer over the
     * slot. Composing the two, the factor that maps design space onto backbuffer
     * pixels is:
     *
     *     fit.scale * (backbuffer.width / slot.width)
     *
     * which is the device pixel ratio times the fit scale. Getting this wrong is
     * invisible from inside the game - nothing throws, the input still works,
     * because input goes through the DOM overlay's transform - so the picture
     * just drifts off-centre. `measureDrift()` compares the two systems.
     */
    const toBackbuffer = backbuffer.width / slot.width;
    stage.world.scale.set(fit.scale * toBackbuffer);
    stage.world.x = fit.x * toBackbuffer;
    stage.world.y = fit.y * toBackbuffer;

    // The grid follows the design box, so it stays centred and keeps a sane
    // cell size whatever the slot looks like.
    scene.setDesignSize(design.width, design.height);

    // Overlays live in design space, so the CTA and the copy land in the same
    // place in a 320x480 slot as in a full-screen one.
    overlayLayer.style.transform = `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`;
    overlayLayer.style.width = `${design.width}px`;
    overlayLayer.style.height = `${design.height}px`;
  }

  function resize(): void {
    if (!viewport.measure(host)) return;
    refit();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  refit();

  // --- loop ------------------------------------------------------------
  let idleCheckAt = 0;

  const loop = createLoop({
    fixedUpdate: (stepMs, elapsed) => {
      tweens.update(stepMs);
      director.update();

      // Watchdog for a dead board.
      //
      // The merge rules keep the board playable after every change, so this
      // should never fire. It exists because every other guard depends on the
      // player acting: a board that ends up with nothing mergeable simply sits
      // there while the script runs out of beats, and the ad looks frozen. Once a
      // second, top it up.
      if (elapsed - idleCheckAt > 1000) {
        idleCheckAt = elapsed;
        scene.ensurePlayable();
      }
    },
    render: () => {
      stage.app.render();
    },
  });

  function debugText(): string {
    const stats = scene.stats;
    return [
      `build      ${target}`,
      `network    ${playable.network.name}${playable.bridgeDetected ? '' : ' (fallback)'}`,
      `variant    ${variant}`,
      `level      ${currentLevel + 1}/${LEVELS.length}`,
      `merges     ${input.moveCount}`,
      `fps        ${Math.round(smoothedFps)}`,
      `quality    ${quality.current.resolutionScale.toFixed(2)}x particles=${quality.current.particles}`,
      `views      ${stats.blocks} live, ${stats.viewsCreated} created`,
      `board      ${scene.board.occupiedCount}/20 cells`,
    ].join('\n');
  }

  // FPS sampling on its own rAF, not inside the fixed step: metrics must keep
  // ticking while the game simulates slowly, and must not add measurable work to
  // the thing being measured.
  let smoothedFps = 60;
  let lastAppliedScale = quality.current.resolutionScale;
  let frames = 0;
  let frameTime = 0;
  let lastSampleAt = performance.now();
  let lastRenderAt = lastSampleAt;

  loop.start();

  function sampleMetrics(): void {
    const now = performance.now();
    frameTime += now - lastRenderAt;
    lastRenderAt = now;
    frames += 1;

    if (now - lastSampleAt < 500) return;

    smoothedFps = (frames * 1000) / frameTime;
    const worstFrameMs = frameTime / frames;

    const settings = quality.update(smoothedFps, worstFrameMs);
    playable.reportPerf(quality.sample(smoothedFps));

    // Refit only when the quality scale actually changed; doing it on every
    // sample would reallocate the framebuffer several times a second.
    if (settings.resolutionScale !== lastAppliedScale) {
      lastAppliedScale = settings.resolutionScale;
      refit();
    }

    if (debug) debug.setText(debugText());

    frames = 0;
    frameTime = 0;
    lastSampleAt = now;
  }

  (function metricsLoop(): void {
    sampleMetrics();
    window.requestAnimationFrame(metricsLoop);
  })();

  director.start();

  // `ready` after the first frame, so a wrapper listening for it sees a rendered
  // unit rather than a black rectangle.
  requestAnimationFrame(() => playable.markReady());

  // An ad can be destroyed mid-view by the network. A leaked rAF loop would keep
  // the audio context alive and drain a phone battery.
  /**
   * Compares where the canvas drew a point against where the DOM overlay says
   * it should be.
   *
   * The renderer and the overlays are two independent coordinate systems that
   * have to agree, and nothing throws when they do not: the game looks plausible
   * and only feels wrong. Exposed for the E2E run in `apps/simulator`, which
   * asserts this is zero, so the class of bug cannot come back unnoticed.
   */
  function measureDrift(): { driftPx: number; design: { x: number; y: number } } | null {
    const overlay = overlayLayer.getBoundingClientRect();
    if (overlay.width === 0 || overlay.height === 0) return null;

    const designBox = viewport.design;
    const designPoint = { x: designBox.width / 2, y: designBox.height / 2 };
    const expected = {
      x: overlay.left + (designPoint.x / designBox.width) * overlay.width,
      y: overlay.top + (designPoint.y / designBox.height) * overlay.height,
    };

    // Same point through the Pixi tree.
    let x = designPoint.x;
    let y = designPoint.y;
    let node: Container | null = stage.world;
    while (node) {
      x = x * node.scale.x + node.x;
      y = y * node.scale.y + node.y;
      node = node.parent as Container | null;
    }

    // The canvas element is stretched from its backbuffer to its CSS box, so a
    // backbuffer coordinate reaches the screen scaled by cssWidth / backbufferWidth.
    const canvasBox = stage.app.canvas.getBoundingClientRect();
    const factor = canvasBox.width / stage.app.canvas.width;

    return {
      driftPx: Math.hypot(
        expected.x - canvasBox.left - x * factor,
        expected.y - canvasBox.top - y * factor,
      ),
      design: designPoint,
    };
  }

  function destroy(): void {
    loop.stop();
    input.detach();
    scene.destroy();
    audio.destroy();
    cta.dispose();
    copy.dispose();
    debug?.dispose();
    overlayLayer.remove();
    playable.destroy();
    stage.destroy();
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
  }

  // Handles for the simulator's E2E run and for devtools poking.
  Object.assign(window as unknown as Record<string, unknown>, {
    __playble: {
      destroy,
      playable,
      scene,
      input,
      director,
      measureDrift,
      /** CSS pixels per design pixel, so a caller can reason in screen units. */
      get viewportFitScale() {
        return viewport.fitScale;
      },
      boot: { target, variant },
    },
  });
}

/** Reports a boot failure in the page instead of leaving a black rectangle. */
export function reportBootFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const root = document.getElementById('playble-root');

  if (root) {
    root.innerHTML =
      `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;` +
      `color:#ff8a80;font:600 16px/1.5 system-ui,sans-serif;text-align:center">${message}</div>`;
  }
  console.error('[playble] boot failed', error);
}

/** Re-exported so a test can construct the runtime without a canvas. */
export type { Playable };
