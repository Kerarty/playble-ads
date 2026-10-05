/**
 * Fixed-timestep game loop with an interpolated render.
 *
 * Why not just `requestAnimationFrame` and use `deltaTime` directly:
 * simulation that depends on frame timing changes behaviour between a 60Hz and
 * a 30Hz device. A playable has to behave identically on both, otherwise the
 * thing QA tested is not what users see. So the simulation always advances in
 * fixed steps and rendering happens once per animation frame.
 *
 * We also clamp the catch-up budget: after a stall (tab in the background, a GC
 * pause) the loop must not try to simulate hundreds of steps at once and freeze
 * again. Dropping the backlog loses simulated time, which is the correct trade
 * for an ad.
 */

/** Simulation step in milliseconds. 60Hz. */
export const FIXED_STEP_MS = 1000 / 60;

/** Never simulate more than this many steps in one frame. */
export const MAX_CATCHUP_STEPS = 5;

/** Float slack for the step comparison. See the loop body. */
const STEP_EPSILON_MS = 1e-6;

export interface LoopCallbacks {
  /**
   * Advance the simulation by exactly `stepMs`.
   *
   * `elapsedMs` is the total simulated time so far, for logic that wants to run
   * on a wall-clock interval rather than every step.
   */
  fixedUpdate(stepMs: number, elapsedMs: number): void;
  /** Draw one frame. `alpha` is where we are between the last two sim steps. */
  render(alpha: number): void;
}

export interface LoopHandle {
  start(): void;
  stop(): void;
  readonly running: boolean;
  /** Total simulated milliseconds since start. */
  elapsedMs(): number;
  destroy(): void;
}

export interface LoopOptions extends LoopCallbacks {
  /** Injected for tests; defaults to requestAnimationFrame. */
  requestFrame?: (cb: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
}

export function createLoop(options: LoopOptions): LoopHandle {
  const requestFrame =
    options.requestFrame ??
    ((cb: (time: number) => void): number =>
      typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(() => cb(now()), 16) as unknown as number));

  const cancelFrame =
    options.cancelFrame ??
    ((handle: number): void => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
      else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
    });

  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));

  let running = false;
  let handle: number | undefined;
  let lastTime = 0;
  let accumulator = 0;
  let elapsed = 0;

  function frame(time: number): void {
    if (!running) return;

    const delta = Math.max(0, time - lastTime);
    lastTime = time;
    accumulator += delta;

    let steps = 0;
    // The epsilon matters more than it looks. `1000/60` is not exact in binary,
    // so three accumulated steps leave 16.666666666666664 - a hair under the
    // step size - and a naive comparison silently drops the third step. A real
    // renderer would jitter at that boundary.
    while (accumulator + STEP_EPSILON_MS >= FIXED_STEP_MS && steps < MAX_CATCHUP_STEPS) {
      accumulator -= FIXED_STEP_MS;
      elapsed += FIXED_STEP_MS;
      options.fixedUpdate(FIXED_STEP_MS, elapsed);
      steps += 1;
    }

    // Clamp instead of zeroing: a negative remainder (possible once the epsilon
    // lets us take a step we technically do not have time for) must not carry
    // into the next frame and cause an early step there.
    if (accumulator < 0) accumulator = 0;

    if (steps === MAX_CATCHUP_STEPS) {
      // We could not keep up. Drop the backlog rather than accumulate debt.
      accumulator = 0;
    }

    options.render(accumulator / FIXED_STEP_MS);
    handle = requestFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTime = now();
      accumulator = 0;
      handle = requestFrame(frame);
    },
    stop() {
      running = false;
      if (handle !== undefined) {
        cancelFrame(handle);
        handle = undefined;
      }
    },
    get running() {
      return running;
    },
    elapsedMs: () => elapsed,
    destroy() {
      this.stop();
    },
  };
}
