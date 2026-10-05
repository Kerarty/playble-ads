import { describe, expect, it, vi } from 'vitest';
import { Director } from './director.js';
import { DEFAULT_SCRIPT, SCRIPT_VARIANTS, scriptById, TIMELINE_LENGTH_S, type Beat, type BeatAction } from './script.js';

function harness(beats: readonly Beat[] = DEFAULT_SCRIPT) {
  const fired: BeatAction[] = [];
  let time = 0;
  const director = new Director({
    beats,
    hooks: { runAction: (a) => fired.push(a) },
    now: () => time,
  });

  return {
    director,
    fired,
    /** Advance the fake clock by `seconds` and run one update. */
    step(seconds: number) {
      time += seconds * 1000;
      director.update();
    },
    types: () => fired.map((a) => a.type),
  };
}

describe('Director scheduling', () => {
  it('fires nothing before start()', () => {
    const h = harness();
    h.step(10);
    expect(h.fired).toHaveLength(0);
  });

  it('fires beats at time zero on the first update', () => {
    const h = harness();
    h.director.start();
    h.step(0);
    expect(h.types()).toContain('show-copy');
  });

  it('fires a beat once its time arrives', () => {
    const h = harness([{ id: 'late', at: 5, action: { type: 'hide-copy' } }]);
    h.director.start();

    h.step(4.9);
    expect(h.fired).toHaveLength(0);

    h.step(0.2);
    expect(h.types()).toEqual(['hide-copy']);
  });

  it('never fires the same beat twice', () => {
    const h = harness([{ id: 'once', at: 0, action: { type: 'hide-copy' } }]);
    h.director.start();

    h.step(0);
    h.step(0.1);
    h.step(0.1);

    expect(h.fired).toHaveLength(1);
  });

  it('fires a late-arriving beat immediately on the next update', () => {
    // A frame that overran must not skip a beat permanently.
    const h = harness([{ id: 'b1', at: 0.02, action: { type: 'hide-copy' } }]);
    h.director.start();

    h.step(5);
    expect(h.fired).toHaveLength(1);
  });

  it('runs same-time beats in author order', () => {
    const h = harness([
      { id: 'first', at: 0, action: { type: 'show-copy', text: 'a' } },
      { id: 'second', at: 0, action: { type: 'show-copy', text: 'b' } },
    ]);
    h.director.start();
    h.step(0);

    expect(h.fired).toEqual([
      { type: 'show-copy', text: 'a' },
      { type: 'show-copy', text: 'b' },
    ]);
  });

  it('reports elapsed time', () => {
    const h = harness();
    h.director.start();
    h.step(3);
    expect(h.director.elapsedSeconds).toBeCloseTo(3, 3);
  });
});

describe('Director gates', () => {
  const gated: Beat[] = [
    { id: 'early', at: 0, action: { type: 'hide-copy' } },
    { id: 'gated', at: 0.5, gate: 'win', action: { type: 'celebrate' } },
  ];

  it('holds a gated beat until its gate opens', () => {
    const h = harness(gated);
    h.director.start();

    h.step(3);
    expect(h.types()).toEqual(['hide-copy']);
    expect(h.director.pendingGated()).toEqual(['gated']);
  });

  it('releases gated beats as soon as the gate opens', () => {
    const h = harness(gated);
    h.director.start();
    h.step(3);

    h.director.notify('win');
    h.step(0.016);

    expect(h.types()).toContain('celebrate');
  });

  it('ignores a repeated notify for the same gate', () => {
    const h = harness(gated);
    h.director.start();
    h.director.notify('win');
    h.director.notify('win');
    h.step(3);

    expect(h.types().filter((t) => t === 'celebrate')).toHaveLength(1);
  });

  it('does not leak one gate into another', () => {
    const h = harness([
      { id: 'a', at: 0, gate: 'win', action: { type: 'celebrate' } },
      { id: 'b', at: 0, gate: 'cta', action: { type: 'show-cta' } },
    ]);
    h.director.start();
    h.director.notify('win');
    h.step(0.1);

    expect(h.types()).toEqual(['celebrate']);
  });

  it('stops after stop()', () => {
    const h = harness();
    h.director.start();
    h.director.stop();
    h.step(20);
    expect(h.fired).toHaveLength(0);
  });

  it('reports finished when every beat has fired', () => {
    const h = harness(gated);
    h.director.start();
    h.step(3);
    expect(h.director.finished).toBe(false);

    h.director.notify('win');
    h.step(0.1);
    expect(h.director.finished).toBe(true);
  });

  it('clears state on restart so a replay behaves identically', () => {
    const h = harness(gated);
    h.director.start();
    h.step(3);
    h.director.notify('win');
    h.step(0.1);
    expect(h.director.finished).toBe(true);
    expect(h.fired).toHaveLength(2);

    // Replaying must not carry over "already fired" state, or a second view
    // (or an A/B rerun in the same page) would show a half-played ad.
    h.fired.length = 0; // only the director's own state is under test here
    h.director.stop();
    h.director.start();
    expect(h.director.hasFired('early')).toBe(false);
    expect(h.director.finished).toBe(false);

    h.step(0);
    expect(h.types()).toEqual(['hide-copy']);
    expect(h.director.hasFired('gated')).toBe(false);
    expect(h.director.pendingGated()).toEqual(['gated']);
  });

  it('ignores a start() while already running', () => {
    // A duplicate start must not silently rewind the timeline mid-play, which
    // would replay the hook.
    const h = harness();
    h.director.start();
    h.step(2);
    const at = h.director.elapsedSeconds;

    h.director.start();
    h.step(0.5);

    expect(h.director.elapsedSeconds).toBeGreaterThan(at);
  });
});

