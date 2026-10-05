/**
 * Development adapter set: everything.
 *
 * Used by `vite dev` and by the local `web` build, where the simulator switches
 * networks at runtime and we want a single file that can talk to any of them.
 * Never upload this artefact: it contains MRAID code, so Meta will reject it.
 */
import { createAllAdapters } from '@playble/adapters';

export function webAdapters() {
  return createAllAdapters();
}
