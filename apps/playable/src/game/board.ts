/**
 * Merge rules and board state.
 *
 * Deliberately free of any rendering concern: no Pixi, no DOM, no timers. That
 * is what makes the part of the game that can actually be wrong testable in
 * plain Node, and it keeps the "does the game behave the same on a 30Hz phone"
 * question separate from "does it look right".
 */

/** Block tiers. Tier 0 is the smallest; they merge into `tier + 1`. */
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;

export const MAX_TIER: Tier = 5;

export interface Block {
  id: number;
  tier: Tier;
  /** Grid coordinates. */
  col: number;
  row: number;
}

/** Grid size. 4x5 reads well on a portrait phone held one-handed. */
export const COLS = 4;
export const ROWS = 5;
export const CELL_COUNT = COLS * ROWS;

export interface MergeResult {
  /** Both source blocks, already removed from the board by `applyMove`. */
  consumed: [number, number];
  /** The block that now occupies the target cell. */
  produced: Block;
}

export class Board {
  private readonly cells: (Block | null)[] = Array<Block | null>(CELL_COUNT).fill(null);
  private nextId = 1;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.cells.fill(null);
    this.nextId = 1;
  }

  static index(col: number, row: number): number {
    return row * COLS + col;
  }

  get(col: number, row: number): Block | null {
    return this.cells[Board.index(col, row)] ?? null;
  }

  set(block: Block): void {
    this.cells[Board.index(block.col, block.row)] = block;
  }

  remove(id: number): Block | null {
    const idx = this.cells.findIndex((c) => c?.id === id);
    if (idx === -1) return null;
    const block = this.cells[idx] ?? null;
    this.cells[idx] = null;
    return block;
  }

  get occupiedCount(): number {
    let n = 0;
    for (const cell of this.cells) if (cell) n += 1;
    return n;
  }

  get isEmpty(): boolean {
    return this.occupiedCount === 0;
  }

  /** Empty cells as [col, row] pairs, shuffled so spawns are not predictable. */
  emptyCells(random: () => number = Math.random): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        if (!this.cells[Board.index(col, row)]) out.push([col, row]);
      }
    }
    // Fisher-Yates with the injected random source, so tests stay deterministic.
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const a = out[i]!;
      const b = out[j]!;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  spawn(tier: Tier, col: number, row: number): Block {
    const block: Block = { id: this.nextId++, tier, col, row };
    this.set(block);
    return block;
  }

  /** Spawns a block in a random empty cell. Returns null when the board is full. */
  spawnRandom(tier: Tier, random: () => number = Math.random): Block | null {
    const [cell] = this.emptyCells(random);
    if (!cell) return null;
    return this.spawn(tier, cell[0], cell[1]);
  }

  /** Moves a block. Returns false when the destination is not free. */
  move(id: number, col: number, row: number): boolean {
    const block = this.cells.find((c) => c?.id === id);
    if (!block) return false;

    const target = Board.index(col, row);
    if (this.cells[target] && this.cells[target]?.id !== id) return false;

    this.cells[Board.index(block.col, block.row)] = null;
    block.col = col;
    block.row = row;
    this.cells[target] = block;
    return true;
  }

  /**
   * The merge rule, as a pure question.
   *
   * Kept separate from `applyMove` so the UI can ask "would this merge?" for
   * feedback purposes and the simulation stays authoritative.
   */
  canMerge(source: Block, target: Block): boolean {
    return source.id !== target.id && source.tier === target.tier && source.tier < MAX_TIER;
  }

  /**
   * Applies a drop.
   *
   * Returns a `MergeResult` when the two blocks merged, `null` when the block
   * just moved (or the drop was invalid and nothing happened).
   */
  applyMove(sourceId: number, targetCol: number, targetRow: number): MergeResult | null {
    const source = this.cells.find((c) => c?.id === sourceId);
    if (!source) return null;

    const target = this.get(targetCol, targetRow);

    if (!target) {
      // Dropped on empty space: either move there, or fall back to the nearest
      // free cell so a near-miss drop still feels responsive.
      return this.move(sourceId, targetCol, targetRow) ? null : null;
    }

    if (!this.canMerge(source, target)) return null;

    const targetTier = target.tier;
    this.remove(source.id);
    this.remove(target.id);

    const produced = this.spawn((targetTier + 1) as Tier, targetCol, targetRow);
    return { consumed: [source.id, target.id], produced };
  }

  /** Cells adjacent to `block`, for the "one action" magnetism in input. */
  neighbours(block: Block): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const deltas: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of deltas) {
      const col = block.col + dx;
      const row = block.row + dy;
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;
      out.push([col, row]);
    }
    return out;
  }

  /** Snapshot for tests and for the "reset the board" path. */
  toJSON(): { cells: Array<Block | null>; nextId: number } {
    return { cells: this.cells.slice(), nextId: this.nextId };
  }
}

