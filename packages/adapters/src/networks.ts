import type { Adapter, AdapterEnv, NetworkProfile } from '@playble/core';
import { getMraid, type MraidApi } from './mraid.js';

/** Extra globals some networks inject. Used only to disambiguate detection. */
interface NetworkHints {
  globals?: readonly string[];
}

function hasGlobal(win: Window, name: string): boolean {
  return name in win;
}

function hintMatches(win: Window, hints: NetworkHints | undefined): boolean {
  if (!hints?.globals?.length) return true;
  return hints.globals.some((name) => hasGlobal(win, name));
}

/**
 * Builds an adapter for a network that stores are reached through MRAID.
 *
 * Detection caveat, and it is a real one: AppLovin, Unity, IronSource, Vungle,
 * Chartboost and InMobi all expose MRAID and little else at the runtime level.
 * A playable loaded in any of them is genuinely indistinguishable from the
 * others by feature detection alone. We detect the *bridge* (MRAID) and let the
 * unit be pinned to a specific network via `config.network`, which is what a QA
 * deep link or the simulator does. Guessing wrong is not harmful - every one of
 * these networks wants `mraid.open()` anyway - but it does mean analytics
 * attribution should be driven by the network's own callbacks, not our guess.
 */
export function mraidAdapter(profile: NetworkProfile, hints?: NetworkHints): Adapter {
  return {
    profile,

    detect(env: AdapterEnv): boolean {
      return getMraid(env.win) !== undefined && hintMatches(env.win, hints);
    },

    install(env: AdapterEnv) {
      const mraid: MraidApi | undefined = getMraid(env.win);
      if (!mraid) throw new Error(`${profile.name}: mraid disappeared between detect() and install()`);

      // Best effort: some containers mute the playable for us and only react to
      // an explicit setVolume(0). Harmless where unsupported.
      try {
        mraid.setVolume(0);
      } catch {
        /* container does not implement it */
      }

      mraid.open(profile.storeUrl);
      return 'mraid.open';
    },

    setVolume(env: AdapterEnv, volume: number) {
      getMraid(env.win)?.setVolume(volume);
    },
  };
}

/** Meta / Moloco: `FbPlayableAd.onCTAClick()`. MRAID is forbidden in the file. */
export interface FbPlayableApi {
  onCTAClick(): void;
  onPlayableImpress?: () => void;
  onPlayableClose?: (wasCompleted: boolean) => void;
}

declare global {
  interface Window {
    FbPlayableAd?: FbPlayableApi;
  }
}

export function metaAdapter(): Adapter {
  const profile: NetworkProfile = {
    id: 'meta',
    name: 'Meta (Facebook / Instagram)',
    requiresMraid: false,
    bottomUiInset: 120,
    defaultAudio: 'gesture',
    maxBytes: 2 * 1024 * 1024,
    exit: 'fb-playable',
  };

  return {
    profile,
    detect: (env) => typeof env.win.FbPlayableAd?.onCTAClick === 'function',
    install(env) {
      const api = env.win.FbPlayableAd;
      if (!api) throw new Error('Meta: FbPlayableAd is missing');
      api.onCTAClick();
      return 'fb-playable';
    },
  };
}

/** Google App Campaigns: `ExitApi.exit()`. */
export interface ExitApi {
  exit(): void;
  signalInterstitialLoaded?: () => void;
  signalInterstitialImpression?: () => void;
}

declare global {
  interface Window {
    ExitApi?: ExitApi;
  }
}

export function googleAdapter(): Adapter {
  const profile: NetworkProfile = {
    id: 'google',
    name: 'Google Ads / AdMob',
    requiresMraid: false,
    bottomUiInset: 100,
    defaultAudio: 'gesture',
    maxBytes: 5 * 1024 * 1024,
    exit: 'exit-api',
  };

  return {
    profile,
    detect: (env) => typeof env.win.ExitApi?.exit === 'function',
    install(env) {
      const api = env.win.ExitApi;
      if (!api) throw new Error('Google: ExitApi is missing');
      api.signalInterstitialLoaded?.();
      api.exit();
      return 'exit-api';
    },
  };
}

