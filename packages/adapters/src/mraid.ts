/**
 * The slice of the MRAID API that a playable actually uses.
 *
 * MRAID is the de-facto bridge for in-app HTML5 ads. We only declare the parts
 * we call, because a full copy of the MRAID typings is large and mostly unused.
 */
export interface MraidApi {
  open(url?: string): void;
  close(): void;
  getVersion(): string;
  isAvailable(): boolean;
  setVolume(volume: number): void;
}

declare global {
  interface Window {
    mraid?: MraidApi;
  }
}

/** Reads `window.mraid` without assuming the page actually has one. */
export function getMraid(win: Window): MraidApi | undefined {
  const mraid = win.mraid;
  return mraid && typeof mraid.open === 'function' ? mraid : undefined;
}

/** MRAID fires this event once the container is ready to accept `open()`. */
export const MRAID_READY_EVENT = 'mraidready';
