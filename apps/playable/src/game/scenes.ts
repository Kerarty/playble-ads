/**
 * Rendering.
 *
 * Everything that touches Pixi lives here, so `board.ts` stays testable in Node.
 *
 * Three decisions worth explaining:
 *
 * 1. Blocks are drawn with `Graphics`, not sprites. A playable needs one small
 *    set of shapes, and generating them at runtime removes the whole texture
 *    atlas from the bundle. It also lets every tier scale cleanly without
 *    shipping six images.
 *
 * 2. Every block view comes from a pool. A merge frees two views and takes one
 *    from the pool, so steady-state gameplay allocates nothing and cannot
 *    trigger a GC stutter mid-animation - which reads to the user as a laggy ad.
 *
 * 3. All animation goes through the scene's `Tweens` instance, which the engine
 *    steps from the fixed timestep. Nothing here schedules its own work, so
 *    every animation is frame-rate independent and can be paused with the game.
 */
import { Container, Graphics, Text } from 'pixi.js';
import { Easing, Pool, type Tweens } from '@playble/engine';
import { Board, CELL_COUNT, COLS, ROWS, type Block, type Tier } from './board.js';
import { COLS as LAYOUT_COLS, GAP, cellCenter, computeLayout, type Layout } from './boardLayout.js';
import { paletteFor } from './palette.js';

export interface SceneMetrics {
  blocks: number;
  /** Views allocated so far; compare across runs to spot churn. */
  viewsCreated: number;
}

export class Scene {
  readonly board = new Board();

  /**
   * Grid geometry. Recomputed whenever the design box changes shape, so the
   * board stays centred and keeps a sane cell size in any slot.
   */
  private layout: Layout;

  private readonly blockLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly views = new Map<number, BlockView>();
  private readonly pool: Pool<BlockView>;
  /** Pairs currently highlighted by the tutorial hint. */
  private hintedPairs: Array<[Block, Block]> = [];
  /** Block being dragged, so the scene can clean up after a level change. */
  private draggedId: number | null = null;
  private metrics: SceneMetrics = { blocks: 0, viewsCreated: 0 };

  constructor(world: Container, private readonly tweens: Tweens, designWidth = 720, designHeight = 1280) {
    this.layout = computeLayout(designWidth, designHeight);

    this.pool = new Pool<BlockView>(
      () => {
        const view = new BlockView();
        this.blockLayer.addChild(view.root);
        this.metrics.viewsCreated += 1;
        return view;
      },
      (view) => view.reset(),
      8,
    );

    world.addChild(this.blockLayer, this.fxLayer);
  }

  /** Loads a level picture onto the board and animates it in. */
  loadLayout(layout: readonly string[], staggerMs = 26): void {
    this.cancelDrag();
    this.clearBlocks();

    const size = this.layout.cell - GAP * 2;

    layout.forEach((line, row) => {
      [...line].forEach((ch, col) => {
        if (ch === '.') return;
        const block = this.board.spawn(Number(ch) as Tier, col, row);
        const view = this.pool.get();
        const center = this.cellCenter(col, row);
        view.show(block, center.x, center.y, size);
        view.popIn(this.tweens, staggerMs * (row * LAYOUT_COLS + col));
        this.views.set(block.id, view);
      });
    });

    this.metrics.blocks = this.views.size;
  }

  /**
   * Recentres the grid and redraws every block at the new cell size.
   *
   * Called when the design box changes shape. Positions come from the layout
   * rather than from each view's remembered values, so a resize cannot leave a
   * block stranded at its old coordinates.
   */
  setDesignSize(width: number, height: number): void {
    const next = computeLayout(width, height);
    if (next.cell === this.layout.cell && next.left === this.layout.left && next.top === this.layout.top) {
      return;
    }
    this.layout = next;

    for (const block of this.board.blocks()) {
      const center = cellCenter(this.layout, block.col, block.row);
      this.views.get(block.id)?.place(center.x, center.y, this.layout.cell - GAP * 2);
    }
  }

