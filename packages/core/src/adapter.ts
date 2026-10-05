import type { ExitMethod, NetworkId, NetworkProfile } from './types.js';

/**
 * Everything an adapter is allowed to touch.
 *
 * Passing this in explicitly (rather than reading `window` directly) is what
 * makes the adapters testable and what lets the simulator fake a network.
 */
export interface AdapterEnv {
  win: Window;
  doc: Document;
  /**
   * Forces a specific network. The simulator sets this; in production the
   * network is always detected from the injected SDK.
   */
  forced?: NetworkId | undefined;
}

/**
 * One ad network, wrapped.
 *
 * An adapter does exactly two things: recognise its network, and send the user
 * to the store the way that network expects. Everything else in the runtime is
 * network agnostic.
 */
export interface Adapter {
  readonly profile: NetworkProfile;

  /** True when this network's SDK is actually present in the page. */
  detect(env: AdapterEnv): boolean;

  /**
   * Opens the store. Returns which call was used, so the SDK can report it and
   * the simulator can assert on it.
   */
  install(env: AdapterEnv): ExitMethod;

  /** Optional audio control. Networks without audio control simply omit it. */
  setVolume?(env: AdapterEnv, volume: number): void;
}
