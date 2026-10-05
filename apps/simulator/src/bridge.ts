/**
 * Fake ad-network container.
 *
 * A real playable is loaded into an iframe that has the network's SDK injected
 * and a chrome of its own over the top. Reproducing that locally is the point of
 * this file: without it, the CTA can only be tested by uploading a unit and
 * waiting for a review, which is a two-day round trip per change.
 *
 * What this fakes:
 *  - the SDK global each network injects (`mraid`, `FbPlayableAd`, `ExitApi`, ...);
 *  - the chrome at the bottom that can cover a badly placed CTA;
 *  - a log of every call the playable makes, so we can assert the *right* exit
 *    was used rather than just that the page did not crash.
 *
 * What it cannot fake: the network's own ad-serving and review pipeline. A
 * green run here means "the mechanics work in a container shaped like this one",
 * not "this will be approved".
 */

export type SimulatedNetwork =
  | 'mraid-generic'
  | 'meta'
  | 'google'
  | 'mintegral'
  | 'tiktok'
  | 'liftoff'
  | 'plain';

export interface NetworkSimulation {
  id: SimulatedNetwork;
  label: string;
  /** Pixels of chrome the network draws over the bottom of the unit. */
  bottomChrome: number;
  /** How the SDK exits to the store. */
  exit:
    | 'mraid.open'
    | 'onCTAClick'
    | 'ExitApi.exit'
    | 'window.install'
    | 'window.openAppStore'
    | 'postMessage'
    | 'window.open';
  note: string;
}

/**
 * Simulation parameters.
 *
 * The bottom chrome figures come from the networks' own layout docs. They are
 * approximate on purpose: the point is to make a CTA that sits too low visibly
 * wrong, not to be a pixel-accurate clone.
 */
export const SIMULATIONS: Record<SimulatedNetwork, NetworkSimulation> = {
  'mraid-generic': {
    id: 'mraid-generic',
    label: 'MRAID container (AppLovin / Unity / IronSource)',
    bottomChrome: 80,
    exit: 'mraid.open',
    note: 'MRAID is required here. The container owns the close and store buttons.',
  },
  meta: {
    id: 'meta',
    label: 'Meta (Facebook / Instagram)',
    bottomChrome: 120,
    exit: 'onCTAClick',
    note: 'MRAID is forbidden in the file. No logo on the first frame.',
  },
  google: {
    id: 'google',
    label: 'Google Ads / AdMob',
    bottomChrome: 100,
    exit: 'ExitApi.exit',
    note: 'No MRAID. Exits through ExitApi.',
  },
  mintegral: {
    id: 'mintegral',
    label: 'Mintegral',
    bottomChrome: 90,
    exit: 'window.install',
    note: 'Calls a global window.install().',
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok Ads (sound-on)',
    bottomChrome: 110,
    exit: 'window.openAppStore',
    note: 'Reward placements expect sound from the first frame.',
  },
  liftoff: {
    id: 'liftoff',
    label: 'Liftoff',
    bottomChrome: 80,
    exit: 'postMessage',
    note: 'postMessage("download") to the parent. Tightest size budget.',
  },
  plain: {
    id: 'plain',
    label: 'Plain HTML (no network)',
    bottomChrome: 0,
    exit: 'window.open',
    note: 'No SDK at all. The runtime must degrade to a normal link.',
  },
};

export interface BridgeLogEntry {
  at: number;
  api: string;
  detail: string;
}

export interface BridgeHandle {
  /** Installs the fake SDK globals into the iframe window. */
  install(target: Window): void;
  /** Records a call from the playable. */
  log(api: string, detail: string): void;
  /** Every call made so far, newest last. */
  entries(): BridgeLogEntry[];
  /** What the playable called to exit, if it did. */
  exitCall(): string | null;
  onLog(fn: (entry: BridgeLogEntry) => void): () => void;
}

/**
 * Creates a bridge that reports into `onLog`.
 *
 * The SDK globals are defined as plain functions rather than objects so that a
 * playable using optional chaining on them behaves exactly as it would against
 * a real SDK.
 */
export function createBridge(
  simulation: NetworkSimulation,
  onLog: (entry: BridgeLogEntry) => void,
): BridgeHandle {
  const started = Date.now();
  const entries: BridgeLogEntry[] = [];
  const listeners = new Set<(entry: BridgeLogEntry) => void>();
  let exit: string | null = null;

  const log = (api: string, detail: string): void => {
    const entry: BridgeLogEntry = { at: Date.now() - started, api, detail };
    entries.push(entry);
    onLog(entry);
    for (const listener of listeners) listener(entry);
  };

  const markExit = (api: string): void => {
    exit = api;
    log(api, 'the playable asked to open the store');
  };

  return {
    install(target: Window): void {
      const win = target as unknown as Record<string, unknown>;

      switch (simulation.exit) {
        case 'mraid.open': {
          win['mraid'] = {
            open: () => markExit('mraid.open'),
            close: () => log('mraid.close', 'container close requested'),
            getVersion: () => '3.0',
            isAvailable: () => true,
            setVolume: (v: number) => log('mraid.setVolume', String(v)),
          };
          break;
        }
        case 'onCTAClick': {
          win['FbPlayableAd'] = {
            onCTAClick: () => markExit('FbPlayableAd.onCTAClick'),
            onPlayableImpress: () => log('FbPlayableAd.onPlayableImpress', 'impression'),
          };
          break;
        }
        case 'ExitApi.exit': {
          win['ExitApi'] = {
            exit: () => markExit('ExitApi.exit'),
            signalInterstitialLoaded: () => log('ExitApi.signalInterstitialLoaded', ''),
          };
          break;
        }
        case 'window.install': {
          win['install'] = () => markExit('window.install');
          break;
        }
        case 'window.openAppStore': {
          win['openAppStore'] = () => markExit('window.openAppStore');
          break;
        }
        case 'postMessage': {
          // The playable posts to its parent, which is this page.
          win['__liftoffHook'] = () => markExit('postMessage("download")');
          break;
        }
        case 'window.open':
        default:
          // Nothing injected. The runtime should fall back on its own.
          break;
      }

      log('bridge', `simulating ${simulation.label}`);
    },

    log,
    entries: () => [...entries],
    exitCall: () => exit,
    onLog(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
