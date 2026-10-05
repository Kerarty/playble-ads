/**
 * Tier colours.
 *
 * One source of truth for every visual that has to match a block: the block
 * itself, the particles it emits, the progress bar and the end card. A palette
 * duplicated in three places is a palette that drifts.
 *
 * The ramp goes cool to warm so a player can read "this is bigger" without
 * reading a number, and it stays distinguishable for the most common forms of
 * colour blindness: lightness changes monotonically, and hue steps are wide
 * enough that no two adjacent tiers differ by hue alone.
 */

export interface TierPalette {
  /** Block fill. */
  fill: number;
  /** Lighter top edge, for the bevel. */
  light: number;
  /** Darker bottom edge and outline. */
  dark: number;
  /** Particles and merge flash. */
  accent: number;
  /** Star/shine colour on the block face. */
  shine: number;
  /** Short label shown on tiers 3+. */
  label: string;
}

export const TIER_PALETTE: readonly TierPalette[] = [
  { fill: 0x4ec3f7, light: 0xb3e5fc, dark: 0x1e88e5, accent: 0x81d4fa, shine: 0xe1f5fe, label: '' },
  { fill: 0x66bb6a, light: 0xb9f6ca, dark: 0x2e7d32, accent: 0x81c784, shine: 0xe8f5e9, label: '' },
  { fill: 0xffca28, light: 0xffecb3, dark: 0xf9a825, accent: 0xffd54f, shine: 0xfff8e1, label: '' },
  { fill: 0xff7043, light: 0xffccbc, dark: 0xf4511e, accent: 0xff8a65, shine: 0xffede7, label: '' },
  { fill: 0xba68c8, light: 0xe1bee7, dark: 0x8e24aa, accent: 0xce93d8, shine: 0xf3e5f5, label: 'IV' },
  { fill: 0x26c6da, light: 0xb2ebf2, dark: 0x00838f, accent: 0x4dd0e1, shine: 0xe0f7fa, label: 'V' },
];

export function paletteFor(tier: number): TierPalette {
  return TIER_PALETTE[Math.max(0, Math.min(TIER_PALETTE.length - 1, tier))] ?? TIER_PALETTE[0]!;
}

/** CSS colour string, for DOM UI (the CTA button lives outside the canvas). */
export function cssColor(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