describe('script data', () => {
  it('keeps the whole script inside the conversion window', () => {
    const last = Math.max(...DEFAULT_SCRIPT.map((b) => b.at));
    expect(last).toBeLessThanOrEqual(TIMELINE_LENGTH_S);
  });

  it('places the CTA in the 10-15s window that converts best', () => {
    const cta = DEFAULT_SCRIPT.find((b) => b.action.type === 'show-cta');
    expect(cta).toBeDefined();
    expect(cta!.at).toBeGreaterThanOrEqual(10);
    expect(cta!.at).toBeLessThanOrEqual(15);
  });

  it('gates the CTA behind a win', () => {
    const cta = DEFAULT_SCRIPT.find((b) => b.action.type === 'show-cta');
    expect(cta!.gate).toBe('win');
  });

  it('starts the board immediately, with no tap-to-start', () => {
    expect(DEFAULT_SCRIPT.some((b) => b.action.type === 'start-level' && b.at === 0)).toBe(true);
  });

  it('has no beat after the CTA that could distract from it', () => {
    const ctaIndex = DEFAULT_SCRIPT.findIndex((b) => b.action.type === 'show-cta');
    const after = DEFAULT_SCRIPT.slice(ctaIndex + 1).filter((b) => b.action.type === 'start-level');
    expect(after).toHaveLength(0);
  });

  it('uses unique beat ids', () => {
    const ids = DEFAULT_SCRIPT.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('orders beats by time', () => {
    const times = DEFAULT_SCRIPT.map((b) => b.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe('script variants', () => {
  it('has at least two variants to compare', () => {
    expect(SCRIPT_VARIANTS.length).toBeGreaterThanOrEqual(2);
  });

  it('states a hypothesis per variant', () => {
    for (const v of SCRIPT_VARIANTS) expect(v.hypothesis.length).toBeGreaterThan(10);
  });

  it('keeps variants inside the same window', () => {
    for (const v of SCRIPT_VARIANTS) {
      const last = Math.max(...v.beats.map((b) => b.at));
      expect(last).toBeLessThanOrEqual(TIMELINE_LENGTH_S);
    }
  });

  it('keeps variant beat ids unique', () => {
    for (const v of SCRIPT_VARIANTS) {
      const ids = v.beats.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('falls back to the first variant for an unknown id', () => {
    expect(scriptById('does-not-exist').id).toBe(SCRIPT_VARIANTS[0]!.id);
  });

  it('differs between variants only in the opening beats', () => {
    // If the tail diverged we would be comparing two different ads and could
    // not attribute the result to the hook.
    const a = SCRIPT_VARIANTS[0]!.beats.filter((b) => b.at > 1);
    const b = SCRIPT_VARIANTS[1]!.beats.filter((b) => b.at > 1);
    expect(a.map((x) => x.action.type)).toEqual(b.map((x) => x.action.type));
  });

  it('runs variant B through the director without throwing', () => {
    const runAction = vi.fn();
    let time = 0;
    const variant = scriptById('b-outcome');
    const director: Director = new Director({
      beats: variant.beats,
      hooks: { runAction },
      now: () => time,
    });

    director.start();
    director.notify('first-interaction');
    director.notify('win');
    for (let i = 0; i < 200; i += 1) {
      time += 100;
      director.update();
    }

    expect(director.finished).toBe(true);
  });
});
