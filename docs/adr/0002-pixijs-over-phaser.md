# 2. PixiJS, not Phaser, and not Unity WebGL

**Status:** accepted

## Context

The demo playable needs a renderer. The size caps decide this before anything
else does:

| Network | Cap |
|---|---|
| Meta | 2 MB (single HTML) |
| Most others | 5 MB |
| Liftoff | 700 KB advised |

Base64 inlining adds roughly a third to every asset, so the engine budget is
tighter than the headline number suggests.

Options considered:

- **Unity WebGL** — 10–20 MB. Fails Meta outright. Unity is the right tool for
  making the game; it is the wrong tool for shipping the ad for it.
- **Godot HTML5** — 8–15 MB, same problem.
- **Phaser 4** — ~1.2–1.5 MB minified, a full engine including physics, input,
  audio and scene management. Leaves about half the Meta budget for art.
- **PixiJS 8** — ~450 KB minified. A renderer, not an engine.
- **Canvas 2D by hand** — smallest, but no batching, no filters, and a lot of
  time spent on things that are not the point of the project.

## Decision

PixiJS 8 for rendering, with the game's own systems written on top: a
fixed-timestep loop, a tween system, pooling, ECS-lite state handling.

Two specific reasons beyond size.

**Sprite batching.** PixiJS batches draw calls, which is what holds 60fps on a
weak GPU with a few hundred objects. Hand-rolled Canvas 2D would not, without
investing in the same problem.

**WebGL explicitly, not WebGPU.** Pixi 8 defaults to WebGPU where available.
WebGPU is not present in the older in-app WebViews that a real slice of playable
traffic comes from, and a unit that renders black in those containers converts at
exactly zero. `preference: 'webgl'` is set deliberately, with a comment saying so.

## Consequences

**Good.** Around 590 KB for the whole playable, including all game logic, which
leaves real room for art and audio. The simulation layer does not import the
renderer at all, so game rules are testable in Node.

**Bad.** Writing loop, tween and pooling systems is real work that Phaser would
have provided, roughly 400 lines here. That work is also the most reviewable part
of the project, so it is not obviously a waste — but it is not free, and it is the
main reason the engine package exists.

The risk this accepts is PixiJS 8 being a young major version. It is contained in
one file, `engine/src/stage.ts`, which is the only module that imports it.
