import type { Adapter, AdapterEnv } from './adapter.js';
import { defineConfig, type PlayableConfig, type ResolvedConfig } from './config.js';
import { installExternalRequestGuard } from './dev.js';
import { Emitter } from './emitter.js';
import { AdapterRegistry, plainHtmlAdapter } from './registry.js';
import type { ExitMethod, NetworkProfile, PerfSample, PlayableEventMap, PlayableListener } from './types.js';

/** The object a game interacts with. */
export interface Playable {
  readonly config: ResolvedConfig;
  /** Resolved network profile for the current page. */
  readonly network: NetworkProfile;
  /** Whether a real network SDK was found (false means plain-HTML fallback). */
  readonly bridgeDetected: boolean;

  on<K extends keyof PlayableEventMap>(event: K, fn: PlayableListener<K>): () => void;
  once<K extends keyof PlayableEventMap>(event: K, fn: PlayableListener<K>): () => void;
  off<K extends keyof PlayableEventMap>(event: K, fn: PlayableListener<K>): void;

  /** Call once, on the very first real user gesture. Emits `firstInteraction`. */
  notifyInteraction(action?: string): void;
  /** Whether `notifyInteraction` already fired. */
  readonly interactionSeen: boolean;

  /** Round finished. Schedules `win`, then the CTA impression. */
  reportWin(result: { moves: number; durationMs: number }): void;
  /** Mark the install button as actually visible. */
  showCta(): void;
  /**
   * Assets are up and the first frame is on screen. Call once, after the first
   * render - not before, or a wrapper listening for `ready` would measure a
   * black rectangle.
   */
  markReady(): void;
  readonly ready: boolean;

  /** Send the user to the store the way the current network expects. */
  install(): ExitMethod;
  /** Dismiss the ad (no store). */
  skip(): void;

  track(name: string, data?: Record<string, unknown>): void;
  reportPerf(sample: PerfSample): void;
  reportError(error: unknown, fatal?: boolean, context?: Record<string, unknown>): void;

  /** True after `install()` or `skip()`. The game should stop accepting input. */
  readonly ended: boolean;

  destroy(): void;
}

export interface CreatePlayableOptions {
  config?: PlayableConfig;
  /** Network adapters. If omitted the runtime uses the plain-HTML fallback. */
  adapters?: readonly Adapter[];
  /** Override the environment. Tests and the simulator use this. */
  env?: Partial<AdapterEnv>;
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

/**
 * Creates the playable runtime.
 *
 * The game gets one object and never learns which ad network it is running in.
 */
export function createPlayble(options: CreatePlayableOptions = {}): Playable {
  const config = defineConfig(options.config);
  const env: AdapterEnv = {
    win: options.env?.win ?? globalThis.window,
    doc: options.env?.doc ?? globalThis.document,
    forced: config.network === 'unknown' ? undefined : config.network,
  };

  const registry = new AdapterRegistry();
  if (options.adapters?.length) registry.register(...options.adapters);
  else registry.register(plainHtmlAdapter(config.storeUrl || undefined));

  const { adapter, detected } = registry.resolve(env, config.storeUrl || undefined);
  const profile = adapter.profile;
  const emitter = new Emitter();
  const startedAt = now();

  let interactionSeen = false;
  let ended = false;
  let ready = false;
  let uninstallGuard: (() => void) | undefined;

  emitter.onListenerError = (cause, event) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    emitter.emit('error', { error, fatal: false, context: { listener: String(event) } });
  };

  const log = (...args: unknown[]): void => {
    if (config.debug) console.log('[playble]', ...args);
  };

  if (config.debug) {
    uninstallGuard = installExternalRequestGuard(env.win, (violation) => {
      emitter.emit('error', {
        error: new Error(
          `External request blocked in a playable: ${violation.api}("${violation.url}"). ` +
            'Playable ads may only load assets from their own bundle.',
        ),
        fatal: true,
        context: violation as unknown as Record<string, unknown>,
      });
    });
  }

  // Measure time-to-first-interaction in the runtime rather than in each game,
  // so the metric stays comparable across creatives.
  const onFirstPointer = (): void => {
    api.notifyInteraction();
  };
  const attachInteractionListener = (): void => {
    const target = env.doc as Document & {
      addEventListener?: (t: string, h: () => void, o?: AddEventListenerOptions) => void;
      removeEventListener?: (t: string, h: () => void, o?: EventListenerOptions) => void;
      body?: HTMLElement | null;
      documentElement?: HTMLElement | null;
    };
    const node = target.body ?? target.documentElement ?? (target as unknown as HTMLElement);
    node.addEventListener?.('pointerdown', onFirstPointer, { passive: true, capture: true });
  };
  attachInteractionListener();

  const api: Playable = {
    config,
    network: profile,
    bridgeDetected: detected,

    get interactionSeen() {
      return interactionSeen;
    },

    get ended() {
      return ended;
    },

    get ready() {
      return ready;
    },

    on: (event, fn) => emitter.on(event, fn),
    once: (event, fn) => emitter.once(event, fn),
    off: (event, fn) => emitter.off(event, fn),

    notifyInteraction(action = 'tap') {
      if (interactionSeen) return;
      interactionSeen = true;
      const ms = Math.round(now() - startedAt);
      log('first interaction after', ms, 'ms');
      emitter.emit('firstInteraction', { ms });
      emitter.emit('hook', { action });
    },

    reportWin({ moves, durationMs }) {
      if (ended) return;
      log('win', moves, 'moves', durationMs, 'ms');
      emitter.emit('win', { moves, durationMs });
    },

    showCta() {
      if (ended) return;
      log('cta impression');
      emitter.emit('ctaImpression', { network: profile });
    },

    markReady() {
      if (ready || ended) return;
      ready = true;
      log('ready');
      emitter.emit('ready', { network: profile });
    },

    install() {
      if (ended) return 'window.open';
      ended = true;
      log('cta tap, exiting via', profile.exit);
      let via: ExitMethod;
      try {
        via = adapter.install(env);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        emitter.emit('error', { error, fatal: true, context: { phase: 'install' } });
        via = profile.exit;
      }
      emitter.emit('ctaTap', { via, network: profile });
      return via;
    },

    skip() {
      if (ended) return;
      ended = true;
      log('skip');
      const via = adapter.install(env);
      emitter.emit('skip', { via });
    },

    track(name, data) {
      if (!config.debug) return;
      log('track', name, data ?? {});
      emitter.emit('track', { name, data });
    },

    reportPerf(sample) {
      emitter.emit('perf', sample);
    },

    reportError(cause, fatal = false, context) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      emitter.emit('error', { error, fatal, context });
    },

    destroy() {
      const target = env.doc as Document & {
        removeEventListener?: (t: string, h: () => void, o?: EventListenerOptions) => void;
        body?: HTMLElement | null;
        documentElement?: HTMLElement | null;
      };
      const node = target.body ?? target.documentElement ?? (target as unknown as HTMLElement);
      node.removeEventListener?.('pointerdown', onFirstPointer, { capture: true } as EventListenerOptions);
      uninstallGuard?.();
      uninstallGuard = undefined;
      emitter.removeAll();
    },
  };

  emitter.emit('bridge', { network: profile, detected });

  log(`network: ${profile.name} (bridge ${detected ? 'found' : 'missing'})`);

  return api;
}
