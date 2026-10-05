/**
 * Adaptive quality.
 *
 * Playable ads run on whatever phone the user happens to have, from a $80
 * Android on 3G to a current flagship. Rather than picking one quality and
 * hoping, we watch the real frame rate and step resolution down (or back up)
 * to hold the target.
 *
 * The rule is deliberately slow to react: a playable is 15 seconds long, and a
 * controller that chases every hitch would make the picture worse, not better.
 */
import type { PerfSample } from '@playble/core';

export interface QualitySettings {
  /** Multiplier on the base resolution. 1 = full, 0.5 = quarter pixels. */
  resolutionScale: number;
  /** Particles enabled at all. */
  particles: boolean;
  /** Cosmetic tween duration multiplier; 1 = normal. */
  effectsScale: number;
}

export const QUALITY_LEVELS: readonly QualitySettings[] = [
  { resolutionScale: 1.0, particles: true, effectsScale: 1.0 },
  { resolutionScale: 0.85, particles: true, effectsScale: 1.0 },
  { resolutionScale: 0.7, particles: true, effectsScale: 0.7 },
  { resolutionScale: 0.55, particles: false, effectsScale: 0.5 },
  { resolutionScale: 0.4, particles: false, effectsScale: 0.4 },
];

export interface AdaptiveQualityOptions {
  targetFps: number;
  enabled: boolean;
  /** Samples below this average fps trigger a downgrade. */
  lowFpsThreshold: number;
  /** Consecutive bad samples needed before acting. */
  downgradeAfter?: number;
  /** Consecutive good samples needed before upgrading back. */
  upgradeAfter?: number;
}

const DEFAULT_OPTIONS = { downgradeAfter: 3, upgradeAfter: 12 } as const;

export class AdaptiveQuality {
  private level = 0;
  private badSamples = 0;
  private goodSamples = 0;
  private readonly downgradeAfter: number;
  private readonly upgradeAfter: number;
  private worstFrameMs = 0;

  constructor(private options: AdaptiveQualityOptions) {
    this.downgradeAfter = options.downgradeAfter ?? DEFAULT_OPTIONS.downgradeAfter;
    this.upgradeAfter = options.upgradeAfter ?? DEFAULT_OPTIONS.upgradeAfter;
  }

  configure(options: AdaptiveQualityOptions): void {
    this.options = options;
    if (!options.enabled) this.reset();
  }

  get current(): QualitySettings {
    return QUALITY_LEVELS[this.level] ?? QUALITY_LEVELS[0]!;
  }

  get levelIndex(): number {
    return this.level;
  }

  /** The lowest level we are allowed to reach. */
  get minLevel(): number {
    return 0;
  }

  get maxLevel(): number {
    return QUALITY_LEVELS.length - 1;
  }

  reset(): void {
    this.level = 0;
    this.badSamples = 0;
    this.goodSamples = 0;
    this.worstFrameMs = 0;
  }

  /**
   * Feeds one measured sample in, returns the settings to use from now on.
   * `fps` is the rolling average; a single bad frame is smoothed out by the
   * consecutive-sample counters below.
   */
  update(fps: number, worstFrameMs = 0): QualitySettings {
    this.worstFrameMs = Math.max(this.worstFrameMs, worstFrameMs);

    if (!this.options.enabled) return this.current;

    if (fps < this.options.lowFpsThreshold) {
      this.badSamples += 1;
      this.goodSamples = 0;
      if (this.badSamples >= this.downgradeAfter && this.level < this.maxLevel) {
        this.level += 1;
        this.badSamples = 0;
      }
      return this.current;
    }

    if (fps > this.options.targetFps * 0.92) {
      this.goodSamples += 1;
      this.badSamples = 0;
      // Upgrading is much slower than downgrading: it is better to sit at a
      // slightly soft picture than to oscillate between two resolutions.
      if (this.goodSamples >= this.upgradeAfter && this.level > this.minLevel) {
        this.level -= 1;
        this.goodSamples = 0;
      }
      return this.current;
    }

    // In the dead band around the target: let the counters bleed off.
    this.badSamples = 0;
    this.goodSamples = 0;
    return this.current;
  }

  /** Builds the payload for the SDK's `perf` event. */
  sample(fps: number): PerfSample {
    return {
      fps: Math.round(fps),
      worstFrameMs: Math.round(this.worstFrameMs),
      resolutionScale: this.current.resolutionScale,
    };
  }
}
