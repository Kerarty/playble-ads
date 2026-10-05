# Architecture

Four packages, one dependency direction: `core` knows nothing about `adapters`,
`adapters` know nothing about `engine`, and the game knows nothing about any of
them beyond one object it was handed.

```
┌──────────────────────────────────────────────────────┐
│  apps/playable          the game (merge)             │
│  ├─ src/game/     board · scenes · input · script    │
│  └─ src/ui/       copy · CTA · debug                 │
└───────────────┬──────────────────────────────────────┘
                │  one object: Playable
┌───────────────▼──────────────────────────────────────┐
│  @playble/core          no dependencies, no renderer  │
│  runtime · config · emitter · registry · dev guards   │
└───────────────┬──────────────────────────────────────┘
                │  Adapter interface
┌───────────────▼──────────────┐   ┌───────────────────┐
│  @playble/adapters          │   │  @playble/engine   │
│  mraid · meta · google · …  │   │  loop · tweens ·   │
│  one module per network     │   │  pool · quality    │
└─────────────────────────────┘   └───────────────────┘
```

## Why the game never imports a network SDK

A game that calls `mraid.open()` directly cannot be tested outside an AppLovin
container, cannot be reused on Meta, and has to be edited every time a network
changes its API. Routing installs through one function is what makes the same
build shippable to eleven networks and testable on a laptop.

The interface is two methods:

```ts
interface Adapter {
  readonly profile: NetworkProfile;
  detect(env: AdapterEnv): boolean;   // is this network present?
  install(env: AdapterEnv): ExitMethod; // send the user to the store
}
```

Everything else — size caps, safe areas, audio policy — travels as data on
`NetworkProfile`, so adding a network means adding a module, not editing the
runtime.

## Detection is not identification

`AdapterRegistry.resolve()` finds the first adapter whose `detect()` returns
true. That is enough for Meta, Google, Mintegral, TikTok and Pangle, each of
which injects a distinct global.

It is **not** enough for the MRAID networks. AppLovin, Unity, IronSource and
Vungle all expose `mraid` and essentially nothing else; a unit served in any of
them is indistinguishable from the others by feature detection. Two consequences,
both handled explicitly rather than hidden:

- a unit that must be identified precisely is pinned with `config.network`, which
  is also what the simulator and QA deep links use;
- every one of those networks wants `mraid.open()` anyway, so a wrong guess costs
  attribution accuracy and nothing else.

Network names in `NetworkProfile` are the spec table from the publishers, and the
caps are re-checked against the spec checker rather than trusted from memory.

## Why three builds of the game

Meta rejects a playable whose file mentions MRAID anywhere — including a code
path that never executes. `sideEffects: false` and a switch statement are not
enough, because the MRAID adapter still ends up in the module graph.

So the adapter sets are separate modules with separate entry points:

| Entry | Adapters | For |
|---|---|---|
| `index.html` | everything | development, the simulator |
| `meta.html` | Meta, Moloco | Meta uploads |
| `mraid.html` | AppLovin, Unity, IronSource, Vungle | MRAID uploads |

`src/targets/meta.ts` does not import the MRAID module, so the bundler has
nothing to keep, and `tools/spec-check` fails the build if the string ever comes
back. That last part is what makes it a decision rather than an accident.

## The game is split from the renderer

`src/game/board.ts` holds merge rules, grid layout, level definitions and win
conditions. It imports nothing from Pixi and nothing from the DOM. That is why
the rules most likely to be wrong are testable in plain Node, and why "does it
behave the same on a 30Hz phone" is a separate question from "does it look right".

Rendering, input handling, audio and the script live beside it and own their own
problems: pooling and tweening in `scenes.ts`, snap-to-target behaviour in
`input.ts`, autoplay-policy compliance in `audio.ts`.

## The timeline is data

`src/game/script.ts` is a list of beats with timestamps, not a chain of timers:

```ts
{ id: 'cta', at: 11, gate: 'win', action: { type: 'show-cta' } }
```

Three things fall out of that. The simulator can display it, the E2E run can
assert against it, and an A/B variant is a different entry in a list rather than a
forked code path. `director.ts` runs it and knows nothing about the game.

`gate: 'win'` is what keeps the CTA from appearing before the player has felt
anything — the failure mode that converts like an interruption rather than a
reward.

## Frame-rate independence

`engine/src/loop.ts` runs the simulation in fixed 16.67ms steps and renders once
per animation frame with an interpolation alpha. A playable has to behave
identically on a 60Hz and a 30Hz device, otherwise what QA tested is not what
users see.

Two details that only show up under load: catch-up is capped at five steps so a
background-tab stall does not trigger a freeze-and-repeat, and the step
comparison carries an epsilon because `1000/60` does not decompose cleanly into
three float subtractions.

## Adaptive quality

`engine/src/quality.ts` watches the measured frame rate and steps resolution and
particle count down to hold the target, then back up when there is headroom.
Downgrading needs three consecutive bad samples, upgrading needs twelve: a
playable is fifteen seconds long, and a controller that chases every hitch makes
the picture worse rather than better.

## Allocation

Blocks, particles and floating labels come from `Pool`. Steady-state gameplay
allocates nothing, which is not premature optimisation — a GC pause during a merge
animation is a stutter the viewer blames on the ad.

## The dev guard

Playable ads may not make network requests. `core/src/dev.ts` wraps `fetch`,
`XMLHttpRequest`, `Image.src`, `sendBeacon`, `WebSocket` and `EventSource` when
`debug: true`, and reports a violation through the `error` event. A stray `fetch`
would otherwise stay invisible until upload review.

## What is checked, and by what

| Concern | Where |
|---|---|
| Merge rules, level solvability | `board.test.ts` |
| Beat timing, gating, variants | `director.test.ts` |
| Fixed timestep under stall | `loop.test.ts` |
| Config validation and defaults | `config.test.ts` |
| Detection, fallback, forced networks | `registry.test.ts` |
| Size, external requests, MRAID, exit calls | `check.test.ts` |

Not covered by automated tests, and deliberately: whether the creative is any
good, and whether a network's real container behaves like the simulator. Those
need a human and an upload.
