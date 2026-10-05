/**
 * PixiJS bootstrap.
 *
 * The only module that imports PixiJS. Keeping it isolated means the rest of the
 * engine, and the whole game above it, can be reasoned about and tested without
 * a renderer.
 *
 * Pixi 8 is configured with `preference: 'webgl'` deliberately: the WebGPU
 * backend does not exist in the older Android WebViews a real share of playable
 * traffic arrives from, and a unit that renders black in those containers
 * converts at exactly zero.
 */
import { Application, Container } from 'pixi.js';
import type { DesignSize } from './viewport.js';

export interface StageHandle {
  app: Application;
  /**
   * Root container for game content.
   *
   * Left unscaled on purpose. The caller owns the design-space to backbuffer
   * transform, because the backbuffer size depends on the adaptive quality
   * controller and this module does not know about it.
   */
  world: Container;
  /** Resizes the backbuffer. Does not touch the canvas CSS box. */
  resize(backbufferWidth: number, backbufferHeight: number): void;
  destroy(): void;
}

export interface StageOptions {
  design: DesignSize;
  /** CSS size of the host element. */
  width: number;
  height: number;
  /** Background alpha, so the page behind the canvas can show through. */
  backgroundAlpha?: number;
}

export async function createStage(options: StageOptions): Promise<StageHandle> {
  const app = new Application();

  await app.init({
    width: Math.max(1, options.width),
    height: Math.max(1, options.height),
    background: 0x000000,
    backgroundAlpha: options.backgroundAlpha ?? 0,
    antialias: false,
    // init must not apply devicePixelRatio: `resize()` owns the backbuffer size
    // entirely, and applying it here as well would square the intended pixel
    // count.
    resolution: 1,
    autoDensity: false,
    preference: 'webgl',
    powerPreference: 'low-power',
    // A playable has no cameras, no interaction system and no shared resources to
    // warm up, so every one of those subsystems stays off.
    hello: false,
  });

  const world = new Container();
  app.stage.addChild(world);

  return {
    app,
    world,

    resize(backbufferWidth, backbufferHeight) {
      app.renderer.resize(Math.max(1, backbufferWidth), Math.max(1, backbufferHeight));
    },

    destroy() {
      app.destroy(false, { children: true });
    },
  };
}
