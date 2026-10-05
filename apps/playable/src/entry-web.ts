/**
 * Boot for the "everything" build.
 *
 * Dev server and local runs: one file that can talk to every network, so the
 * simulator can switch without a rebuild. Contains MRAID code, so it is not
 * uploadable to Meta - see `entry-meta.ts`.
 */
import { reportBootFailure, startPlayable } from './start.js';
import { webAdapters } from './targets/web.js';

const STORE_URL = 'https://play.google.com/store/apps/details?id=com.example.game';

const search = new URLSearchParams(location.search);

void startPlayable({
  adapters: webAdapters(),
  target: 'web',
  variant: search.get('variant') ?? 'a-instructional',
  debug: search.get('debug') === '1',
  forcedNetwork: search.get('network') ?? undefined,
  storeUrl: STORE_URL,
}).catch(reportBootFailure);
