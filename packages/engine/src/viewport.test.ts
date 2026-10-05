import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, MAX_DESIGN_WIDTH, MIN_DESIGN_WIDTH, Viewport } from './viewport.js';

/** Fakes an element of a given CSS size, so `measure` has something to read. */
function elementOf(width: number, height: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({ width, height }) as DOMRect,
    clientWidth: width,
    clientHeight: height,
  } as unknown as HTMLElement;
}

const DESIGN_HEIGHT = DEFAULT_DESIGN.height;

describe('Viewport: design width follows the slot', () => {
  it('matches the design box to a 9:16 slot', () => {
    const v = new Viewport();
    v.measure(elementOf(720, DESIGN_HEIGHT));
    // 720x1280 is exactly the reference design.
    expect(v.design.width).toBe(720);
    expect(v.fitted.x).toBe(0);
  });

  it('widens the design box in a landscape slot instead of letterboxing', () => {
    // This is the bug: a fixed 9:16 box fitted with min() shrank to a narrow
    // strip with dead bands down both sides, so the game floated in an empty
    // frame. 1400 exceeds the clamp, so the width saturates at the maximum and
    // the leftover becomes letterbox - a lesser evil than a board that spans a
    // metre of screen.
    const v = new Viewport();
    v.measure(elementOf(1400, DESIGN_HEIGHT));
    expect(v.design.width).toBe(MAX_DESIGN_WIDTH);
    // The design box is centred in the leftover space.
    expect(v.fitted.x).toBe(Math.round((1400 - MAX_DESIGN_WIDTH) / 2));
  });

  it('follows the slot exactly when it is within the bounds', () => {
    // 1000x1280 is wider than 9:16 but inside the clamp, so there is no
    // letterbox at all.
    const v = new Viewport();
    v.measure(elementOf(1000, DESIGN_HEIGHT));
    expect(v.design.width).toBe(1000);
    expect(v.fitted.x).toBe(0);
  });

  it('narrows the design box in a tall slot', () => {
    const v = new Viewport();
    v.measure(elementOf(560, DESIGN_HEIGHT));
    expect(v.design.width).toBe(560);
  });

  it('keeps the design width inside the bounds', () => {
    const narrow = new Viewport();
    narrow.measure(elementOf(300, DESIGN_HEIGHT));
    expect(narrow.design.width).toBeGreaterThanOrEqual(MIN_DESIGN_WIDTH);

    const wide = new Viewport();
    wide.measure(elementOf(4000, DESIGN_HEIGHT));
    expect(wide.design.width).toBeLessThanOrEqual(MAX_DESIGN_WIDTH);
  });

  it('corrects the scale after clamping, so the design box still fits the height', () => {
    const v = new Viewport();
    v.measure(elementOf(4000, DESIGN_HEIGHT));
    // Height is always covered; width is what may be clamped.
    expect(v.fitted.height).toBeCloseTo(DESIGN_HEIGHT, 1);
  });

  it('produces no horizontal offset in the common cases', () => {
    for (const width of [560, 720, 900, 1100]) {
      const v = new Viewport();
      v.measure(elementOf(width, DESIGN_HEIGHT));
      expect(v.fitted.x).toBe(0);
    }
  });
});

describe('Viewport: measure', () => {
  it('returns true when the size changed', () => {
    const v = new Viewport();
    expect(v.measure(elementOf(720, 1280))).toBe(true);
  });

  it('returns false when nothing changed', () => {
    const v = new Viewport();
    v.measure(elementOf(720, 1280));
    expect(v.measure(elementOf(720, 1280))).toBe(false);
  });

  it('returns true when the size changes', () => {
    const v = new Viewport();
    v.measure(elementOf(720, 1280));
    expect(v.measure(elementOf(390, 844))).toBe(true);
  });

  it('survives a zero-sized element', () => {
    const v = new Viewport();
    expect(() => v.measure(elementOf(0, 0))).not.toThrow();
    expect(Number.isFinite(v.fitScale)).toBe(true);
  });
});

describe('Viewport: coordinate mapping', () => {
  it('round-trips a design point back to the same design point', () => {
    // The invariant behind "cannot play": a touch has to land on the cell whose
    // block was drawn there.
    for (const [w, h] of [
      [720, 1280],
      [390, 844],
      [1000, 700],
    ] as const) {
      const v = new Viewport();
      v.measure(elementOf(w, h));

      for (const [dx, dy] of [
        [0, 0],
        [v.design.width / 2, DESIGN_HEIGHT / 2],
        [v.design.width - 1, DESIGN_HEIGHT - 1],
      ] as const) {
        const scale = v.fitScale;
        const fit = v.fitted;
        const clientX = fit.x + dx * scale;
        const clientY = fit.y + dy * scale;
        const back = v.toDesign(clientX, clientY, { left: 0, top: 0 } as DOMRect);
        expect(back.x).toBeCloseTo(dx, 4);
        expect(back.y).toBeCloseTo(dy, 4);
      }
    }
  });

  it('accounts for the element offset', () => {
    const v = new Viewport();
    v.measure(elementOf(720, 1280));
    const back = v.toDesign(100, 200, { left: 40, top: 60 } as DOMRect);
    expect(back.x).toBeLessThan(100);
    expect(back.y).toBeLessThan(200);
  });
});

describe('Viewport: backbuffer', () => {
  it('scales with the device pixel ratio', () => {
    const v = new Viewport();
    v.measure(elementOf(720, 1280));
    const size = v.backbufferSize();
    expect(size.width).toBe(Math.round(720 * v.dpr));
    expect(size.height).toBe(Math.round(1280 * v.dpr));
  });

  it('honours the quality scale', () => {
    const v = new Viewport();
    v.measure(elementOf(720, 1280));
    const full = v.backbufferSize(1);
    const half = v.backbufferSize(0.5);
    expect(half.width).toBeLessThan(full.width);
  });

  it('never returns zero', () => {
    const v = new Viewport();
    v.measure(elementOf(0, 0));
    const size = v.backbufferSize();
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe('Viewport: insetToDesign', () => {
  it('converts a network inset into design pixels', () => {
    const v = new Viewport();
    v.measure(elementOf(720, 1280));
    // At 1:1 the inset is unchanged.
    expect(v.insetToDesign(120)).toBeCloseTo(120, 3);
  });

  it('scales up when the slot is smaller than the design', () => {
    const v = new Viewport();
    v.measure(elementOf(360, 640));
    expect(v.insetToDesign(60)).toBeCloseTo(120, 3);
  });

  it('never returns a negative inset', () => {
    const v = new Viewport();
    v.measure(elementOf(720, 1280));
    expect(v.insetToDesign(-50)).toBe(0);
  });
});
