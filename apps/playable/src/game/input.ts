/**
 * Input.
 *
 * The whole game is one gesture - drag a block onto its twin - so input is
 * deliberately dumb: press, move, release. No gestures, no multi-touch, no
 * physics.
 *
 * The one piece of real logic here is magnetism. A merge game where you have to
 * land a block within a few pixels of its partner is miserable on a phone, and
 * a playable loses the player in two seconds. So a released block snaps to the
 * nearest valid target within a radius well beyond the cell size, and a tap with
 * no drag is treated as "merge with the highlighted partner".
 *
 * Feedback budget: a press has to produce a visible response within 200ms or
 * it reads as broken, so the block scales up on press and shows a target ring
 * immediately - before the player has decided where to drop.
 */
import { Easing, type Tweens } from '@playble/engine';
import type { Scene } from './scenes.js';
import { COLS, ROWS } from './board.js';

/** Design-space geometry, mirrored from the scene. */
const BOARD_TOP = 300;
const BOARD_LEFT = 60;
const CELL = 140;

/**
 * Snap radius in design pixels.
 *
 * Larger than one cell on purpose: forgiving drops are the difference between a
 * playable that reads as responsive and one that feels broken.
 */
const SNAP_RADIUS = CELL * 1.15;

export interface InputCallbacks {
  /** A merge happened. */
  onMerge(tier: number, moves: number): void;
  /** Any real interaction, for the SDK's engagement metric. */
  onFirstInteraction(action: string): void;
  /** The player dropped a block somewhere with no valid target. */
  onInvalidDrop(): void;
}

export interface DragTarget {
  id: number;
  col: number;
  row: number;
  /** Blocks that can legally merge with this one. */
  mergeable: number[];
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
  private readonly unsubscribe: (() => void)[];
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
  ) {
    this.unsubscribe = [];
  }

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

    this.unsubscribe.push(
      () => canvas.removeEventListener('pointerdown', this.onPointerDown!),
      () => window.removeEventListener('pointermove', this.onPointerMove!),
      () => window.removeEventListener('pointerup', this.onPointerUp!),
      () => window.removeEventListener('pointercancel', this.onPointerUp!),
    );
  }

  detach(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
  }

  get state(): DragState {
    return {
      activeId: this.activeId,
      x: this.pointerX,
      y: this.pointerY,
      willLand: this.activeId === null ? null : this.nearestTarget(this.activeId, this.pointerX, this.pointerY)?.[1] ?? null,
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

    // Press feedback, immediately: scale up and lift slightly. This is the
    // sub-200ms response the creative needs to read as responsive.
    const view = this.scene.view(block.id);
    view?.press(this.tweens);
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

    // A tap, or a tiny drag, with a highlighted partner: merge with it.
    // One gesture, both input styles - that is what "one action" has to mean.
    if (dragged < 12) {
      const partner = this.scene.hintPartnerFor(sourceId);
      if (partner) {
        this.commit(sourceId, partner.col, partner.row);
        return;
      }
    }

    if (!target) {
      const cell = this.cellOf(sourceId);
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
    const tier = this.scene.tierAt(col, row);
    this.callbacks.onMerge(tier ?? 0, this.moves);
  }

  /** The block under a design-space point. */
  blockAt(x: number, y: number): { id: number; col: number; row: number } | null {
    const col = Math.floor((x - BOARD_LEFT) / CELL);
    const row = Math.floor((y - BOARD_TOP) / CELL);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;

    const block = this.scene.board.get(col, row);
    if (!block) return null;
    return { id: block.id, col, row };
  }

  /**
   * Finds the best landing spot: an empty cell, or a mergeable neighbour.
   * Prefers mergeable, because that is the move the player almost always means.
   */
  nearestTarget(
    sourceId: number,
    x: number,
    y: number,
  ): [{ id: number; col: number; row: number }, [number, number]] | null {
    const source = this.scene.boardOf(sourceId);
    if (!source) return null;

    let best: [{ id: number; col: number; row: number }, [number, number], number] | null = null;

    for (const [col, row] of this.scene.board.neighbours(source)) {
      const target = this.scene.board.get(col, row);
      if (!target) continue;

      const canMerge = source.tier === target.tier && source.tier < 5;
      // A merge is always worth more than a plain move, so bias its distance.
      const bias = canMerge ? 0.55 : 1;
      const center = this.scene.cellCenter(col, row);
      const distance = Math.hypot(center.x - x, center.y - y) * bias;

      if (distance > SNAP_RADIUS) continue;
      if (!best || distance < best[2]) {
        best = [{ id: target.id, col, row }, [col, row], distance];
      }
    }

    if (!best) return null;
    return [best[0], best[1]];
  }

  private cellOf(blockId: number): [number, number] | null {
    return this.scene.cellOf(blockId);
  }
}

/** Easing re-export so the game does not import the engine twice. */
export { Easing };
