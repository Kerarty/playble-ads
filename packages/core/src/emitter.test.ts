import { describe, expect, it, vi } from 'vitest';
import { Emitter } from './emitter.js';

/** A minimal map so the dispatch rules can be tested in isolation. */
interface TestMap extends Record<string, unknown> {
  ping: { n: number };
  pong: { s: string };
}

function emitter(): Emitter<TestMap> {
  return new Emitter<TestMap>();
}

describe('Emitter', () => {
  it('delivers the payload to every listener', () => {
    const e = emitter();
    const seen: number[] = [];
    e.on('ping', (p) => seen.push(p.n));
    e.on('ping', (p) => seen.push(p.n * 2));

    e.emit('ping', { n: 21 });
    expect(seen).toEqual([21, 42]);
  });

  it('unsubscribes via the returned function', () => {
    const e = emitter();
    const spy = vi.fn();
    const off = e.on('ping', spy);

    off();
    e.emit('ping', { n: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('fires a once listener exactly once', () => {
    const e = emitter();
    const spy = vi.fn();
    e.once('ping', spy);

    e.emit('ping', { n: 1 });
    e.emit('ping', { n: 2 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('lets a listener unsubscribe during dispatch without skipping others', () => {
    const e = emitter();
    const second = vi.fn();
    const offFirst = e.on('ping', () => offFirst());

    e.on('ping', second);

    expect(() => e.emit('ping', { n: 1 })).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps dispatching when one listener throws', () => {
    const e = emitter();
    const report = vi.fn();
    e.onListenerError = report;

    const healthy = vi.fn();
    e.on('ping', () => {
      throw new Error('boom');
    });
    e.on('ping', healthy);

    expect(() => e.emit('ping', { n: 1 })).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('reports 0 listeners for unknown events', () => {
    const e = emitter();
    expect(e.listenerCount('ping')).toBe(0);
  });
});
