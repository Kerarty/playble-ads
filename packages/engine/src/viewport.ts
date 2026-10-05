/**
 * Viewport handling.
 *
 * A playable is delivered into an iframe of any shape: a 320x480 slot on a
 * budget Android, a near-square in-feed unit, a full-screen interstitial. The
 * design box is fixed at 720x1280 portrait and has to sit correctly in all of
 * them.
 *
 * The important rule here: the canvas fills the whole slot, and the design box
 * is fitted *inside* it. The two are different things, and conflating them is
 * what squashes a portrait ad into a landscape slot. Anything the network draws
 * in the letterbox area still shows the game's own background, so there is never
 * a bare strip of page colour at the edge.
 */

export interface DesignSize {
  width: number;
  height: number;
}

/** Portrait: the orientation 2.1x more players finish in. */
export const DEFAULT_DESIGN: DesignSize = { width: 720, height: 1280 };

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
  readonly design: DesignSize;

  private cssWidth = DEFAULT_DESIGN.width;
  private cssHeight = DEFAULT_DESIGN.height;
  private devicePixelRatio = 1;
  private fit: FitRect = { x: 0, y: 0, width: DEFAULT_DESIGN.width, height: DEFAULT_DESIGN.height, scale: 1 };

  constructor(design: DesignSize = DEFAULT_DESIGN) {
    this.design = design;
  }

  /**
   * Recomputes from the current element size. Returns true when it changed.
   *
   * Uses `min` of the two ratios, so the whole design box is always visible.
   * `cover` would crop a portrait ad into a landscape slot, hiding the CTA area
   * that the network's own chrome sits over.
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

    const scale = Math.min(width / this.design.width, height / this.design.height);
    this.fit = {
      x: (width - this.design.width * scale) / 2,
      y: (height - this.design.height * scale) / 2,
      width: this.design.width * scale,
      height: this.design.height * scale,
      scale,
    };

    return true;
  }

  /** CSS size of the slot. */
  get slot(): { width: number; height: number } {
    return { width: this.cssWidth, height: this.cssHeight };
  }

  get dpr(): number {
    return this.devicePixelRatio;
  }

  /** Where the design box sits inside the slot. */
  get fitted(): FitRect {
    return { ...this.fit };
  }

  /**
   * Backbuffer size: the whole slot, at device resolution, scaled by the
   * adaptive quality controller.
   *
   * Sized to the slot rather than to the design box on purpose. The canvas is the
   * background, so it should cover the full ad area at full quality even if the
   * design box only occupies the middle of it.
   */
  backbufferSize(resolutionScale = 1): { width: number; height: number } {
    return {
      width: Math.max(1, Math.round(this.cssWidth * this.devicePixelRatio * resolutionScale)),
      height: Math.max(1, Math.round(this.cssHeight * this.devicePixelRatio * resolutionScale)),
    };
  }

  /**
   * Maps a client-space point into design space.
   *
   * `rect` is the slot's client rect, which differs from the design box's
   * position by `fit.x` / `fit.y`.
   */
  toDesign(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    const scale = this.fit.scale || 1;
    return {
      x: (clientX - rect.left - this.fit.x) / scale,
      y: (clientY - rect.top - this.fit.y) / scale,
    };
  }

  /**
   * Converts a network's bottom inset from CSS pixels into design pixels, for
   * positioning the CTA in design space.
   */
  insetToDesign(insetCssPx: number): number {
    const scale = this.fit.scale || 1;
    return Math.max(0, insetCssPx / scale);
  }
}
