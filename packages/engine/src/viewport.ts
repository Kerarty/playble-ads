/**
 * Viewport handling.
 *
 * A playable is delivered into an iframe of any shape: a 320x480 slot on a budget
 * Android, a near-square in-feed unit, a full-screen interstitial.
 *
 * The important rule here: the design box matches the slot's aspect ratio rather
 * than being a fixed portrait letterboxed into it. A fixed 9:16 box fitted with
 * `min()` shrinks to a narrow strip with dead bands down both sides in a
 * landscape slot, which reads as the game floating in an empty frame. Letting the
 * design width follow the slot means there is no letterbox at all, and the
 * layout places things responsively instead.
 */

export interface DesignSize {
  width: number;
  height: number;
}

/**
 * Portrait reference height. Portrait because that is the orientation 2.1x more
 * players finish in.
 */
export const DEFAULT_DESIGN: DesignSize = { width: 720, height: 1280 };

/**
 * Bounds on the adaptive design width.
 *
 * Below the minimum the board is too narrow to hit accurately with a thumb; above
 * the maximum the block sits in a very wide frame and looks like it is floating.
 * Past either bound a letterbox is the lesser evil, so the scale is corrected to
 * match the clamped width.
 */
export const MIN_DESIGN_WIDTH = 560;
export const MAX_DESIGN_WIDTH = 1100;

/** Where the design box ended up inside the slot, in CSS pixels. */
export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Uniform CSS pixels per design pixel. */
  scale: number;
}

export class Viewport {
  /**
   * Design box. Its height is fixed and its width follows the slot's aspect
   * ratio, so the design box always matches the slot exactly.
   *
   * The alternative - a fixed 9:16 box fitted with `min()` - is what made an
   * early version look broken: in a landscape slot the portrait box shrank to a
   * narrow strip with dead bands down both sides, and the game appeared to float
   * in the middle of an empty frame. Letting the design width follow the slot
   * means there is never a letterbox, and the layout has to place things
   * responsively instead.
   */
  readonly design: DesignSize;

  private cssWidth = 0;
  private cssHeight = 0;
  private devicePixelRatio = 1;
  private scale = 1;

  constructor(design: DesignSize = DEFAULT_DESIGN) {
    this.design = { ...design };
  }

  /**
   * Recomputes from the current element size. Returns true when it changed.
   *
   * The design height is the fixed reference; the width is derived from the
   * slot's aspect. Clamped at both ends: below the minimum the board would be
   * unreadably narrow, above the maximum it would float in a very wide frame,
   * and past those points a letterbox is the lesser evil.
   */
  measure(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || element.clientWidth));
    const height = Math.max(1, Math.round(rect.height || element.clientHeight));
    const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;

    if (width === this.cssWidth && height === this.cssHeight && dpr === this.devicePixelRatio) {
      return false;
    }

    this.cssWidth = width;
    this.cssHeight = height;
    this.devicePixelRatio = dpr;

    // Fill the slot vertically, then derive the width that keeps the aspect.
    this.scale = height / this.design.height;

    const wantedWidth = width / this.scale;
    const clampedWidth = Math.max(MIN_DESIGN_WIDTH, Math.min(MAX_DESIGN_WIDTH, wantedWidth));
    this.design.width = Math.round(clampedWidth);
    // Any correction to the width has to go back into the scale, or the design
    // box and the slot disagree again.
    this.scale = height / this.design.height;

    return true;
  }

  /** CSS size of the slot. */
  get slot(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  get dpr(): number {
    return this.devicePixelRatio;
  }

  /** Design pixels per CSS pixel. */
  get fitScale(): number {
    return this.scale;
  }

  /** Where the design box sits inside the slot. Zero in the common case. */
  get fitted(): FitRect {
    return {
      x: Math.round((this.cssWidth - this.design.width * this.scale) / 2),
      y: 0,
      width: this.design.width * this.scale,
      height: this.cssHeight,
      scale: this.scale,
    };
  }

  /**
   * Backbuffer size: the whole slot, at device resolution, scaled by the
   * adaptive quality controller.
   *
   * Sized to the slot rather than to the design box because the canvas is the
   * background and should cover the full ad area at full quality.
   */
  backbufferSize(resolutionScale = 1): { width: number; height: number } {
    return {
      width: Math.max(1, Math.round(this.cssWidth * this.devicePixelRatio * resolutionScale)),
      height: Math.max(1, Math.round(this.cssHeight * this.devicePixelRatio * resolutionScale)),
    };
  }

  /** Maps a client-space point into design space. */
  toDesign(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    const fit = this.fitted;
    return {
      x: (clientX - rect.left - fit.x) / fit.scale,
      y: (clientY - rect.top - fit.y) / fit.scale,
    };
  }

  /** Converts a network's bottom inset from CSS pixels into design pixels. */
  insetToDesign(insetCssPx: number): number {
    return Math.max(0, insetCssPx / (this.scale || 1));
  }
}
