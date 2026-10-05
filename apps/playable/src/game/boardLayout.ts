/**
 * Board geometry in design space.
 *
 * Its own module because two places must agree on it exactly: the scene, which
 * draws the blocks, and the input controller, which turns a touch into a grid
 * cell. When those disagreed the game looked correct and simply refused to
 * respond to taps - invisible in a screenshot, obvious the first time anyone
 * tries to play.
 *
 * The board is centred against the design width instead of using a fixed left
 * margin, so it stays put as the design width follows the slot's aspect ratio.
 */
export const COLS = 4;
export const ROWS = 5;

/** Board height as a fraction of the design height. */
const BOARD_HEIGHT_RATIO = 0.55;

/** Space reserved above the board for the hook copy. */
const TOP_RATIO = 0.16;

/** Gap between cells, in design pixels. */
export const GAP = 10;

export interface Layout {
  /** Cell size in design pixels. */
  cell: number;
  /** Left edge of the grid. */
  left: number;
  /** Top edge of the grid. */
  top: number;
}

/** Computes the grid for a design box. */
export function computeLayout(designWidth: number, designHeight: number): Layout {
  const cell = Math.floor((designHeight * BOARD_HEIGHT_RATIO) / ROWS);
  // Bounded by width too, so the board never eats the whole design width.
  const size = Math.max(24, Math.min(cell, Math.floor((designWidth * 0.86) / COLS)));

  return {
    cell: size,
    left: Math.round((designWidth - size * COLS) / 2),
    top: Math.round(designHeight * TOP_RATIO),
  };
}

/** Centre of a cell, in design pixels. */
export function cellCenter(layout: Layout, col: number, row: number): { x: number; y: number } {
  return {
    x: layout.left + col * layout.cell + layout.cell / 2,
    y: layout.top + row * layout.cell + layout.cell / 2,
  };
}

/** Which cell contains a design-space point, or null when outside the grid. */
export function cellAt(layout: Layout, x: number, y: number): { col: number; row: number } | null {
  const col = Math.floor((x - layout.left) / layout.cell);
  const row = Math.floor((y - layout.top) / layout.cell);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return { col, row };
}
