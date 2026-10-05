import type { Adapter, AdapterEnv } from './adapter.js';
import type { NetworkId, NetworkProfile } from './types.js';

/** Minimal adapter so the runtime keeps working outside any ad network. */
function fallbackProfile(storeUrl: string | undefined): NetworkProfile {
  return {
    id: 'unknown',
    name: 'Plain HTML (fallback)',
    requiresMraid: false,
    bottomUiInset: 0,
    defaultAudio: 'gesture',
    maxBytes: null,
    exit: storeUrl ? 'window.open' : 'location.assign',
    ...(storeUrl ? { storeUrl } : {}),
  };
}

/**
 * Picks the adapter to use for the current page.
 *
 * Order matters: adapters are tested in registration order, so more specific
 * networks must be registered before the generic ones.
 */
export class AdapterRegistry {
  private readonly adapters: Adapter[] = [];

  register(...adapters: Adapter[]): this {
    this.adapters.push(...adapters);
    return this;
  }

  list(): readonly Adapter[] {
    return this.adapters;
  }

  /** All profiles, for docs generation and the simulator's network picker. */
  profiles(): NetworkProfile[] {
    return this.adapters.map((a) => a.profile);
  }

  get(id: NetworkId): Adapter | undefined {
    return this.adapters.find((a) => a.profile.id === id);
  }

  /**
   * Returns the adapter for this page.
   *
   * Precedence:
   * 1. an explicit `forced` id (simulator, E2E tests, QA deep links);
   * 2. the first adapter whose `detect()` returns true;
   * 3. the plain-HTML fallback.
   */
  resolve(env: AdapterEnv, fallbackStoreUrl?: string): { adapter: Adapter; detected: boolean } {
    if (env.forced) {
      const forced = this.get(env.forced);
      if (forced) return { adapter: forced, detected: true };
      // A forced id we do not know about must not silently become a real
      // network - that would send a Meta unit to the store the Meta way.
      return { adapter: plainHtmlAdapter(fallbackStoreUrl), detected: false };
    }

    for (const adapter of this.adapters) {
      if (adapter.detect(env)) return { adapter, detected: true };
    }

    return { adapter: plainHtmlAdapter(fallbackStoreUrl), detected: false };
  }
}

/** The adapter used when no network SDK is present. */
export function plainHtmlAdapter(storeUrl?: string): Adapter {
  const profile = fallbackProfile(storeUrl);
  return {
    profile,
    detect: () => false,
    install: (env) => {
      const url = profile.storeUrl ?? env.win.location.href;
      const opened = env.win.open(url, '_blank');
      if (!opened) {
        // Popup blocked (very common in in-app WebViews) - fall back to a
        // same-tab navigation, which is worse for the user but still lands them
        // on the store page instead of nowhere.
        env.win.location.assign(url);
        return 'location.assign';
      }
      return 'window.open';
    },
  };
}
