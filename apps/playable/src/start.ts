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
import { createPlayble, type Adapter, type NetworkId, type Playable } from '@playble/core';
import { AdaptiveQuality, Tweens, Viewport, createLoop, createStage, ctaSafeBottom } from '@playble/engine';
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
    design: viewport.design,
    width: Math.max(1, rect().width),
    height: Math.max(1, rect().height),
  });
  host.append(stage.app.canvas);
  stage.app.canvas.id = 'playble-canvas';

  viewport.measure(host);
  resizeToHost();

  const scene = new Scene(stage.world, tweens);
  const audio = new AudioBus({ mode: playable.config.audio, volume: playable.config.volume });
  const copy = createCopy(root);
  const debug = debugOn ? createDebug(root) : null;

  // The CTA sits above whatever chrome the network draws at the bottom. The
  // inset comes from the runtime's network profile rather than being guessed.
  const cta = createCta(root, {
    safeBottom: ctaSafeBottom(playable.network.bottomUiInset, viewport),
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
      case 'hint-merge':
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
   * Fits the design box into the iframe.
   *
   * Three sizes have to stay consistent, and mixing them up squashes the
   * picture: the canvas element's CSS box (host size), the renderer's backbuffer
   * (host size × dpr × quality scale), and the world transform that maps the
   * 720×1280 design space onto the backbuffer. Anything else and a portrait ad
   * in a landscape slot comes out stretched.
   */
  function resizeToHost(): void {
    const box = rect();
    const cssWidth = Math.max(1, Math.round(box.width));
    const cssHeight = Math.max(1, Math.round(box.height));

    const backbuffer = viewport.backbufferSize(quality.current.resolutionScale);
    stage.resize(backbuffer.width, backbuffer.height);

    const canvas = stage.app.canvas;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    // The world transform maps design space onto the backbuffer, so the fit is
    // computed from the backbuffer, not from the CSS box.
    const fit = Math.max(backbuffer.width / viewport.design.width, backbuffer.height / viewport.design.height);
    stage.world.scale.set(fit);
    stage.world.x = (backbuffer.width - viewport.design.width * fit) / 2;
    stage.world.y = (backbuffer.height - viewport.design.height * fit) / 2;
  }

  function resize(): void {
    if (!viewport.measure(host)) return;
    resizeToHost();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // --- loop ------------------------------------------------------------
  const loop = createLoop({
    fixedUpdate: (stepMs) => {
      tweens.update(stepMs);
      director.update();
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

    // Re-resolve the backbuffer only when the scale actually changed; doing it
    // on every sample would reallocate the framebuffer several times a second.
    if (settings.resolutionScale !== lastAppliedScale) {
      lastAppliedScale = settings.resolutionScale;
      resizeToHost();
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
  function destroy(): void {
    loop.stop();
    input.detach();
    scene.destroy();
    audio.destroy();
    cta.dispose();
    copy.dispose();
    debug?.dispose();
    playable.destroy();
    stage.destroy();
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
  }

  // Handles for the simulator's E2E run and for devtools poking.
  Object.assign(window as unknown as Record<string, unknown>, {
    __playble: { destroy, playable, scene, input, director, boot: { target, variant } },
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