/** Mintegral: `window.install()`. */
declare global {
  interface Window {
    install?: () => void;
  }
}

export function mintegralAdapter(): Adapter {
  const profile: NetworkProfile = {
    id: 'mintegral',
    name: 'Mintegral',
    requiresMraid: false,
    bottomUiInset: 90,
    defaultAudio: 'gesture',
    maxBytes: 5 * 1024 * 1024,
    exit: 'window.install',
  };

  return {
    profile,
    detect: (env) => typeof env.win.install === 'function',
    install(env) {
      const fn = env.win.install;
      if (!fn) throw new Error('Mintegral: window.install is missing');
      fn();
      return 'window.install';
    },
  };
}

/** TikTok / Pangle: `window.openAppStore()`. Both are sound-on placements. */
declare global {
  interface Window {
    openAppStore?: () => void;
  }
}

function openAppStoreAdapter(id: 'tiktok' | 'pangle', name: string): Adapter {
  const profile: NetworkProfile = {
    id,
    name,
    requiresMraid: false,
    bottomUiInset: 110,
    // Reward placements serve sound-on units; starting muted reads as broken.
    defaultAudio: 'on',
    maxBytes: 5 * 1024 * 1024,
    exit: 'window.open',
  };

  return {
    profile,
    detect: (env) => typeof env.win.openAppStore === 'function',
    install(env) {
      const fn = env.win.openAppStore;
      if (!fn) throw new Error(`${name}: window.openAppStore is missing`);
      fn();
      return 'window.open';
    },
  };
}

export const tiktokAdapter = (): Adapter => openAppStoreAdapter('tiktok', 'TikTok Ads');
export const pangleAdapter = (): Adapter => openAppStoreAdapter('pangle', 'Pangle');

/**
 * Liftoff: `postMessage("download")`. Also the smallest size budget of the set.
 *
 * `detect()` deliberately returns false. Liftoff injects no global we can look
 * for, so returning true would make this adapter claim every plain-HTML page and
 * every page of a network whose SDK we failed to recognise. Guessing wrong here
 * is worse than guessing nothing: the fallback path (`window.open`) reaches the
 * store correctly, whereas claiming Liftoff and posting to a parent that is not
 * listening does not.
 *
 * A Liftoff unit is therefore only used when it is pinned with
 * `config.network`, which is what a QA deep link or the simulator does.
 */
export function liftoffAdapter(): Adapter {
  const profile: NetworkProfile = {
    id: 'liftoff',
    name: 'Liftoff',
    requiresMraid: false,
    bottomUiInset: 80,
    defaultAudio: 'gesture',
    // Liftoff recommends well under their published 5 MB cap.
    maxBytes: 700 * 1024,
    exit: 'post-message',
  };

  return {
    profile,
    detect: () => false,
    install() {
      const target = globalThis.parent as Window | null;
      if (target && (target as unknown) !== globalThis) {
        target.postMessage('download', '*');
        return 'post-message';
      }
      throw new Error('Liftoff: no parent frame to postMessage to');
    },
  };
}

/** Moloco reuses Meta's bridge. */
export function molocoAdapter(): Adapter {
  const profile: NetworkProfile = {
    id: 'moloco',
    name: 'Moloco',
    requiresMraid: false,
    bottomUiInset: 100,
    defaultAudio: 'gesture',
    maxBytes: 5 * 1024 * 1024,
    exit: 'fb-playable',
  };

  return {
    profile,
    detect: (env) => typeof env.win.FbPlayableAd?.onCTAClick === 'function',
    install(env) {
      const api = env.win.FbPlayableAd;
      if (!api) throw new Error('Moloco: FbPlayableAd is missing');
      api.onCTAClick();
      return 'fb-playable';
    },
  };
}
