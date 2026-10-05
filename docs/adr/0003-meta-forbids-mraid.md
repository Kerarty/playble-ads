# 3. Meta forbids MRAID, so the MRAID code must not exist

**Status:** accepted

## Context

Meta's playable spec forbids MRAID — not at runtime, but anywhere in the
delivered file. Other networks require it: AppLovin, Unity, IronSource, Vungle and
Chartboost all expect `mraid.open()`.

So one artefact cannot serve both. The question is how to split it.

## Options

**One bundle, runtime flag.** Build everything, choose the adapter at startup.
Fails: the MRAID adapter is in the file, and the string "mraid" appears in it.
Meta rejects on the file, not on execution.

**One bundle, tree shaking with a constant.** Build with
`PLAYBLE_TARGET=meta` and hope rollup drops the unused branch. Attempted, and it
does not work — a switch on a build-time constant still leaves every branch
reachable to the bundler, and `@playble/adapters`'s index re-exports the MRAID
factory. The Meta bundle still contained the MRAID code. `sideEffects: false`
helped with other tree shaking but not this.

**One entry per target.** Each entry imports only the adapters it needs.

## Decision

Three entries, three bundles:

| Entry | Adapters |
|---|---|
| `index.html` | all — development and the simulator |
| `meta.html` | Meta, Moloco |
| `mraid.html` | AppLovin, Unity, IronSource, Vungle |

`src/targets/meta.ts` does not import the MRAID module at all, so the module
graph has no path to it.

The bundle count is not the important part — the check is. `tools/spec-check`
fails the build if a MRAID call or a read of the `mraid` global appears in a Meta
artefact. That turns this from "we were careful" into "a regression fails CI",
which is the only version of this decision that survives the next person editing
the code.

The check deliberately does **not** flag our own `requiresMraid` profile field,
which appears in every bundle. Flagging it would have made every build fail and
trained us to ignore the output.

## Consequences

**Good.** Each artefact is exactly what one network family accepts. The Meta
bundle is uploadable. The rule is enforced, not remembered.

**Bad.** Three files to build and to keep in step, and the simulator has to pick
the right one per network — running the Meta build inside a MRAID container would
correctly fail to detect a bridge and fall back. That is why
`apps/simulator/src/main.ts` has an explicit build-per-network map.

Three `vite build` invocations instead of one is a build-time cost of a few
seconds, caused by the single-file plugin disabling code splitting, which Vite
does not allow alongside several inputs.
