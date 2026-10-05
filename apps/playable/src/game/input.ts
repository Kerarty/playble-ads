/**
 * Input.
 *
 * The whole game is one gesture - drag a block onto its twin - so input is
 * deliberately dumb: press, move, release. No gestures, no multi-touch, no
 * physics.
 *
 * Two things here are less obvious than they look:
 *
 * 1. Grid resolution goes through `boardLayout`, the same module the renderer
 *    draws from. When these two disagreed the game looked perfect and simply
 *    ignored taps, because the cell the player touched was not the cell the
 *    blocks were drawn in.
 *
 * 2. A released block snaps to the nearest valid target within a radius well
 *    beyond the cell, and a tap with no drag merges with the hinted partner. A
 *    merge game that demands pixel accuracy is miserable on a phone, and a
 *    playable loses the player in two seconds.
 */
import { Easing, type Tweens } from '@playble/engine';
import type { Scene } from './scenes.js';
import { cellAt, cellCenter, type Layout } from './boardLayout.js';
import { COLS, ROWS } from './board.js';

/**
 * How far from a cell centre a drop still counts as landing on it, in design
 * pixels. Larger than a cell on purpose: forgiving drops are the difference
 * between a playable that reads as responsive and one that feels broken.
 */
function snapRadius(layout: Layout): number {
  return layout.cell * 1.15;
}

export interface InputCallbacks {
  /** A merge happened. */
  onMerge(tier: number, moves: number): void;
  /** Any real interaction, for the SDK's engagement metric. */
  onFirstInteraction(action: string): void;
  /** The player dropped a block somewhere with no valid target. */
  onInvalidDrop(): void;
}

export interface DragState {
  /** Block currently held, if any. */
  activeId: number | null;
  /** Current pointer position in design space. */
  x: number;
  y: number;
  /** Where the block would land if released now. */
  willLand: [number, number] | null;
}

