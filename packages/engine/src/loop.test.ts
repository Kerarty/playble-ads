import { describe, expect, it, vi } from 'vitest';
import { createLoop, FIXED_STEP_MS, MAX_CATCHUP_STEPS } from './loop.js';

/**
 * Drives the loop with a fake clock so the tests are deterministic and do not
 * depend on how fast the machine runs them.
 */
function fakeClock() {
  let time = 0;
  let pending: ((t: number) => void) | undefined;

  return {
    requestFrame: (cb: (t: number) => void): number => {
      pending = cb;
      return 1;
    },
    cancelFrame: (): void => {
      pending = undefined;
    },
    now: (): number => time,
    /** Advances time by `ms` and runs one animation frame. */
    tick(ms: number): void {
      time += ms;
      const cb = pending;
      expect(cb).toBeDefined();
      pending = undefined;
      cb?.(time);
    },
  };
}

describe('createLoop', () => {
  it('does nothing until started', () => {
    const fixed = vi.fn();
    const render = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: fixed, render });

    expect(loop.running).toBe(false);
    expect(fixed).not.toHaveBeenCalled();
  });

  it('runs one fixed step per elapsed fixed step', () => {
    const fixed = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: fixed, render: vi.fn() });

    loop.start();
    clock.tick(FIXED_STEP_MS);

    expect(fixed).toHaveBeenCalledTimes(1);
    expect(fixed).toHaveBeenCalledWith(FIXED_STEP_MS);
  });

  it('takes several steps for a long frame', () => {
    const fixed = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: fixed, render: vi.fn() });

    loop.start();
    clock.tick(FIXED_STEP_MS * 3);

    expect(fixed).toHaveBeenCalledTimes(3);
  });

  it('does not step on a frame shorter than the fixed step', () => {
    const fixed = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: fixed, render: vi.fn() });

    loop.start();
    clock.tick(FIXED_STEP_MS * 0.5);

    expect(fixed).not.toHaveBeenCalled();
  });

  it('takes the third step when the frame is exactly three steps long', () => {
    // Guards the float drift in the step comparison: 3 * (1000/60) does not
    // decompose cleanly into three subtractions of (1000/60).
    const fixed = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: fixed, render: vi.fn() });

    loop.start();
    clock.tick(FIXED_STEP_MS * 3);

    expect(fixed).toHaveBeenCalledTimes(3);
  });

  it('does not double-step across consecutive frames', () => {
    // Leftover time is carried between frames on purpose (that is how 60Hz
    // stays smooth on a 90Hz display). What must never happen is one rendered
    // frame triggering two extra steps: that reads as a hitch, not smoothness.
    const fixed = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: fixed, render: vi.fn() });

    loop.start();

    // A frame just over one step leaves a sliver behind...
    clock.tick(FIXED_STEP_MS + 0.001);
    expect(fixed).toHaveBeenCalledTimes(1);
    fixed.mockClear();

    // ...and a following frame just under one step must not add a second.
    clock.tick(FIXED_STEP_MS - 0.001);
    expect(fixed).toHaveBeenCalledTimes(1);
  });

  it('renders once per animation frame, not once per step', () => {
    const render = vi.fn();
    const fixed = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: fixed, render });

    loop.start();
    clock.tick(FIXED_STEP_MS * 3);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('passes an interpolation alpha between steps', () => {
    const render = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: vi.fn(), render });

    loop.start();
    clock.tick(FIXED_STEP_MS * 1.5);

    const alpha = render.mock.calls[0]?.[0] as number;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it('caps catch-up work after a long stall', () => {
    const fixed = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: fixed, render: vi.fn() });

    loop.start();
    // Ten seconds of stall in a single frame.
    clock.tick(10_000);

    expect(fixed).toHaveBeenCalledTimes(MAX_CATCHUP_STEPS);
  });

  it('drops the backlog instead of accumulating debt', () => {
    const fixed = vi.fn();
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: fixed, render: vi.fn() });

    loop.start();
    clock.tick(10_000); // hits the cap and resets the accumulator

    fixed.mockClear();
    clock.tick(FIXED_STEP_MS); // next frame should be a normal single step
    expect(fixed).toHaveBeenCalledTimes(1);
  });

  it('ignores a backwards clock jump', () => {
    // Some in-app WebViews report a timestamp that goes backwards after the app
    // resumes from the background. A negative delta must not simulate time.
    const fixed = vi.fn();
    const render = vi.fn();
    let time = 1000;
    let pending: ((t: number) => void) | undefined;

    const loop = createLoop({
      requestFrame: (cb) => {
        pending = cb;
        return 1;
      },
      cancelFrame: () => {
        pending = undefined;
      },
      now: () => time,
      fixedUpdate: fixed,
      render,
    });

    loop.start();

    time = 0; // the clock jumped backwards
    pending?.(time);

    expect(fixed).not.toHaveBeenCalled();
    // Render still happens, otherwise the frame after a resume would show a
    // stale image.
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('stops requesting frames after stop()', () => {
    const fixed = vi.fn();
    const requestFrame = vi.fn((cb: (t: number) => void): number => {
      pending = cb;
      return 1;
    });
    let time = 0;
    let pending: ((t: number) => void) | undefined;

    const loop = createLoop({
      requestFrame,
      cancelFrame: () => {
        pending = undefined;
      },
      now: () => time,
      fixedUpdate: fixed,
      render: vi.fn(),
    });

    loop.start();
    expect(requestFrame).toHaveBeenCalledTimes(1);

    time = FIXED_STEP_MS;
    pending?.(time);
    expect(requestFrame).toHaveBeenCalledTimes(2);

    loop.stop();
    expect(loop.running).toBe(false);
    expect(pending).toBeUndefined();
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it('ignores a second start()', () => {
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: vi.fn(), render: vi.fn() });

    loop.start();
    loop.start();
    expect(loop.running).toBe(true);
  });

  it('accumulates simulated time', () => {
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: vi.fn(), render: vi.fn() });

    loop.start();
    clock.tick(FIXED_STEP_MS * 5);
    expect(loop.elapsedMs()).toBeCloseTo(FIXED_STEP_MS * 5, 5);
  });

  it('destroy() stops the loop', () => {
    const clock = fakeClock();
    const loop = createLoop({ ...clock, fixedUpdate: vi.fn(), render: vi.fn() });

    loop.start();
    loop.destroy();
    expect(loop.running).toBe(false);
  });
});
