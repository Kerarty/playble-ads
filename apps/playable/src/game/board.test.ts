import { describe, expect, it } from 'vitest';
import {
  Board,
  boardFromLayout,
  COLS,
  evaluateBoard,
  hasAnyMerge,
  LEVELS,
  MAX_TIER,
  ROWS,
  type Tier,
} from './board.js';

/** Builds a board from a grid picture. '.' = empty, '0'-'5' = tier. */
function fromPicture(picture: string[]): Board {
  const board = new Board();
  picture.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch !== '.') board.spawn(Number(ch) as Tier, col, row);
    });
  });
  return board;
}

describe('Board basics', () => {
  it('spawns and finds a block', () => {
    const board = new Board();
    const block = board.spawn(0, 2, 3);
    expect(board.get(2, 3)).toEqual(block);
    expect(board.occupiedCount).toBe(1);
  });

  it('tracks empty cells', () => {
    const board = fromPicture(['....', '....', '0...']);
    expect(board.emptyCells()).toHaveLength(COLS * ROWS - 1);
  });

  it('gives every block a unique id', () => {
    const board = new Board();
    const ids = new Set<number>();
    for (let i = 0; i < 5; i += 1) ids.add(board.spawn(0, i % COLS, Math.floor(i / COLS)).id);
    expect(ids.size).toBe(5);
  });
});

describe('Board.move', () => {
  it('moves a block into a free cell', () => {
    const board = fromPicture(['0...']);
    const id = board.get(0, 0)!.id;
    expect(board.move(id, 3, 2)).toBe(true);
    expect(board.get(0, 0)).toBeNull();
    expect(board.get(3, 2)?.id).toBe(id);
  });

  it('refuses to move onto an occupied cell', () => {
    const board = fromPicture(['00..']);
    const id = board.get(0, 0)!.id;
    expect(board.move(id, 1, 0)).toBe(false);
    expect(board.get(0, 0)?.id).toBe(id);
  });

  it('returns false for an unknown id', () => {
    expect(new Board().move(999, 0, 0)).toBe(false);
  });
});

describe('Board.applyMove', () => {
  it('merges two same-tier neighbours into the next tier', () => {
    const board = fromPicture(['00...']);
    const a = board.get(0, 0)!;
    const b = board.get(1, 0)!;

    const result = board.applyMove(a.id, b.col, b.row);

    expect(result).not.toBeNull();
    expect(result!.produced.tier).toBe(1);
    expect(board.get(1, 0)?.id).toBe(result!.produced.id);
    expect(board.occupiedCount).toBe(1);
  });

  it('consumes both source blocks', () => {
    const board = fromPicture(['00...']);
    const a = board.get(0, 0)!;
    const b = board.get(1, 0)!;
    const result = board.applyMove(a.id, b.col, b.row)!;

    expect(result.consumed).toContain(a.id);
    expect(result.consumed).toContain(b.id);
    expect(board.get(0, 0)).toBeNull();
  });

  it('refuses to merge different tiers', () => {
    const board = fromPicture(['01...']);
    const a = board.get(0, 0)!;
    const b = board.get(1, 0)!;
    expect(board.applyMove(a.id, b.col, b.row)).toBeNull();
    expect(board.occupiedCount).toBe(2);
  });

  it('refuses to merge a block into itself', () => {
    const board = fromPicture(['0....']);
    const a = board.get(0, 0)!;
    expect(board.applyMove(a.id, a.col, a.row)).toBeNull();
  });

  it('never merges past the max tier', () => {
    const board = fromPicture([`${MAX_TIER}${MAX_TIER}..`]);
    const a = board.get(0, 0)!;
    const b = board.get(1, 0)!;
    expect(board.applyMove(a.id, b.col, b.row)).toBeNull();
    expect(board.get(0, 0)?.tier).toBe(MAX_TIER);
  });

  it('moves into an empty cell without merging', () => {
    const board = fromPicture(['0...']);
    const a = board.get(0, 0)!;
    const result = board.applyMove(a.id, 2, 1);
    expect(result).toBeNull();
    expect(board.get(2, 1)?.id).toBe(a.id);
  });

  it('chains: two tier-1 results merge into tier 2 once moved together', () => {
    // Two isolated tier-0 pairs, far enough apart that the tier-1 results only
    // meet after the player drags one of them.
    const board = fromPicture(['00..', '....', '..00']);

    const a = board.get(0, 0)!;
    const b = board.get(1, 0)!;
    expect(board.applyMove(a.id, b.col, b.row)!.produced.tier).toBe(1);

    const c = board.get(2, 2)!;
    const d = board.get(3, 2)!;
    expect(board.applyMove(c.id, d.col, d.row)!.produced.tier).toBe(1);

    const firstTier1 = board.get(1, 0)!;
    const secondTier1 = board.get(3, 2)!;

    // Bring them together, then merge.
    expect(board.canMerge(firstTier1, secondTier1)).toBe(true);
    expect(board.move(firstTier1.id, 3, 1)).toBe(true);
    expect(board.get(3, 2)!.id).toBe(secondTier1.id);

    const merged = board.applyMove(board.get(3, 1)!.id, 3, 2);
    expect(merged!.produced.tier).toBe(2);
    expect(board.get(3, 2)?.tier).toBe(2);
  });
});

