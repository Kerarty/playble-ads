import { describe, expect, it, vi } from 'vitest';
import {
  createAllAdapters,
  getMraid,
  googleAdapter,
  liftoffAdapter,
  metaAdapter,
  mintegralAdapter,
  molocoAdapter,
  supportedNetworks,
} from './index.js';
import { AdapterRegistry, type AdapterEnv } from '@playble/core';

/** A window with no network SDK in it, which is the common case. */
function bareEnv(): AdapterEnv {
  return { win: {} as Window, doc: {} as Document };
}

function winWith(globals: Record<string, unknown>): AdapterEnv {
  return { win: globals as unknown as Window, doc: {} as Document };
}

describe('createAllAdapters', () => {
  it('covers every documented network', () => {
    const ids = supportedNetworks().map((p) => p.id);
    for (const expected of [
      'meta',
      'moloco',
      'google',
      'mintegral',
      'tiktok',
      'pangle',
      'applovin',
      'unity',
      'ironsource',
      'vungle',
      'chartboost',
      'inmobi',
      'liftoff',
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it('puts non-MRAID networks first', () => {
    // Detection order matters: MRAID networks are indistinguishable from each
    // other, so a network with its own detectable global must be tested first.
    const ids = createAllAdapters().map((a) => a.profile.id);
    const mraidIdx = ids.indexOf('applovin');
    expect(ids.indexOf('meta')).toBeLessThan(mraidIdx);
    expect(ids.indexOf('google')).toBeLessThan(mraidIdx);
  });

  it('gives every network a published size cap or none at all', () => {
    for (const profile of supportedNetworks()) {
      expect(profile.maxBytes === null || profile.maxBytes > 0).toBe(true);
    }
  });

  it('marks Meta as a network that does not use MRAID', () => {
    // `requiresMraid` means "this network wants the MRAID bridge". Meta is the
    // one network that forbids MRAID outright rather than requiring it, which is
    // why it needs its own build target.
    expect(metaAdapter().profile.requiresMraid).toBe(false);
    expect(metaAdapter().profile.id).toBe('meta');
  });
});

describe('detection', () => {
  it('detects Meta from FbPlayableAd', () => {
    const env = winWith({ FbPlayableAd: { onCTAClick() {} } });
    expect(metaAdapter().detect(env)).toBe(true);
  });

  it('ignores a malformed FbPlayableAd', () => {
    expect(metaAdapter().detect(winWith({ FbPlayableAd: {} }))).toBe(false);
  });

  it('detects Google from ExitApi', () => {
    expect(googleAdapter().detect(winWith({ ExitApi: { exit() {} } }))).toBe(true);
  });

  it('detects Mintegral from window.install', () => {
    expect(mintegralAdapter().detect(winWith({ install() {} }))).toBe(true);
  });

  it('detects nothing in a bare window', () => {
    for (const adapter of createAllAdapters()) {
      expect(adapter.detect(bareEnv())).toBe(false);
    }
  });
});

describe('Liftoff detection', () => {
  it('never claims a page by feature detection', () => {
    // Liftoff injects no global. Returning true here would make this adapter
    // claim every plain HTML page and every network we failed to recognise, and
    // the fallback path reaches the store correctly where posting to a parent
    // that is not listening does not.
    expect(liftoffAdapter().detect(bareEnv())).toBe(false);
    expect(liftoffAdapter().detect(winWith({ mraid: { open() {} } }))).toBe(false);
  });

  it('is still reachable when pinned by config.network', () => {
    const registry = new AdapterRegistry().register(...createAllAdapters());
    const { adapter, detected } = registry.resolve({ ...bareEnv(), forced: 'liftoff' });
    expect(adapter.profile.id).toBe('liftoff');
    expect(detected).toBe(true);
  });

  it('is not what a bare page resolves to', () => {
    const registry = new AdapterRegistry().register(...createAllAdapters());
    expect(registry.resolve(bareEnv()).adapter.profile.id).toBe('unknown');
  });
});

describe('MRAID', () => {
  it('is detected from the global', () => {
    const mraid = { open() {}, close() {}, getVersion: () => '3.0', isAvailable: () => true, setVolume() {} };
    const applovin = createAllAdapters().find((a) => a.profile.id === 'applovin');
    expect(applovin?.detect(winWith({ mraid, APPLOVINSDK: {} }))).toBe(true);
  });

  it('getMraid returns undefined without the global', () => {
    expect(getMraid({} as Window)).toBeUndefined();
  });

  it('getMraid returns undefined when open() is missing', () => {
    expect(getMraid({ mraid: {} } as unknown as Window)).toBeUndefined();
  });

  it('opens the store with mraid.open', () => {
    const open = vi.fn();
    const unity = createAllAdapters().find((a) => a.profile.id === 'unity');
    const via = unity?.install(winWith({ mraid: { open, setVolume() {} } }));
    expect(via).toBe('mraid.open');
    expect(open).toHaveBeenCalled();
  });

  it('throws a useful error when mraid disappears between detect and install', () => {
    const unity = createAllAdapters().find((a) => a.profile.id === 'unity');
    expect(() => unity?.install(bareEnv())).toThrow(/mraid disappeared/);
  });
});

describe('Moloco', () => {
  it('detects from the same global as Meta', () => {
    expect(molocoAdapter().detect(winWith({ FbPlayableAd: { onCTAClick() {} } }))).toBe(true);
  });

  it('wins over Meta because it is registered second', () => {
    const ids = createAllAdapters().map((a) => a.profile.id);
    expect(ids.indexOf('meta')).toBeLessThan(ids.indexOf('moloco'));
  });
});
