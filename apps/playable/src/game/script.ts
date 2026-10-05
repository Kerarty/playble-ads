/**
 * The playable's timeline, as data.
 *
 * The beat sheet of a playable *is* the design: a hook in the first seconds, a
 * short loop, a win state, then the install CTA around 10-15s. Writing it as
 * data rather than as chained `setTimeout` calls buys three things:
 *
 *  - the simulator can display it, and Playwright can assert against it;
 *  - an A/B variant is a different entry in a list, not a forked code path;
 *  - the timings can be reviewed by a designer without reading game logic.
 */

export interface Beat {
  id: string;
  /** Start time in seconds from the first rendered frame. */
  at: number;
  /**
   * `playable` beats wait for the player's first gesture before advancing.
   * A playable cannot afford dead air, so anything that must feel responsive is
   * driven by input rather than by the clock.
   */
  gate?: 'first-interaction' | 'win' | 'cta';
  action: BeatAction;
}

export type BeatAction =
  | { type: 'show-copy'; text: string; sub?: string }
  | { type: 'hide-copy' }
  | { type: 'start-level'; index: number }
  | { type: 'hint-merge'; tier: number }
  | { type: 'celebrate' }
  | { type: 'show-cta' }
  | { type: 'show-funnel' };

/** Total runtime target. End cards at ~13.5s historically convert best. */
export const TIMELINE_LENGTH_S = 13.5;

/**
 * The shipped script.
 *
 * Notes on the specific numbers: the first block pair merges at ~2s (the first
 * real "yes this is fun" moment), the win lands at ~10.5s, and the CTA is up at
 * 11s - inside the 10-15s window that outperforms both longer and shorter ads.
 */
export const DEFAULT_SCRIPT: readonly Beat[] = [
  { id: 'copy-hook', at: 0, action: { type: 'show-copy', text: 'СОБЕРИ АЛМАЗ', sub: 'тащи блок на блок' } },

  // The board is live from frame one and the hint is a moving finger rather
  // than text, so the tutorial costs one gesture instead of a sentence.
  { id: 'start-level-1', at: 0, action: { type: 'start-level', index: 0 } },
  { id: 'hint-first', at: 0.8, action: { type: 'hint-merge', tier: 0 } },

  { id: 'copy-goal', at: 2.6, gate: 'first-interaction', action: { type: 'show-copy', text: 'ОТЛИЧНО!', sub: 'ещё раз' } },
  { id: 'level-2', at: 3.4, gate: 'first-interaction', action: { type: 'start-level', index: 1 } },
  { id: 'hint-second', at: 4.2, action: { type: 'hint-merge', tier: 0 } },

  { id: 'level-3', at: 6.4, action: { type: 'start-level', index: 2 } },
  { id: 'copy-again', at: 6.4, action: { type: 'show-copy', text: 'ПОСЛЕДНИЙ УРОВЕНЬ', sub: 'собери алмаз' } },

  { id: 'celebrate', at: 10.5, gate: 'win', action: { type: 'celebrate' } },
  { id: 'cta', at: 11, gate: 'win', action: { type: 'show-cta' } },
  { id: 'funnel', at: 12.6, action: { type: 'show-funnel' } },
];

/**
 * Hook variants.
 *
 * The single highest-leverage variable in a playable is the very first
 * interaction, so it is worth shipping two of them and being able to compare.
 * Variants differ only in the opening: the rest of the timeline is identical,
 * which keeps the comparison honest.
 */
export interface ScriptVariant {
  id: string;
  label: string;
  /** What we expect to happen, so the simulator can frame the result. */
  hypothesis: string;
  beats: readonly Beat[];
}

const variantA: readonly Beat[] = DEFAULT_SCRIPT;

const variantB: readonly Beat[] = [
  // Same length, but the hint arrives sooner and names the action.
  { id: 'copy-hook-b', at: 0, action: { type: 'show-copy', text: 'ОДНО КАСАНИЕ', sub: 'и алмаз твой' } },
  { id: 'start-level-1-b', at: 0, action: { type: 'start-level', index: 0 } },
  { id: 'hint-first-b', at: 0.45, action: { type: 'hint-merge', tier: 0 } },
  ...DEFAULT_SCRIPT.slice(3),
];

export const SCRIPT_VARIANTS: readonly ScriptVariant[] = [
  {
    id: 'a-instructional',
    label: 'A · «собери алмаз»',
    hypothesis: 'Прямое задание даёт высокую долю взаимодействий, но игрок читает текст.',
    beats: variantA,
  },
  {
    id: 'b-outcome',
    label: 'B · «одно касание»',
    hypothesis: 'Обещание результата быстрее вовлекает, но объясняет меньше.',
    beats: variantB,
  },
];

export function scriptById(id: string): ScriptVariant {
  return SCRIPT_VARIANTS.find((v) => v.id === id) ?? SCRIPT_VARIANTS[0]!;
}
