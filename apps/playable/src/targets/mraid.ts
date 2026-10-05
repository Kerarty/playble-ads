/**
 * MRAID-network adapter set: AppLovin, Unity, IronSource, Vungle.
 *
 * These all want `mraid.open()` and nothing else differs, so one factory call per
 * profile is the whole adapter.
 */
import type { Adapter, NetworkProfile } from '@playble/core';
import { mraidAdapter } from '@playble/adapters';

const PROFILES: readonly NetworkProfile[] = [
  { id: 'applovin', name: 'AppLovin MAX', requiresMraid: true, bottomUiInset: 90, defaultAudio: 'gesture', maxBytes: 5 * 1024 * 1024, exit: 'mraid.open' },
  { id: 'unity', name: 'Unity Ads', requiresMraid: true, bottomUiInset: 80, defaultAudio: 'gesture', maxBytes: 5 * 1024 * 1024, exit: 'mraid.open' },
  { id: 'ironsource', name: 'IronSource / LevelPlay', requiresMraid: true, bottomUiInset: 80, defaultAudio: 'gesture', maxBytes: 5 * 1024 * 1024, exit: 'mraid.open' },
  { id: 'vungle', name: 'Vungle (Liftoff)', requiresMraid: true, bottomUiInset: 80, defaultAudio: 'gesture', maxBytes: 5 * 1024 * 1024, exit: 'mraid.open' },
];

export function mraidAdapters(): Adapter[] {
  return PROFILES.map((profile) => mraidAdapter(profile));
}
