import { describe, expect, it } from 'vitest';
import { cellAt, cellCenter, computeLayout, COLS, ROWS } from './boardLayout.js';

describe('computeLayout', () => {
  it('centres the grid horizontally', () => {
    const layout = computeLayout(720, 1280);
    const gridWidth = layout.cell * COLS;
    expect(layout.left).toBe(Math.round((720 - gridWidth) / 2));
  });

  it('leaves room above the board for the hook copy', () => {
    const layout = computeLayout(720, 1280);
    expect(layout.top).toBeGreaterThan(0);
    // Copy sits in the top ~10%, so the board must start below it.
    expect(layout.top).toBeGreaterThan(1280 * 0.1);
  });

  it('keeps the grid inside the design box', () => {
    for (const [w, h] of [
      [720, 1280],
      [390, 844],
      [1100, 700],
      [560, 1280],
    ] as const) {
      const layout = computeLayout(w, h);
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.left + layout.cell * COLS).toBeLessThanOrEqual(w + 1);
      expect(layout.top + layout.cell * ROWS).toBeLessThanOrEqual(h + 1);
    }
  });

  it('scales the cell with the slot', () => {
    const small = computeLayout(720, 720);
    const large = computeLayout(720, 1440);
    expect(large.cell).toBeGreaterThan(small.cell);
  });

  it('never produces an unusable cell', () => {
    // A very short slot still has to leave something you can tap.
    const layout = computeLayout(1100, 200);
    expect(layout.cell).toBeGreaterThanOrEqual(24);
  });
});

describe('cellCenter and cellAt', () => {
  it('round-trips: the centre of a cell resolves back to that cell', () => {
    // This is the invariant that broke the game. When the renderer and the input
    // controller computed cells differently, the picture looked perfect and
    // taps did nothing.
    for (const [w, h] of [
      [720, 1280],
      [390, 844],
      [980, 700],
      [560, 1280],
      [1100, 900],
    ] as const) {
      const layout = computeLayout(w, h);
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const center = cellCenter(layout, col, row);
          expect(cellAt(layout, center.x, center.y)).toEqual({ col, row });
        }
      }
    }
  });

  it('resolves a point just inside a cell to that cell', () => {
    const layout = computeLayout(720, 1280);
    const center = cellCenter(layout, 1, 2);
    expect(cellAt(layout, center.x - layout.cell * 0.3, center.y + layout.cell * 0.3)).toEqual({
      col: 1,
      row: 2,
    });
  });

  it('returns null outside the grid', () => {
    const layout = computeLayout(720, 1280);
    expect(cellAt(layout, -50, -50)).toBeNull();
    expect(cellAt(layout, 5000, 5000)).toBeNull();
    expect(cellAt(layout, -1, 100)).toBeNull();
  });

  it('returns null for the gap between cells being outside', () => {
    // Gaps belong to the nearest cell, so a drop in a gap still lands. A null
    // here would make drops in the spacing feel dead.
    const layout = computeLayout(720, 1280);
    const center = cellCenter(layout, 0, 0);
    expect(cellAt(layout, center.x + layout.cell * 0.45, center.y)).not.toBeNull();
  });
});
