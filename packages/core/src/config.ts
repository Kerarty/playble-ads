import type { NetworkId } from './types.js';

/** What a game may pass to `createPlayble`. */
export interface PlayableConfig {
  /**
   * Store URL for the plain-HTML fallback and for networks that do not inject
   * their own store link.
   */
  storeUrl?: string;

  /** Force a network instead of detecting it. Used by the simulator and tests. */
  network?: NetworkId;

  /**
   * `gesture` (default) starts muted and unlocks on first touch, which is what
   * mobile autoplay policy requires. `on` starts with sound, which reward
   * placements like TikTok/Pangle expect.
   */
  audio?: 'on' | 'gesture';

  /** Master volume, 0..1. */
  volume?: number;

  /** Verbose logging plus the dev-only guards. Never enable in a shipped unit. */
  debug?: boolean;

  /** Frame rate the engine aims for. */
  targetFps?: number;

  /** Drop render resolution when the device cannot hold the target. */
  autoQuality?: boolean;

  /** Average FPS below which quality starts dropping. */
  lowFpsThreshold?: number;

  /** Delay between `win` and the install button appearing, in ms. */
  ctaAfterWinMs?: number;

  /** Ask the engine for a perf sample every N milliseconds. */
  perfSampleMs?: number;
}

/** `PlayableConfig` with every field filled in. */
export type ResolvedConfig = Required<PlayableConfig>;

const DEFAULTS: ResolvedConfig = {
  storeUrl: '',
  network: 'unknown',
  audio: 'gesture',
  volume: 1,
  debug: false,
  targetFps: 60,
  autoQuality: true,
  lowFpsThreshold: 45,
  ctaAfterWinMs: 600,
  perfSampleMs: 1000,
};

const NETWORKS: readonly NetworkId[] = [
  'meta',
  'google',
  'applovin',
  'unity',
  'ironsource',
  'vungle',
  'mintegral',
  'tiktok',
  'pangle',
  'liftoff',
  'chartboost',
  'inmobi',
  'moloco',
  'unknown',
];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validates and fills in a config.
 *
 * This is a hand written validator rather than a schema library on purpose:
 * `@playble/core` ships with zero runtime dependencies, and ~50 lines buys
 * clearer error messages than any generic library would at this size.
 */
export function defineConfig(input?: Partial<PlayableConfig>): ResolvedConfig {
  if (input === undefined) return { ...DEFAULTS };

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ConfigError('createPlayble(config): config must be an object');
  }

  const cfg: ResolvedConfig = { ...DEFAULTS };

  for (const key of Object.keys(input) as (keyof PlayableConfig)[]) {
    const value = input[key];
    if (value === undefined) continue;

    switch (key) {
      case 'storeUrl':
        cfg.storeUrl = requireString(key, value);
        break;
      case 'network':
        cfg.network = requireNetwork(key, value);
        break;
      case 'audio':
        if (value !== 'on' && value !== 'gesture') {
          throw new ConfigError(`config.${key} must be "on" or "gesture"`);
        }
        cfg.audio = value;
        break;
      case 'volume':
        cfg.volume = requireRange(key, value, 0, 1);
        break;
      case 'debug':
        cfg.debug = requireBoolean(key, value);
        break;
      case 'targetFps':
        cfg.targetFps = Math.round(requireRange(key, value, 30, 120));
        break;
      case 'autoQuality':
        cfg.autoQuality = requireBoolean(key, value);
        break;
      case 'lowFpsThreshold':
        cfg.lowFpsThreshold = Math.round(requireRange(key, value, 10, 120));
        break;
      case 'ctaAfterWinMs':
        cfg.ctaAfterWinMs = Math.round(requireRange(key, value, 0, 5000));
        break;
      case 'perfSampleMs':
        cfg.perfSampleMs = Math.round(requireRange(key, value, 100, 10000));
        break;
      default:
        throw new ConfigError(`unknown config key "${String(key)}"`);
    }
  }

  // A threshold above the target is always a mistake (asking for 30fps while
  // treating 45fps as "slow" would never trigger), but clamping is friendlier
  // than throwing: lowering targetFps alone should just work.
  if (cfg.lowFpsThreshold > cfg.targetFps) {
    cfg.lowFpsThreshold = cfg.targetFps;
  }

  return cfg;
}

function requireString(key: string, value: unknown): string {
  if (typeof value !== 'string') throw new ConfigError(`config.${key} must be a string`);
  return value;
}

function requireBoolean(key: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ConfigError(`config.${key} must be a boolean`);
  return value;
}

function requireRange(key: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ConfigError(`config.${key} must be a number`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`config.${key} must be between ${min} and ${max}, got ${value}`);
  }
  return value;
}

function requireNetwork(key: string, value: unknown): NetworkId {
  const network = requireString(key, value) as NetworkId;
  if (!NETWORKS.includes(network)) {
    throw new ConfigError(`config.${key} is not a known network: ${network}`);
  }
  return network;
}
