/**
 * Boot for the MRAID networks (AppLovin, Unity, IronSource, Vungle).
 */
import { mraidAdapters } from './targets/mraid.js';
import { reportBootFailure, startPlayable } from './start.js';

const STORE_URL = 'https://play.google.com/store/apps/details?id=com.example.game';

const search = new URLSearchParams(location.search);

void startPlayable({
  adapters: mraidAdapters(),
  target: 'mraid',
  variant: search.get('variant') ?? 'a-instructional',
  debug: search.get('debug') === '1',
  forcedNetwork: search.get('network') ?? undefined,
  storeUrl: STORE_URL,
}).catch(reportBootFailure);