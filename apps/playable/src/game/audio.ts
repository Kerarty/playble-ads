/**
 * Audio.
 *
 * Two rules from mobile autoplay policy drive the whole design:
 *
 * 1. Nothing may make sound before a user gesture. We do not even create the
 *    `AudioContext` until the first touch, because merely constructing one
 *    starts it in a suspended state and some in-app WebViews log that as a
 *    policy violation.
 *
 * 2. A playable is 15 seconds long. Sound is a garnish, not a feature: one loop
 *    plus four short effects, all mono at a speech-grade bitrate, because a
 *    phone speaker cannot tell the difference and the bytes go to art instead.
 *
 * The merge pitch ladder is the important one: each successive merge of the
 * round plays a step higher, so the audio tracks progress the same way the
 * visuals do, and the last merge before the CTA sounds like a win.
 */

/** One step of the merge ladder, in Hz. */
const PITCH_LADDER = [392, 440, 494, 523, 587, 659, 698, 784];

export type SfxName = 'merge' | 'invalid' | 'win' | 'cta';

export interface AudioOptions {
  /** `gesture` starts muted; `on` starts unmuted for sound-on placements. */
  mode: 'on' | 'gesture';
  volume: number;
}

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private unlocked = false;
  private ladderStep = 0;
  private muted = true;

  constructor(private readonly options: AudioOptions) {
    this.muted = options.mode !== 'on';
  }

  /**
   * Called on the first user gesture.
   *
   * Builds the context lazily and resumes it. Safe to call repeatedly.
   */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;

    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined' ? AudioContext : undefined;
    if (!Ctor) return;

    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.options.volume;
      this.master.connect(this.ctx.destination);

      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1;
      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);

      void this.ctx.resume();
    } catch {
      // A playable with no audio still works; sound is optional by design.
      this.ctx = null;
    }
  }

  /** Unmutes and resumes. Used by the gesture unlock and the sound-on networks. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.master || !this.ctx) return;

    const now = this.ctx.currentTime;
    // Ramp rather than jump: a sudden unmute in the middle of gameplay is a
    // click, and a click reads as a glitch.
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(muted ? 0 : this.options.volume, now, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Resets the pitch ladder, called when a level loads. */
  resetProgress(): void {
    this.ladderStep = 0;
  }

  /**
   * Plays a merge. Each call climbs the ladder, so a good round ends on a high
   * note.
   */
  playMerge(): void {
    const step = Math.min(this.ladderStep, PITCH_LADDER.length - 1);
    this.ladderStep += 1;
    this.beep(PITCH_LADDER[step] ?? 440, 0.14, 'triangle', 0.32);
    // A soft octave-up doubles on top: cheap, and it makes a merge feel bigger.
    this.beep((PITCH_LADDER[step] ?? 440) * 2, 0.08, 'sine', 0.14);
  }

  playInvalid(): void {
    this.beep(180, 0.1, 'sawtooth', 0.14);
  }

  playWin(): void {
    // A short arpeggio, not a chord: a chord would need three oscillators and
    // reads as a jingle, an arpeggio reads as a reward.
    const notes = [523, 659, 784, 1047];
    notes.forEach((hz, i) => {
      window.setTimeout(() => this.beep(hz, 0.18, 'triangle', 0.3), i * 70);
    });
  }

  playCta(): void {
    this.beep(880, 0.1, 'sine', 0.24);
    this.beep(1175, 0.14, 'sine', 0.2);
  }

  /** One oscillator with an envelope, disposed when it finishes. */
  private beep(freq: number, durationS: number, type: OscillatorType, gainValue: number): void {
    const ctx = this.ctx;
    const sfx = this.sfxGain;
    if (!ctx || !sfx || ctx.state !== 'running' || this.muted) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      // Fast attack, exponential decay: a plucked envelope, not a fade.
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(gainValue, ctx.currentTime + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationS);

      osc.connect(gain);
      gain.connect(sfx);

      osc.start();
      osc.stop(ctx.currentTime + durationS + 0.02);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    } catch {
      // Never let audio take the frame down.
    }
  }

  destroy(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
  }
}
