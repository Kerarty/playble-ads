/**
 * Adapter sets, one module per build target.
 *
 * Split across files rather than switched inside one function because of tree
 * shaking. A `switch` on a build-time constant still leaves every branch
 * reachable to the bundler, so the MRAID adapter's code stayed in the "meta"
 * bundle - and Meta rejects the file for merely containing the string "mraid",
 * even in code that never runs.
 *
 * Separate modules mean a separate chunk graph: if `meta.ts` does not import the
 * MRAID module, the bundler has nothing to keep.
 */
import type { Adapter } from '@playble/core';
import { metaAdapter, molocoAdapter } from '@playble/adapters';

/** Meta and Moloco only. No MRAID import anywhere in this graph. */
export function metaAdapters(): Adapter[] {
  return [metaAdapter(), molocoAdapter()];
}