export class InputController {
  private readonly unsubscribes: Array<() => void> = [];
  private activeId: number | null = null;
  private pressX = 0;
  private pressY = 0;
  private pointerX = 0;
  private pointerY = 0;
  private interacted = false;
  private moves = 0;
  private onPointerDown: ((ev: PointerEvent) => void) | undefined;
  private onPointerMove: ((ev: PointerEvent) => void) | undefined;
  private onPointerUp: ((ev: PointerEvent) => void) | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    private readonly tweens: Tweens,
    private readonly toDesign: (clientX: number, clientY: number) => { x: number; y: number },
    private readonly callbacks: InputCallbacks,
  ) {}

  /** Attaches listeners. Pointer events only: one input model for all devices. */
  attach(): void {
    const canvas = this.canvas;

    this.onPointerDown = (ev) => {
      ev.preventDefault();
      this.pointerDown(ev);
    };
    this.onPointerMove = (ev) => {
      if (this.activeId === null) return;
      ev.preventDefault();
      this.pointerMove(ev);
    };
    this.onPointerUp = (ev) => {
      if (this.activeId === null) return;
      ev.preventDefault();
      this.pointerUp(ev);
    };

    canvas.addEventListener('pointerdown', this.onPointerDown);
    // Move and up on the window so a drag that leaves the canvas still tracks,
    // which matters when a finger slides off a small iframe.
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);

    this.unsubscribes.push(
      () => canvas.removeEventListener('pointerdown', this.onPointerDown!),
      () => window.removeEventListener('pointermove', this.onPointerMove!),
      () => window.removeEventListener('pointerup', this.onPointerUp!),
      () => window.removeEventListener('pointercancel', this.onPointerUp!),
    );
  }

  detach(): void {
    for (const off of this.unsubscribes) off();
    this.unsubscribes.length = 0;
  }

  get state(): DragState {
    return {
      activeId: this.activeId,
      x: this.pointerX,
      y: this.pointerY,
      willLand:
        this.activeId === null ? null : (this.nearestTarget(this.activeId, this.pointerX, this.pointerY)?.[1] ?? null),
    };
  }

  get moveCount(): number {
    return this.moves;
  }

  private pointerDown(ev: PointerEvent): void {
    const { x, y } = this.toDesign(ev.clientX, ev.clientY);
    this.pointerX = x;
    this.pointerY = y;
    this.pressX = x;
    this.pressY = y;

    const block = this.blockAt(x, y);
    if (!block) return;

    if (!this.interacted) {
      this.interacted = true;
      this.callbacks.onFirstInteraction('drag');
    }

    this.activeId = block.id;

    // Press feedback, immediately: the sub-200ms response the creative needs in
    // order to read as responsive.
    this.scene.view(block.id)?.press(this.tweens);
  }

  private pointerMove(ev: PointerEvent): void {
    if (this.activeId === null) return;
    const { x, y } = this.toDesign(ev.clientX, ev.clientY);
    this.pointerX = x;
    this.pointerY = y;

    const view = this.scene.view(this.activeId);
    if (view) view.follow(x, y);

    // Show where it will land, as soon as there is somewhere to land.
    const target = this.nearestTarget(this.activeId, x, y);
    this.scene.clearHint();
    if (target) this.scene.highlight(target[0].id);
  }

  private pointerUp(ev: PointerEvent): void {
    const sourceId = this.activeId;
    this.activeId = null;
    if (sourceId === null) return;

    const { x, y } = this.toDesign(ev.clientX, ev.clientY);
    const dragged = Math.hypot(x - this.pressX, y - this.pressY);

    const target = this.nearestTarget(sourceId, x, y);

    // A tap, or a tiny drag, with a highlighted partner: merge with it. One
    // gesture, both input styles - that is what "one action" has to mean.
    // The threshold scales with the cell so it is the same physical distance
    // whatever the slot size.
    if (dragged < this.scene.currentLayout.cell * 0.12) {
      const partner = this.scene.hintPartnerFor(sourceId);
      if (partner) {
        this.commit(sourceId, partner.col, partner.row);
        return;
      }
    }

    if (!target) {
      const cell = this.scene.cellOf(sourceId);
      if (cell) {
        const center = this.scene.cellCenter(cell[0], cell[1]);
        this.scene.view(sourceId)?.release(this.tweens, center.x, center.y);
      }
      this.callbacks.onInvalidDrop();
      return;
    }

    this.commit(sourceId, target[1][0], target[1][1]);
  }

  private commit(sourceId: number, col: number, row: number): void {
    const merged = this.scene.drop(sourceId, col, row);
    this.scene.clearHint();

    if (!merged) {
      this.callbacks.onInvalidDrop();
      return;
    }

    this.moves += 1;
    this.callbacks.onMerge(this.scene.tierAt(col, row) ?? 0, this.moves);
  }

  /** The block under a design-space point. */
  blockAt(x: number, y: number): { id: number; col: number; row: number } | null {
    const cell = cellAt(this.scene.currentLayout, x, y);
    if (!cell) return null;

    const block = this.scene.board.get(cell.col, cell.row);
    if (!block) return null;
    return { id: block.id, col: cell.col, row: cell.row };
  }

  /**
   * Finds the best landing spot: a mergeable neighbour, or any neighbour.
   * Prefers mergeable, because that is the move the player almost always means.
   */
  nearestTarget(
    sourceId: number,
    x: number,
    y: number,
  ): [{ id: number; col: number; row: number }, [number, number]] | null {
    const source = this.scene.boardOf(sourceId);
    if (!source) return null;

    const layout = this.scene.currentLayout;
    const limit = snapRadius(layout);

    let best: [{ id: number; col: number; row: number }, [number, number], number] | null = null;

    for (const [col, row] of this.scene.board.neighbours(source)) {
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) continue;

      const target = this.scene.board.get(col, row);
      if (!target) continue;

      const canMerge = this.scene.board.canMerge(source, target);
      // A merge is always worth more than a plain move, so bias its distance.
      const bias = canMerge ? 0.55 : 1;
      const center = cellCenter(layout, col, row);
      const distance = Math.hypot(center.x - x, center.y - y) * bias;

      if (distance > limit) continue;
      if (!best || distance < best[2]) {
        best = [{ id: target.id, col, row }, [col, row], distance];
      }
    }

    if (!best) return null;
    return [best[0], best[1]];
  }
}

/** Re-exported so the game does not import the engine twice. */
export { Easing };
