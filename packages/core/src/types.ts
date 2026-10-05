/**
 * Public types for the playable runtime.
 *
 * The whole point of this package is that a game never imports an ad network
 * SDK directly. It talks to `Playable` and the runtime picks the right adapter.
 */

/** Networks we know how to talk to. `unknown` means "we fell back to plain HTML". */
export type NetworkId =
  | 'meta'
  | 'google'
  | 'applovin'
  | 'unity'
  | 'ironsource'
  | 'vungle'
  | 'mintegral'
  | 'tiktok'
  | 'pangle'
  | 'liftoff'
  | 'chartboost'
  | 'inmobi'
  | 'moloco'
  | 'unknown';

/** How the runtime got the user out to the store. */
export type ExitMethod = 'mraid.open' | 'fb-playable' | 'exit-api' | 'window.install' | 'post-message' | 'window.open' | 'location.assign';

/** What each network looks like from the inside of a playable. */
export interface NetworkProfile {
  id: NetworkId;
  /** Human readable name, used in the simulator UI and logs. */
  name: string;

  /** MRAID must not be referenced at all for these (Meta rejects the file). */
  requiresMraid: boolean;

  /**
   * How many pixels at the bottom of the viewport the network's own chrome covers.
   * The CTA is placed above this so the button is never hidden under network UI.
   */
  bottomUiInset: number;

  /** Reward placements like TikTok/Pangle expect sound on from the first frame. */
  defaultAudio: 'on' | 'gesture';

  /** Published file size cap in bytes, or null when the network publishes none. */
  maxBytes: number | null;

  /** The exact call this network expects for "take the user to the store". */
  exit: ExitMethod;

  /** Store URL used by the plain-HTML fallback path. */
  storeUrl?: string;
}

/** One frame of performance data, pushed from the engine. */
export interface PerfSample {
  /** Rolling average frames per second. */
  fps: number;
  /** Worst frame time seen in the sampling window, in ms. */
  worstFrameMs: number;
  /** 0 = untouched, 1 = full resolution. Lowered automatically on weak devices. */
  resolutionScale: number;
}

/** Payload for the `error` event. */
export interface PlayableErrorEvent {
  error: Error;
  /** Fatal errors mean the playable should stop and show its own fallback. */
  fatal: boolean;
  context?: Record<string, unknown>;
}

/**
 * Every event the runtime can emit. Typed on purpose: game code should never
 * have to cast an `any` to read `event.ms`.
 */
export interface PlayableEventMap {
  /** Assets are ready and the first frame is on screen. */
  ready: { network: NetworkProfile };
  /** The network SDK bridge was found (or we decided to fall back). */
  bridge: { network: NetworkProfile; detected: boolean };

  /** First real user interaction. The main engagement signal for UA. */
  firstInteraction: { ms: number };

  /** Fired once, the moment the player does the one thing the ad is about. */
  hook: { action: string };

  /** The round ended successfully. Should always happen before a CTA impression. */
  win: { moves: number; durationMs: number };

  /** The install button became visible on screen. */
  ctaImpression: { network: NetworkProfile };

  /** The player tapped install. */
  ctaTap: { via: ExitMethod; network: NetworkProfile };

  /** The player asked to dismiss the ad. */
  skip: { via: ExitMethod };

  error: PlayableErrorEvent;

  /** Periodic performance sample. */
  perf: PerfSample;

  /** Free-form game events forwarded to analytics. */
  track: { name: string; data?: Record<string, unknown> };
}

/** Handler signature for a given event name. */
export type PlayableListener<K extends keyof PlayableEventMap> = (payload: PlayableEventMap[K]) => void;

/** Adapter-side types, re-exported here so consumers need one import. */
export type { Adapter, AdapterEnv } from './adapter.js';
