import { mraidAdapter, metaAdapter, googleAdapter, mintegralAdapter, tiktokAdapter, pangleAdapter, liftoffAdapter, molocoAdapter } from './networks.js';
import type { Adapter, NetworkProfile } from '@playble/core';

/**
 * Every adapter we ship, in detection order.
 *
 * Order is the whole game here: the non-MRAID networks inject a global we can
 * detect precisely, so they must come first. Everything that is only
 * "MRAID is present" goes after, most specific first.
 */
export function createAllAdapters(): Adapter[] {
  return [
    metaAdapter(),
    molocoAdapter(),
    googleAdapter(),
    mintegralAdapter(),
    tiktokAdapter(),
    pangleAdapter(),

    mraidAdapter(
      { id: 'applovin', name: 'AppLovin MAX', requiresMraid: true, bottomUiInset: 90, defaultAudio: 'gesture', maxBytes: 5 * 1024 * 1024, exit: 'mraid.open' },
      { globals: ['APPLOVINSDK', 'mraid'] },
    ),
    mraidAdapter(
      { id: 'unity', name: 'Unity Ads', requiresMraid: true, bottomUiInset: 80, defaultAudio: 'gesture', maxBytes: 5 * 1024 * 1024, exit: 'mraid.open' },
      { globals: ['unitySDK', 'mraid'] },
    ),
    mraidAdapter(
      { id: 'ironsource', name: 'IronSource / LevelPlay', requiresMraid: true, bottomUiInset: 80, defaultAudio: 'gesture', maxBytes: 5 * 1024 * 1024, exit: 'mraid.open' },
      { globals: ['IronSource', 'mraid'] },
    ),
    mraidAdapter(
      { id: 'vungle', name: 'Vungle (Liftoff)', requiresMraid: true, bottomUiInset: 80, defaultAudio: 'gesture', maxBytes: 5 * 1024 * 1024, exit: 'mraid.open' },
      { globals: ['Vungle', 'mraid'] },
    ),
    mraidAdapter(
      { id: 'chartboost', name: 'Chartboost', requiresMraid: true, bottomUiInset: 80, defaultAudio: 'gesture', maxBytes: null, exit: 'mraid.open' },
    ),
    mraidAdapter(
      { id: 'inmobi', name: 'InMobi', requiresMraid: true, bottomUiInset: 80, defaultAudio: 'gesture', maxBytes: null, exit: 'mraid.open' },
    ),

    // No detectable SDK, only reachable when the unit is pinned to it.
    liftoffAdapter(),
  ];
}

/** Flat list of supported networks, for docs and the simulator picker. */
export function supportedNetworks(): NetworkProfile[] {
  return createAllAdapters().map((a) => a.profile);
}

export { getMraid, MRAID_READY_EVENT, type MraidApi } from './mraid.js';
export {
  mraidAdapter,
  metaAdapter,
  googleAdapter,
  mintegralAdapter,
  tiktokAdapter,
  pangleAdapter,
  liftoffAdapter,
  molocoAdapter,
  type FbPlayableApi,
  type ExitApi,
} from './networks.js';
