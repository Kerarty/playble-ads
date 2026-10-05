/**
 * Boot for the Meta build.
 *
 * A separate entry point rather than a runtime flag, so the MRAID adapter is
 * never imported and therefore never bundled. Meta rejects any unit containing
 * the string "mraid" anywhere, including in unreachable code, so this has to be
 * a module-graph decision and not a conditional.
 */
import { metaAdapters } from './targets/meta.js';
import { reportBootFailure, startPlayable } from './start.js';

const STORE_URL = 'https://play.google.com/store/apps/details?id=com.example.game';

const search = new URLSearchParams(location.search);

void startPlayable({
  adapters: metaAdapters(),
  target: 'meta',
  variant: search.get('variant') ?? 'a-instructional',
  debug: search.get('debug') === '1',
  forcedNetwork: search.get('network') ?? undefined,
  storeUrl: STORE_URL,
}).catch(reportBootFailure);
