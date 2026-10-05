# 1. Zero runtime dependencies in `@playble/core`

**Status:** accepted

## Context

`@playble/core` is the part of the runtime that ships inside every playable
unit: network detection, the event API, config validation, the dev guard. It is
the module a reviewer reads first, and it is the module that has to keep working
on the oldest Android WebView in the traffic.

The obvious approach is to pull in a validation library (Zod) and an event
emitter (mitt, eventemitter3). Both are small, well-tested and would save a
little code.

Against that:

- Playable traffic arrives from a wider device range than a normal web product.
  In-app WebViews on budget Androids are still a real share of impressions, and a
  transitive dependency that uses a language feature those engines lack is a
  black screen in a unit nobody is watching.
- The unit is size-capped, and Meta's cap is 2 MB for the whole HTML file.
  Every dependency is bytes competing with art and audio.
- `core` has a genuinely tiny surface. Config validation is one object with ten
  known keys. A general schema library is a large amount of machinery for a
  problem this specific.

## Decision

No runtime dependencies. Validation is hand-written in `src/config.ts` (~60
lines), the event bus is `src/emitter.ts`, and the external-request guard is
`src/dev.ts`.

`@playble/adapters` and `@playble/engine` do depend on things — the adapters
package has no dependencies, the engine depends on PixiJS. The line is drawn at
the core, because that is the package with the widest reach.

## Consequences

**Good.** The whole core is auditable in one sitting, and there is no
transitive dependency to track for CVEs in the shipped artefact. Build output is
deterministic: the same source produces the same bytes.

**Bad, and worth being explicit about.** Hand-written validation can be wrong in
ways a battle-tested library is not. The mitigation is that `config.ts` validates
ten known keys against fixed ranges and nothing else — there is no schema
evolution to get wrong — and the tests assert the failure messages, not just that
it throws. If the config grows into something with nested rules or user-supplied
schemas, this decision should be revisited rather than defended.

Related: [the Meta MRAID constraint](0003-meta-forbids-mraid.md) is what makes
dependency boundaries matter so much here — it turns "this package is imported"
into "this code must not exist in this file".