  cellCenter(col: number, row: number): { x: number; y: number } {
    return cellCenter(this.layout, col, row);
  }

  get currentLayout(): Layout {
    return this.layout;
  }

  /**
   * Tops the board up when nothing can be merged.
   *
   * Public because the boot script calls it before pointing the tutorial hint at
   * a pair: a layout edited into something unsolvable would otherwise leave the
   * ad sitting on a dead board.
   */
  ensurePlayable(random: () => number = Math.random): void {
    this.refillIfStuck(random);
  }

  /** The view for a block, for input code that needs to move it directly. */
  view(blockId: number): BlockView | undefined {
    return this.views.get(blockId);
  }

  /** The block a given id refers to, or null. */
  boardOf(blockId: number): Block | null {
    const cell = this.cellOf(blockId);
    if (!cell) return null;
    return this.board.get(cell[0], cell[1]);
  }

  tierAt(col: number, row: number): number | null {
    return this.board.get(col, row)?.tier ?? null;
  }

  /** Outlines one block as the current drop target. */
  highlight(blockId: number): void {
    this.views.get(blockId)?.setHint();
  }

  /**
   * The partner the hint is currently pointing at, if the given block is part
   * of a hinted pair. Lets a tap stand in for a drag.
   */
  hintPartnerFor(blockId: number): { col: number; row: number } | null {
    for (const pair of this.hintedPairs) {
      const [a, b] = pair;
      if (a.id === blockId) return { col: b.col, row: b.row };
      if (b.id === blockId) return { col: a.col, row: a.row };
    }
    return null;
  }

