/**
 * Runs a beat script against real time and real game events.
 *
 * Split from `script.ts` (which is only data) so the scheduling logic can be
 * tested without Pixi, a DOM, or a running game.
 */
import type { Beat, BeatAction } from './script.js';

export type Gate = 'first-interaction' | 'win' | 'cta';

export interface DirectorHooks {
  runAction(action: BeatAction): void;
}

export interface DirectorOptions {
  beats: readonly Beat[];
  hooks: DirectorHooks;
  /** Injected for tests. */
  now?: () => number;
}

export class Director {
  private readonly now: () => number;
  private startedAt = 0;
  private running = false;
  private fired = new Set<string>();
  /** Gates that have been satisfied. */
  private readonly satisfied = new Set<Gate>();

  constructor(private readonly options: DirectorOptions) {
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = this.now();
    this.fired.clear();
    this.satisfied.clear();
  }

  get elapsedSeconds(): number {
    return this.running ? (this.now() - this.startedAt) / 1000 : 0;
  }

  /** Signals that the player did something. Releases gated beats. */
  notify(gate: Gate): void {
    if (this.satisfied.has(gate)) return;
    this.satisfied.add(gate);
  }

  hasFired(id: string): boolean {
    return this.fired.has(id);
  }

  /**
   * Fires every beat that is due. Call once per frame.
   *
   * Beats are checked in script order rather than by a sort, so a script with
   * two beats at the same timestamp always runs them in author order.
   */
  update(): void {
    if (!this.running) return;
    const t = this.elapsedSeconds;

    for (const beat of this.options.beats) {
      if (this.fired.has(beat.id)) continue;
      if (beat.at > t) continue;
      if (beat.gate && !this.satisfied.has(beat.gate)) continue;

      this.fired.add(beat.id);
      this.options.hooks.runAction(beat.action);
    }
  }

  /** True once every beat in the script has fired. */
  get finished(): boolean {
    return this.options.beats.every((b) => this.fired.has(b.id));
  }

  get firedCount(): number {
    return this.fired.size;
  }

  /** Beats that are due by time but still waiting on their gate. */
  pendingGated(): string[] {
    return this.options.beats
      .filter((b) => !this.fired.has(b.id) && b.gate && !this.satisfied.has(b.gate))
      .map((b) => b.id);
  }

  stop(): void {
    this.running = false;
  }
}
