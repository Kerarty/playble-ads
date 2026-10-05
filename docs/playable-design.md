# Playable design

The creative side: what the numbers say about playable ads, and how
`apps/playable` answers them. This is the part of the project where the
engineering is easy and the decisions are not.

## The shape of a winning playable

Strip a high-performing unit down and the same skeleton is there: a **hook** in
the first seconds, a **loop** of ten to twenty seconds, an **end card**. The
failure modes map onto the beats one to one:

- a hook that explains too much
- a loop harder than the real game
- an end card that arrives before the player felt anything

An analysis of 212 campaigns across 47 studios put the numbers on it. These are
the constraints the demo playable is built against, and each one is visible
somewhere in the code:

| Constraint | Number | Where it shows up |
|---|---|---|
| Interactive within 3 seconds | +67% engagement vs a static intro | Board loads at `at: 0`; no tap-to-start |
| One action, one outcome | 2.8× vs multi-step | Drag a block onto its twin. Tap works too, same gesture |
| Visual feedback under 200ms | +44% re-engagement | `BlockView.press()` scales up on pointerdown |
| CTA within 15 seconds | +34% installs at 15s | CTA beat at `at: 11`, gated on win |
| Portrait | 2.1× completion | Design box is 720×1280 |
| Under 2.5 MB | 47% abandon past 3s load | 593 KB; the cap is enforced per build |

Interaction rate for a simple tap mechanic benchmarks at 18–35%, and around 60%
of interactors finish the round. The simulator's debug overlay shows the local
version of those numbers so the funnel is inspectable during development.

## Why merge

Playables work when the fun is legible in one gesture. Puzzle, merge and casual
mechanics qualify because the core loop *is* the ad; deeper genres have to reduce
themselves to a single satisfying decision or video is the better format.

Merge specifically:

- reads in one gesture, with no instructions;
- has a lot of juice potential per asset — squash, particles, a rising pitch;
- has enough logic to be worth engineering: pools, resolution rules, solvability;
- is a real game, so the playable is not lying to the player. That last one
  matters commercially: a unit that is more fun than the product inflates taps
  and then collapses D1 retention.

## No fail state

There is no lose condition in the first fifteen seconds. A dropped block always
lands — the snap radius is deliberately larger than a cell — and a player who gets
stuck restarts the level rather than seeing a failure screen.

Punishment in an ad costs install intent. The player leaves with a win or with
nothing, never with a "you lost" and a decision to make about it.

## The beat sheet

Roughly 13.5 seconds, and the timings are the ones above rather than taste:

| Time | Beat |
|---|---|
| 0.0–0.8 | Copy hook, board already live and interactive |
| 0.8–2.0 | Tutorial as a moving finger, not text — one gesture, no sentence |
| 2.0–3.5 | First merge: the "yes, this is fun" moment |
| 3.5–7.0 | Three more merges at increasing scale, hints gone |
| 7.0–10.5 | Final merge, celebration |
| 10.5–12.0 | End card, install button pulsing in the lower third |
| 12.0–13.5 | Button keeps pulsing. No countdown, no pressure |

All of it is `src/game/script.ts`, as data.

## Levels as pictures

```ts
{ name: 'warm-up', layout: ['00..', '....', '0...', '....', '....'], goal: 1 }
```

Layouts are chosen rather than random, and the tests enforce two properties that
are easy to break by accident:

- every level starts with an adjacent same-tier pair, so the player always has
  something to do on the first gesture;
- every level is winnable by merging alone, so the outcome does not depend on a
  refill that might not come.

## Two hook variants

The first interaction is the highest-leverage variable in a playable, so there are
two openings and a stated hypothesis for each:

- **A** — "collect the diamond", an instruction. Expected: high interaction rate,
  but the player reads.
- **B** — "one tap", an outcome. Expected: faster engagement, less explanation.

They differ only in the opening beats; the tail is identical, so a difference in
result is attributable to the hook rather than to two different ads.

## Audio

Muted until the first gesture, because mobile autoplay policy requires it and
some in-app WebViews log a violation. The `AudioContext` is not even constructed
before that point.

The merge sound climbs a pitch ladder, so audio tracks progress the way the
visuals do and the last merge before the CTA sounds like a win. One loop, four
effects, mono at a speech-grade bitrate: a phone speaker cannot tell the
difference, and the saved bytes go to art.

TikTok and Pangle are sound-on placements, so their profile sets `defaultAudio:
'on'`.

## What is not automated

Whether this creative is any good. Not the timing, not the mechanic — the idea
that it would install. That needs real impressions against real networks, and a
demo playable has none of those. Everything this project automates is the part
that can be verified locally; the rest is a claim, and `docs/playable-design.md`
is where the claims live rather than being dressed up as results.