  /** Finds the grid position of a block id. */
  cellOf(blockId: number): [number, number] | null {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        if (this.board.get(col, row)?.id === blockId) return [col, row];
      }
    }
    return null;
  }

  /**
   * Handles a completed drop.
   *
   * Returns true when the drop merged, which is the caller's cue to play merge
   * feedback and count the move.
   *
   * A successful merge spawns a replacement block. This is not decoration: a
   * merge board with no refill reaches a state where no two blocks match and no
   * merge is possible while cells are still free, which `evaluateBoard` correctly
   * reports as "not done, not stuck" - and the round is then unwinnable. Refilling
   * on merge is the standard rule for the genre and it keeps the board alive.
   */
  drop(sourceId: number, targetCol: number, targetRow: number, random: () => number = Math.random): boolean {
    this.draggedId = null;

    const sourceCell = this.cellOf(sourceId);
    if (!sourceCell) return false;

    const source = this.board.get(sourceCell[0], sourceCell[1]);
    if (!source) return false;

    const result = this.board.applyMove(sourceId, targetCol, targetRow);

    if (!result) {
      // No merge. Either the block moved to an empty cell, or the drop was
      // refused and it must spring back - silently doing nothing reads as a
      // dropped frame rather than as a rejected move.
      const occupant = this.board.get(targetCol, targetRow);
      const home = this.cellCenter(source.col, source.row);
      const view = this.views.get(sourceId);

      if (view) {
        if (!occupant) {
          const to = this.cellCenter(targetCol, targetRow);
          view.glideTo(this.tweens, to.x, to.y);
        } else {
          view.glideTo(this.tweens, home.x, home.y);
        }
      }

      // A plain move can break the board just as a merge can: moving the last
      // pair apart leaves nothing to merge and free cells to spare, which is an
      // unwinnable round. The invariant has to hold after every change, not just
      // after merges.
      this.refillIfStuck(random);

      return false;
    }

    const size = this.layout.cell - GAP * 2;

    const [movedId, targetId] = result.consumed;
    this.releaseView(movedId);
    this.releaseView(targetId);

    const view = this.pool.get();
    const center = this.cellCenter(targetCol, targetRow);
    view.show(result.produced, center.x, center.y, size);
    view.popMerge(this.tweens);
    this.views.set(result.produced.id, view);

    this.burst(center, result.produced.tier, size);
    this.bumpNeighbours(targetCol, targetRow, result.produced.id);

    // Keep the board playable. A merge consumes two blocks and makes one, so the
    // pairs run out; without this the round dead-ends with free cells and nothing
    // to do, which is the worst possible state in an ad. See
    // `Board.ensurePlayable`.
    this.refillIfStuck(random);

    this.metrics.blocks = this.views.size;
    return true;
  }

  /**
   * Adds a block when the board has no merge available, entering from the top of
   * its cell so it reads as "dropped in" rather than "appeared".
   *
   * Called after every board change, not only after merges: a plain move can
   * separate the last pair just as effectively.
   */
  refillIfStuck(random: () => number = Math.random): void {
    const refill = this.board.ensurePlayable(random);
    if (!refill) return;

    const view = this.pool.get();
    const center = this.cellCenter(refill.col, refill.row);
    view.show(refill, center.x, center.y - this.layout.cell / 2, this.layout.cell - GAP * 2);
    view.popIn(this.tweens, 90);
    this.views.set(refill.id, view);
  }

  /** Highlights the first mergeable pair and nudges one block toward the other. */
  hintFirstPair(tier: number): void {
    this.clearHint();

    const pair = this.findPair(tier);
    if (!pair) return;

    this.hintedPairs = [pair];
    for (const block of pair) this.views.get(block.id)?.setHint();

    const a = this.views.get(pair[0].id);
    const b = this.views.get(pair[1].id);
    if (!a || !b) return;

    const from = this.cellCenter(pair[0].col, pair[0].row);
    const toward = this.cellCenter(pair[1].col, pair[1].row);

    // A small nudge: enough to read as "these two", not so much that the board
    // looks broken. Capped at a fraction of the distance between cells rather
    // than a fixed fraction of the way, so it stays subtle in a large cell and
    // still reads in a small one.
    const reach = Math.min(this.layout.cell * 0.16, 60);

    this.tweens.add({
      durationMs: 460,
      easing: Easing.inOutSine,
      onUpdate: (t) => {
        const pulse = Math.sin(t * Math.PI);
        const dx = toward.x - from.x;
        const dy = toward.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        a.root.x = from.x + (dx / len) * reach * pulse;
        a.root.y = from.y + (dy / len) * reach * pulse;
      },
      onComplete: () => a.snapTo(from.x, from.y),
    });
  }

  findPair(tier: number): [Block, Block] | null {
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const block = this.board.get(col, row);
        if (!block || block.tier !== tier) continue;
        for (const [nc, nr] of this.board.neighbours(block)) {
          const neighbour = this.board.get(nc, nr);
          if (neighbour && neighbour.tier === tier) return [block, neighbour];
        }
      }
    }
    return null;
  }

  clearHint(): void {
    this.hintedPairs = [];
    for (const view of this.views.values()) view.clearHint();
  }

  /** Win-state flourish: every block on the board lifts and wobbles in turn. */
  celebrate(): void {
    let delay = 0;
    for (const view of this.views.values()) {
      view.celebrate(this.tweens, delay);
      delay += 45;
    }
  }

  get stats(): SceneMetrics {
    return { ...this.metrics };
  }

  get blocksInPlay(): number {
    return this.views.size;
  }

  /** A board must never hold more views than it has cells. */
  get capacityOk(): boolean {
    return this.blocksInPlay <= CELL_COUNT;
  }

  private bumpNeighbours(col: number, row: number, excludeId: number): void {
    const deltas: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dc, dr] of deltas) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const block = this.board.get(nc, nr);
      if (!block || block.id === excludeId) continue;
      this.views.get(block.id)?.bump(this.tweens);
    }
  }

  /** Merge feedback: an expanding ring plus a small particle scatter. */
  /** Merge feedback: an expanding ring plus a small particle scatter. */
  private burst(center: { x: number; y: number }, tier: Tier, size: number): void {
    const palette = paletteFor(tier);

    const ring = new Graphics();
    ring.circle(0, 0, size * 0.16).stroke({ width: Math.max(3, size * 0.05), color: palette.accent, alpha: 0.95 });
    ring.position.set(center.x, center.y);
    this.fxLayer.addChild(ring);

    this.tweens.add({
      durationMs: 340,
      easing: Easing.outCubic,
      onUpdate: (t) => {
        ring.scale.set(1 + t * 1.7);
        ring.alpha = 1 - t;
      },
      onComplete: () => ring.destroy(),
    });

    // Ten particles, and each is its own tiny Graphics. One shared particle
    // texture would be smaller in the bundle but needs more code, and the size
    // difference does not matter next to Pixi itself.
    const dotSize = Math.max(3, size * 0.04);
    const reach = size * 0.9;

    for (let i = 0; i < 10; i += 1) {
      const dot = new Graphics();
      dot.circle(0, 0, dotSize).fill(palette.shine);
      dot.position.set(center.x, center.y);
      this.fxLayer.addChild(dot);

      const angle = (i / 10) * Math.PI * 2;
      const distance = reach * (0.7 + (i % 3) * 0.18);

      this.tweens.add({
        durationMs: 380 + (i % 4) * 40,
        easing: Easing.outQuad,
        onUpdate: (t) => {
          dot.x = center.x + Math.cos(angle) * distance * t;
          dot.y = center.y + Math.sin(angle) * distance * t;
          dot.alpha = 1 - t;
        },
        onComplete: () => dot.destroy(),
      });
    }
  }

  /** Clears transient drag state so a level change cannot leak it. */
  cancelDrag(): void {
    const active = this.draggedId;
    this.draggedId = null;

    if (active === null) return;
    const view = this.views.get(active);
    const cell = this.cellOf(active);
    if (view && cell) {
      const center = this.cellCenter(cell[0], cell[1]);
      view.snapTo(center.x, center.y);
    }
  }

  private releaseView(blockId: number): void {
    const view = this.views.get(blockId);
    if (!view) return;
    this.views.delete(blockId);
    this.pool.release(view);
  }

  private clearBlocks(): void {
    for (const id of [...this.views.keys()]) this.releaseView(id);
    this.board.reset();
    this.metrics.blocks = 0;
  }

  destroy(): void {
    this.clearBlocks();
    this.tweens.killAll();
    this.fxLayer.destroy({ children: true });
    this.blockLayer.destroy({ children: true });
  }
}