describe('hasAnyMerge', () => {
  it('finds a horizontal pair', () => {
    expect(hasAnyMerge(fromPicture(['00..']))).toBe(true);
  });

  it('finds a vertical pair', () => {
    expect(hasAnyMerge(fromPicture(['0...', '0...']))).toBe(true);
  });

  it('ignores diagonal pairs', () => {
    expect(hasAnyMerge(fromPicture(['0...', '.0..']))).toBe(false);
  });

  it('ignores different tiers', () => {
    expect(hasAnyMerge(fromPicture(['01..']))).toBe(false);
  });

  it('does not count max tier pairs', () => {
    expect(hasAnyMerge(fromPicture([`${MAX_TIER}${MAX_TIER}..`]))).toBe(false);
  });
});

describe('evaluateBoard', () => {
  it('is not done on an empty board', () => {
    expect(evaluateBoard(new Board(), 1)).toEqual({ done: false, outcome: null });
  });

  it('wins when the goal tier is present', () => {
    expect(evaluateBoard(fromPicture(['1....']), 1)).toEqual({ done: true, outcome: 'won' });
  });

  it('counts tiers above the goal as a win', () => {
    expect(evaluateBoard(fromPicture(['3....']), 1).outcome).toBe('won');
  });

  it('is not done when the board has free cells even without merges', () => {
    expect(evaluateBoard(fromPicture(['0.1.', '.2.3']), 4).done).toBe(false);
  });

  it('ends as stuck only when full with no merge available', () => {
    const board = fromPicture(['0123', '1230', '2301', '3012', '0123']);
    expect(hasAnyMerge(board)).toBe(false);
    const result = evaluateBoard(board, MAX_TIER + 1 as Tier);
    expect(result).toEqual({ done: true, outcome: 'stuck' });
  });
});

describe('LEVELS', () => {
  it('fits the grid exactly', () => {
    for (const level of LEVELS) {
      expect(boardFromLayout(level.layout)).not.toBeNull();
    }
  });

  it('only uses valid tier characters', () => {
    for (const level of LEVELS) {
      for (const row of level.layout) {
        expect(row).toMatch(/^[.0-5]*$/);
      }
    }
  });

  it('always starts with at least one adjacent same-tier pair', () => {
    // A level the player cannot act on immediately makes a terrible ad, so this
    // is asserted rather than trusted.
    for (const level of LEVELS) {
      expect(hasAnyMerge(boardFromLayout(level.layout)!)).toBe(true);
    }
  });

  it('never spawns a block at or above the goal tier', () => {
    // Starting at the goal would end the round before the player touches it.
    for (const level of LEVELS) {
      const board = boardFromLayout(level.layout)!;
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const block = board.get(col, row);
          if (block) expect(block.tier).toBeLessThan(level.goal);
        }
      }
    }
  });

  it('is not won before the first gesture', () => {
    for (const level of LEVELS) {
      expect(evaluateBoard(boardFromLayout(level.layout)!, level.goal).done).toBe(false);
    }
  });

  it('can be won by merging the starting blocks alone', () => {
    // Each level must be completable without extra spawns, otherwise the round
    // depends on a random refill that might not come.
    for (const level of LEVELS) {
      const board = boardFromLayout(level.layout)!;
      let guard = 0;
      while (!evaluateBoard(board, level.goal).done && guard < 200) {
        guard += 1;
        const target = findMerge(board);
        if (!target) break;
        board.applyMove(target.source.id, target.target.col, target.target.row);
      }
      expect(evaluateBoard(board, level.goal).outcome).toBe('won');
    }
  });
});

describe('boardFromLayout', () => {
  it('rejects a layout with the wrong number of rows', () => {
    expect(boardFromLayout(['00..', '....'])).toBeNull();
  });

  it('rejects a row of the wrong width', () => {
    expect(boardFromLayout(['00..', '00...', '....', '....', '....'])).toBeNull();
  });

  it('leaves dots empty', () => {
    const board = boardFromLayout(['00..', '....', '....', '....', '....'])!;
    expect(board.occupiedCount).toBe(2);
    expect(board.get(2, 0)).toBeNull();
  });
});

/** Finds any available merge, for solvability checks. */
function findMerge(board: Board): { source: { id: number }; target: { col: number; row: number } } | null {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const block = board.get(col, row);
      if (!block || block.tier >= MAX_TIER) continue;
      for (const [nc, nr] of board.neighbours(block)) {
        const neighbour = board.get(nc, nr);
        if (neighbour && board.canMerge(block, neighbour)) {
          return { source: { id: block.id }, target: { col: nc, row: nr } };
        }
      }
    }
  }
  return null;
}
