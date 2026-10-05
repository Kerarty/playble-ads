/**
 * Viewport handling.
 *
 * A playable is delivered into an iframe that may be any shape: a 320x480 slot
 * on a budget Android, a near-square in-feed unit, a full-screen interstitial.
 * The design resolution is fixed and everything else is fitted into it, so the
 * game looks identical everywhere and only the letterboxing changes.
 */

export interface DesignSize {
  width: number;
  height: number;
}

/** Portrait, the orientation 2.1x more players finish in. */
export const DEFAULT_DESIGN: DesignSize = { width: 720, height: 1280 };

export interface ViewportState {
  /** CSS pixels of the canvas. */
  width: number;
  height: number;
  /** Uniform scale that fits `design` into the viewport. */
  scale: number;
  /** Offset that centres the design area. */
  offsetX: number;
  offsetY: number;
  devicePixelRatio: number;
}

export class Viewport {
  readonly design: DesignSize;
  private width = DEFAULT_DESIGN.width;
  private height = DEFAULT_DESIGN.height;
  /** Read through `state` by helpers outside the class. */
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  private devicePixelRatio = 1;

  constructor(design: DesignSize = DEFAULT_DESIGN) {
    this.design = design;
  }

  /** Recomputes from the current element size. Returns true when it changed. */
  measure(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || element.clientWidth));
    const height = Math.max(1, Math.round(rect.height || element.clientHeight));
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

    if (width === this.width && height === this.height && dpr === this.devicePixelRatio) {
      return false;
    }

    this.width = width;
    this.height = height;
    this.devicePixelRatio = dpr;

    // Cover rather than contain: a small gap at the edge of a playable shows
    // the network's background through, which looks broken. The design box
    // overflows slightly instead, and nothing important lives there.
    this.scale = Math.max(width / this.design.width, height / this.design.height);
    this.offsetX = (width - this.design.width * this.scale) / 2;
    this.offsetY = (height - this.design.height * this.scale) / 2;

    return true;
  }

  /** Backbuffer size, taking the quality scale into account. */
  backbufferSize(resolutionScale = 1): { width: number; height: number } {
    const scale = this.scale * this.devicePixelRatio * resolutionScale;
    return {
      width: Math.max(1, Math.round(this.design.width * scale)),
      height: Math.max(1, Math.round(this.design.height * scale)),
    };
  }

  /** Maps a client-space point into design space. */
  toDesign(clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } {
    return {
      x: (clientX - rect.left - this.offsetX) / this.scale,
      y: (clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  get state(): ViewportState {
    return {
      width: this.width,
      height: this.height,
      scale: this.scale,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      devicePixelRatio: this.devicePixelRatio,
    };
  }
}

/**
 * Bottom inset the current network's own chrome covers, in design pixels.
 * The CTA is positioned above this so a network's UI never sits on top of it.
 */
export function ctaSafeBottom(insetPx: number, viewport: Viewport): number {
  const insetDesign = viewport.design.height - (insetPx - viewport.offsetY) / viewport.scale;
  return Math.max(0, Math.min(viewport.design.height * 0.35, insetDesign));
}
