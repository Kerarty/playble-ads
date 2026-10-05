import { describe, expect, it, vi } from 'vitest';
import { AdapterRegistry, plainHtmlAdapter } from './registry.js';
import type { Adapter, AdapterEnv } from './adapter.js';
import type { NetworkProfile } from './types.js';

function profile(over: Partial<NetworkProfile> & { id: NetworkProfile['id'] }): NetworkProfile {
  return {
    name: over.id,
    requiresMraid: false,
    bottomUiInset: 0,
    defaultAudio: 'gesture',
    maxBytes: null,
    exit: 'window.open',
    ...over,
  };
}

function stubAdapter(id: NetworkProfile['id'], detect: boolean, installReturn: Adapter['install'] extends (...a: never[]) => infer R ? R : never = 'window.open'): Adapter {
  return {
    profile: profile({ id }),
    detect: () => detect,
    install: vi.fn(() => installReturn),
  };
}

function env(over: Partial<AdapterEnv> = {}): AdapterEnv {
  return {
    win: {} as Window,
    doc: {} as Document,
    ...over,
  };
}

describe('AdapterRegistry.resolve', () => {
  it('returns the first adapter whose detect() is true', () => {
    const first = stubAdapter('meta', false);
    const second = stubAdapter('google', true);
    const registry = new AdapterRegistry().register(first, second);

    const result = registry.resolve(env());
    expect(result.adapter).toBe(second);
    expect(result.detected).toBe(true);
  });

  it('respects registration order', () => {
    const a = stubAdapter('applovin', true);
    const b = stubAdapter('meta', true);
    const registry = new AdapterRegistry().register(a, b);

    expect(registry.resolve(env()).adapter).toBe(a);
  });

  it('falls back to plain HTML when nothing is detected', () => {
    const registry = new AdapterRegistry().register(stubAdapter('meta', false));
    const result = registry.resolve(env());

    expect(result.detected).toBe(false);
    expect(result.adapter.profile.id).toBe('unknown');
  });

  it('honours a forced network even when detect() is false', () => {
    const meta = stubAdapter('meta', false);
    const registry = new AdapterRegistry().register(meta);

    const result = registry.resolve(env({ forced: 'meta' }));
    expect(result.adapter).toBe(meta);
    expect(result.detected).toBe(true);
  });

  it('falls back rather than guessing when a forced network is unknown', () => {
    const registry = new AdapterRegistry().register(stubAdapter('meta', true));
    const result = registry.resolve(env({ forced: 'unity' }));

    expect(result.detected).toBe(false);
    expect(result.adapter.profile.id).toBe('unknown');
  });

  it('exposes profiles for docs and the simulator', () => {
    const registry = new AdapterRegistry().register(stubAdapter('meta', true), stubAdapter('google', true));
    expect(registry.profiles().map((p) => p.id)).toEqual(['meta', 'google']);
  });
});

describe('plainHtmlAdapter', () => {
  it('is never detected', () => {
    expect(plainHtmlAdapter().detect(env())).toBe(false);
  });

  it('uses window.open when it succeeds', () => {
    const open = vi.fn(() => ({}));
    const win = { open, location: { href: 'https://x', assign: vi.fn() } } as unknown as Window;

    const via = plainHtmlAdapter('https://store/app').install(env({ win }));
    expect(via).toBe('window.open');
    expect(open).toHaveBeenCalledWith('https://store/app', '_blank');
  });

  it('falls back to a navigation when the popup is blocked', () => {
    const assign = vi.fn();
    const win = { open: vi.fn(() => null), location: { href: 'https://x', assign } } as unknown as Window;

    const via = plainHtmlAdapter('https://store/app').install(env({ win }));
    expect(via).toBe('location.assign');
    expect(assign).toHaveBeenCalledWith('https://store/app');
  });

  it('stores the profile url on the adapter', () => {
    expect(plainHtmlAdapter('https://s').profile.storeUrl).toBe('https://s');
  });
});