/**
 * One block on screen. Pooled, so it keeps no state between uses.
 *
 * `gap` is passed in rather than imported as a constant because the drawn size
 * follows the cell size, which adapts to the slot.
 */
class BlockView {
  readonly root = new Container();

  private readonly body = new Graphics();
  private readonly label: Text;
  private hintAlpha = 0;

  constructor() {
    this.label = new Text({
      text: '',
      style: {
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        fontSize: 46,
        fontWeight: '700',
      },
    });
    this.label.anchor.set(0.5);
    this.label.visible = false;

    this.root.addChild(this.body, this.label);
    this.root.visible = false;
  }

  show(block: Block, x: number, y: number, size: number): void {
    this.draw(block.tier, size);

    this.root.position.set(x, y);
    this.root.scale.set(1);
    this.root.alpha = 1;
    this.root.visible = true;
    this.hintAlpha = 0;
  }

  /** Repositions and redraws at a new cell size, without touching animation. */
  place(x: number, y: number, size: number): void {
    this.root.position.set(x, y);
    this.draw(this.tier, size);
  }

  private draw(tier: Tier, size: number): void {
    const palette = paletteFor(tier);
    const half = size / 2;
    const radius = Math.max(6, size * 0.16);
    const stroke = Math.max(2, size * 0.04);

    this.tier = tier;

    this.body.clear();
    this.body.roundRect(-half, -half, size, size, radius).fill(palette.fill);
    // A lighter band across the top reads as a highlight and costs two
    // rectangles instead of a gradient shader.
    this.body.roundRect(-half, -half, size, size * 0.42, radius).fill({ color: palette.light, alpha: 0.32 });
    this.body.roundRect(-half, -half, size, size, radius).stroke({ width: stroke, color: palette.dark });

    this.label.text = palette.label;
    this.label.visible = palette.label !== '';
    if (palette.label !== '') {
      this.label.style.fill = palette.dark;
      // The label is sized from the cell so it stays proportional.
      this.label.style.fontSize = Math.round(size * 0.34);
    }
  }

