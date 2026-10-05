/**
 * Minimal tween system.
 *
 * Everything in a playable that "feels good" is a tween: a merge popping, a
 * button pulsing, a camera shake. Pulling in a full animation library for that
 * costs more bytes than the game itself, so this is ~150 lines of Euler/easing.
 *
 * Tweens live in a flat array and are stepped by the fixed timestep, so timing
 * is frame-rate independent like the rest of the engine.
 */

export type Easing = (t: number) => number;

export const Easing = {
  linear: (t: number): number => t,
  inQuad: (t: number): number => t * t,
  outQuad: (t: number): number => t * (2 - t),
  inOutQuad: (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number): number => t * t * t,
  outBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  /** For a quick squash before the stretch. */
  outElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  /** Bouncing settle, good for drops landing. */
  outBounce: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  inOutSine: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,
} satisfies Record<string, Easing>;

export interface TweenOptions {
  durationMs: number;
  delayMs?: number;
  easing?: Easing;
  onUpdate: (value: number, progress: number) => void;
  onComplete?: () => void;
}

interface ActiveTween extends Omit<TweenOptions, 'delayMs'> {
  durationMs: number;
  delayMs: number;
  /** Resolved once at add time so `update` never branches on undefined. */
  easing: Easing;
  onComplete: (() => void) | undefined;
  elapsedMs: number;
  dead: boolean;
}

/** Runs tweens for one engine step. */
export class Tweens {
  private readonly active: ActiveTween[] = [];

  /** Adds a tween and returns a handle you can cancel or chain from. */
  add(options: TweenOptions): TweenHandle {
    const tween: ActiveTween = {
      durationMs: options.durationMs,
      delayMs: options.delayMs ?? 0,
      easing: options.easing ?? Easing.linear,
      onUpdate: options.onUpdate,
      onComplete: options.onComplete,
      elapsedMs: 0,
      dead: false,
    };
    this.active.push(tween);
    return new TweenHandle(tween);
  }

  /**
   * Convenience: scale + offset in one call. This is the most common juice
   * effect in the game (a block merging in), so it gets its own helper.
   */
  punch(
    target: { scale: number; scaleX?: number; scaleY?: number },
    durationMs: number,
    from: number,
    easing: Easing = Easing.outBack,
    onComplete?: () => void,
  ): TweenHandle {
    const base = target.scale;
    return this.add({
      durationMs,
      easing,
      onUpdate: (value) => {
        const s = base + (from - base) * value;
        target.scale = s;
        if (target.scaleX !== undefined && target.scaleY !== undefined) {
          target.scaleX = s;
          target.scaleY = s;
        }
      },
      onComplete,
    });
  }

  update(stepMs: number): void {
    for (const tween of this.active) {
      if (tween.dead) continue;

      tween.elapsedMs += stepMs;
      if (tween.elapsedMs < tween.delayMs) continue;

      const t = tween.elapsedMs - tween.delayMs;
      const raw = Math.min(1, t / tween.durationMs);
      tween.onUpdate(tween.easing(raw), raw);

      if (raw >= 1) {
        tween.dead = true;
        tween.onComplete?.();
      }
    }

    // Compaction: drop finished tweens without allocating a new array each frame.
    let write = 0;
    for (let read = 0; read < this.active.length; read += 1) {
      const tween = this.active[read];
      if (tween && !tween.dead) this.active[write++] = tween;
    }
    this.active.length = write;
  }

  get activeCount(): number {
    return this.active.length;
  }

  killAll(): void {
    this.active.length = 0;
  }
}

export class TweenHandle {
  private readonly tween: ActiveTween;

  constructor(tween: ActiveTween) {
    this.tween = tween;
  }

  /** Stops the tween where it is. `onComplete` will not fire. */
  cancel(): void {
    this.tween.dead = true;
  }

  /** Runs `fn` once this tween completes. */
  then(fn: () => void): TweenHandle {
    const previous = this.tween.onComplete;
    this.tween.onComplete = () => {
      previous?.();
      fn();
    };
    return this;
  }

  get finished(): boolean {
    return this.tween.dead;
  }
}