/**
 * Level script.
 *
 * Levels are data rather than code, laid out as pictures, so the whole playable
 * can be reviewed on the screen without tracing game logic. `.` is an empty
 * cell, `0`-`5` is a starting block of that tier.
 *
 * The layouts are chosen, not random: the first level is winnable in a single
 * gesture (the first gesture is also the tutorial), and every later level
 * starts with at least one adjacent same-tier pair so the player is never
 * dropped into a board with nothing to do.
 */
export interface LevelSpec {
  name: string;
  /** One string per row, COLS characters wide. */
  layout: readonly string[];
  /** The tier that ends the round. */
  goal: Tier;
}

export const LEVELS: readonly LevelSpec[] = [
  // One pair, one merge. The first gesture is also the tutorial, so the very
  // first thing a player sees has to be winnable in a single drag.
  {
    name: 'warm-up',
    layout: ['00..', '....', '0...', '....', '....'],
    goal: 1,
  },

  // Two pairs stacked. Both results land adjacent, so tier 2 falls out of three
  // merges without the player having to shuffle a block around first.
  {
    name: 'pair-up',
    layout: ['00..', '00..', '....', '....', '....'],
    goal: 2,
  },

  // Three pairs on a tighter board: the same idea with less room to think,
  // which is what keeps the pace up in the middle of the ad.
  {
    name: 'chain',
    layout: ['00..', '00..', '00..', '0...', '....'],
    goal: 2,
  },
];

/**
 * Builds a board from a level picture.
 *
 * Returns null for a layout with the wrong dimensions, so a bad edit to the
 * level data shows up as a clear error instead of a silently broken board.
 */
export function boardFromLayout(layout: readonly string[]): Board | null {
  if (layout.length !== ROWS) return null;
  for (const row of layout) {
    if (row.length !== COLS) return null;
  }

  const board = new Board();
  layout.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch !== '.') board.spawn(Number(ch) as Tier, col, row);
    });
  });
  return board;
}

export type LevelOutcome = 'won' | 'stuck';

/**
 * Checks whether the round is over.
 *
 * `won` as soon as the goal tier exists. `stuck` when no merge is possible and
 * no free cell remains - that is the only lose condition, and it is deliberately
 * hard to reach in a 15 second ad.
 */
export function evaluateBoard(board: Board, goal: Tier): { done: boolean; outcome: LevelOutcome | null } {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const block = board.get(col, row);
      if (block && block.tier >= goal) return { done: true, outcome: 'won' };
    }
  }

  if (board.occupiedCount >= CELL_COUNT && !hasAnyMerge(board)) {
    return { done: true, outcome: 'stuck' };
  }

  return { done: false, outcome: null };
}

/** True when any two same-tier blocks share an edge. */
export function hasAnyMerge(board: Board): boolean {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const block = board.get(col, row);
      if (!block || block.tier >= MAX_TIER) continue;

      if (col + 1 < COLS) {
        const right = board.get(col + 1, row);
        if (right && right.tier === block.tier) return true;
      }
      if (row + 1 < ROWS) {
        const below = board.get(col, row + 1);
        if (below && below.tier === block.tier) return true;
      }
    }
  }
  return false;
}