  /** Tier currently drawn, so a resize can redraw without being told. */
  private tier: Tier = 0;

  /** Pressed: lift and grow. Must be immediate, it is the game's acknowledgement. */
  press(tweens: Tweens): void {
    tweens.add({
      durationMs: 120,
      easing: Easing.outQuad,
      onUpdate: (t) => this.root.scale.set(1 + 0.12 * t),
    });
    this.root.zIndex = 10;
  }

  /** Follows the pointer while held. */
  follow(x: number, y: number): void {
    this.root.x = x;
    this.root.y = y;
    this.root.zIndex = 10;
  }

  /** Released without a merge: drop back onto the cell. */
  release(tweens: Tweens, x: number, y: number): void {
    this.root.zIndex = 0;
    this.glideTo(tweens, x, y, 180);
    tweens.add({
      durationMs: 180,
      easing: Easing.outQuad,
      onUpdate: (t) => this.root.scale.set(1.12 - 0.12 * t),
    });
  }

  /** Blocks appear with a staggered scale-up as a level loads. */
  popIn(tweens: Tweens, delayMs: number): void {
    this.root.scale.set(0.25);
    this.root.alpha = 0;

    tweens.add({
      durationMs: 280,
      delayMs,
      easing: Easing.outBack,
      onUpdate: (t) => {
        this.root.scale.set(0.25 + 0.75 * t);
        this.root.alpha = Math.min(1, t * 1.8);
      },
    });
  }

  /** The merge itself: overshoot then settle. */
  popMerge(tweens: Tweens): void {
    tweens.add({
      durationMs: 320,
      easing: Easing.outBack,
      onUpdate: (t) => this.root.scale.set(0.35 + 0.65 * t),
      onComplete: () => this.root.scale.set(1),
    });
  }

  glideTo(tweens: Tweens, x: number, y: number, durationMs = 150): void {
    const fromX = this.root.x;
    const fromY = this.root.y;

    tweens.add({
      durationMs,
      easing: Easing.outQuad,
      onUpdate: (t) => {
        this.root.x = fromX + (x - fromX) * t;
        this.root.y = fromY + (y - fromY) * t;
      },
    });
  }

  snapTo(x: number, y: number): void {
    this.root.x = x;
    this.root.y = y;
  }

  /** Squash reaction for blocks next to a merge. */
  bump(tweens: Tweens): void {
    tweens.add({
      durationMs: 240,
      easing: Easing.linear,
      onUpdate: (t) => {
        const wobble = Math.sin(t * Math.PI) * 0.14;
        this.root.scale.set(1 - wobble);
      },
      onComplete: () => this.root.scale.set(1),
    });
  }

  celebrate(tweens: Tweens, delayMs: number): void {
    const homeY = this.root.y;

    tweens.add({
      durationMs: 540,
      delayMs,
      easing: Easing.linear,
      onUpdate: (t) => {
        this.root.scale.set(1 + Math.sin(t * Math.PI * 2) * 0.13);
        this.root.y = homeY - Math.sin(t * Math.PI) * 30;
      },
      onComplete: () => {
        this.root.scale.set(1);
        this.root.y = homeY;
      },
    });
  }

  /** Marks this block as the current target or tutorial pick. */
  setHint(): void {
    this.hintAlpha = 1;
    this.body.alpha = 1;
  }

  clearHint(): void {
    this.hintAlpha = 0;
    this.body.alpha = 1;
  }

  get isHinted(): boolean {
    return this.hintAlpha > 0;
  }

  reset(): void {
    this.hintAlpha = 0;
    this.root.zIndex = 0;
    this.root.visible = false;
    this.root.alpha = 1;
    this.root.scale.set(1);
    this.label.text = '';
    this.label.visible = false;
    this.body.clear();
    this.body.alpha = 1;
  }
}
