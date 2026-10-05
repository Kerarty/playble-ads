# Playble Ads

An engine-agnostic SDK for HTML5 playable ads, plus a demo playable and a
simulator for testing against real ad-network containers.

Playable ads are interactive ads: the user plays a few seconds of a game inside
the ad unit and then decides whether to install. They convert better than video
on install rate, which makes the format worth building properly.

## Why this exists

Every ad network wants HTML5 delivered as one self-contained file, forbids
external requests, and expects a specific call to send the user to the store.
Get any of that wrong and the unit is rejected in review, days after the creative
was finished. This repo makes those constraints a build-time check and a local
test instead.

## Layout

| Path | What it is |
|---|---|
| `packages/core` | The runtime. No dependencies, no renderer. Network detection, the event API, dev guards. |
| `packages/adapters` | One module per ad network. Knows how to reach the store, nothing else. |
| `packages/engine` | PixiJS loop, tweening, pooling, adaptive quality. |
| `apps/playable` | A merge game built on the engine. Three builds, one per network family. |
| `apps/simulator` | Runs a built playable in a fake network container and logs every SDK call. |
| `tools/spec-check` | Validates a built file against every network's published spec. |

## Status

v1.0.0. Typecheck, 161 unit tests and the spec-checked build are green; CI runs
them on every push.

Two limits worth stating before anything else:

- **The simulator fakes the SDK bridge and the network chrome.** It does not fake
  ad serving or review, so a green run there means "the mechanics work in a
  container shaped like this one", not "this will be approved".
- **The creative is unmeasured.** The timing and mechanics follow published
  benchmarks, but a playable needs real impressions to say anything about
  whether it installs. The two hook variants ship as hypotheses, not results.

## Quick start

```bash
npm install
npm run check        # typecheck, unit tests, and the spec-checked build
npm run simulator    # build the playable, then serve the simulator at :5174
```

Then open http://localhost:5174, pick a network, and press **Reload unit**.

## Using the SDK

A game never imports an ad network. It gets one object and calls it:

```ts
import { createPlayble } from '@playble/core';
import { createAllAdapters } from '@playble/adapters';

const playable = createPlayble({
  config: { storeUrl: 'https://play.google.com/store/apps/details?id=com.example' },
  adapters: createAllAdapters(),
});

playable.on('ctaTap', ({ via }) => console.log('installed via', via));

// ...in game code, when the install button is pressed:
playable.install();
```

`install()` routes to whatever the current network expects: `mraid.open()`,
`FbPlayableAd.onCTAClick()`, `ExitApi.exit()`, `window.install()`, or a plain
link when no network SDK is present.

## Network support

| Network | Store exit | Size cap | MRAID | Audio |
|---|---|---|---|---|
| Meta, Moloco | `FbPlayableAd.onCTAClick()` | 2 MB | **forbidden** | gesture |
| Google / AdMob | `ExitApi.exit()` | 5 MB | not used | gesture |
| AppLovin MAX | `mraid.open()` | 5 MB | required | gesture |
| Unity Ads | `mraid.open()` | 5 MB | required | gesture |
| IronSource / LevelPlay | `mraid.open()` | 5 MB | required | gesture |
| Vungle | `mraid.open()` | 5 MB | required | gesture |
| Chartboost, InMobi | `mraid.open()` | not published | required | gesture |
| Mintegral | `window.install()` | 5 MB | not used | gesture |
| TikTok, Pangle | `window.openAppStore()` | 5 MB | not used | **on** |
| Liftoff | `postMessage("download")` | 700 KB advised | not used | gesture |
| none detected | `window.open` | — | — | gesture |

Two details in that table drive real design decisions, and both are explained
where they are implemented:

- **Meta forbids MRAID outright.** Not "unused MRAID" — the string anywhere in
  the file. So `apps/playable` ships three separate bundles and the Meta one
  never imports the MRAID adapter. See `apps/playable/src/targets/`.
- **MRAID networks are indistinguishable at runtime.** AppLovin, Unity,
  IronSource and Vungle all expose MRAID and little else. Detection cannot tell
  them apart, so units get pinned with `config.network`. See
  `packages/adapters/src/networks.ts`.

## The simulator

`npm run simulator` serves the built playable inside a fake container with the
selected network's SDK injected, and logs every call it makes. A CTA that exits
through the wrong API, or that sits under the network's own chrome, is visible
immediately rather than in an upload review.

It loads the real built artefact, not a dev build, so size and inline-asset
behaviour are covered too.

## Validation

`npm run build` produces one artefact per network family and checks each against
every network's spec: file size, external requests, external scripts, MRAID
usage, and the required store-exit call. Failures fail the build.

```
[playble] checking meta.html (592.7 KB) for Meta and Moloco
meta.html  592.7 KB
OK accepted by: Unity Ads
```

The check is deliberately limited to what can be proven from the file. Whether
the creative itself is good is not something a static check can answer.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit and why
- [`docs/adr/`](docs/adr/) — the decisions worth arguing about, with reasons
- [`docs/playable-design.md`](docs/playable-design.md) — the creative side: timing, mechanics, and what the benchmarks say

## Roadmap

Open issues carry the reasoning, not just the task:

- [Playwright E2E for the simulator](https://github.com/Kerarty/playble-ads/issues/2)
- [Measure the two hook variants](https://github.com/Kerarty/playble-ads/issues/3)
- [Publish the simulator to Pages](https://github.com/Kerarty/playble-ads/issues/4)
- [Real containers vs the simulator](https://github.com/Kerarty/playble-ads/issues/5)
- [Attribute analytics to the serving network](https://github.com/Kerarty/playble-ads/issues/6)

## Tests

```bash
npm test
```

Unit tests cover the parts that can actually be wrong: merge rules, level
solvability, the fixed-timestep loop, config validation, network detection and
resolution, and the spec checker itself. Game rules live in code that does not
import the renderer, which is why they are testable without a browser.

## License

MIT
