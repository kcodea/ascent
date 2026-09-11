# 2026-09-11 — `beam` FX primitive

A new mesh FX primitive, **`beam`** — a clean, sustained source→target energy beam (grow-in → hold → fade),
the ordered counterpart to `lightning`. Presentation-only (`packages/ui`); authorable in the FX workbench with
the full filter lab. No card is wired to a beam def yet (ships the primitive + workbench authorability, the way
`lightning` shipped before Paragon).

Built subagent-driven from a spec + plan (`docs/superpowers/{specs,plans}/2026-09-11-beam-primitive.*`).

## Shape

- **Geometry** (`fx/beamGeometry.ts`, pure + unit-tested): a single straight quad strip A→B, subdivided along
  its length, endpoints pinned. The travel-reveal coordinate is `uv.u` itself, so — unlike `lightning` — there
  is no separate `aBorn` vertex attribute, no branches, no per-strike regeneration.
- **Primitive** (`fx/primitives/beam.ts`): clones `lightning`'s architecture — pooled shader
  (`acquireShader`/`releaseShader`, prewarmed), two-point anchoring (`setHead`/`setAim`), travel/dwell/release
  phase clock (`travelMs=0` = hold), `FilterStack` + `ContainerTransform`. The shader draws a core→tip gradient
  core + soft glow, a scrolling **flow** band (direction knob), and soft end-caps. Prismatic/neutral defaults so
  every card tints it.

## Knobs beyond the base (owner asks, 2026-09-11)

- **Middle softness** — the mirror of End softness: dims opacity toward the middle of the length, leaving the
  source/target ends bright (`uMidSoft`, a `4·u·(1−u)` centre bump).
- **Arc (bend)** — a signed static bend; the midpoint bows out as a fraction of the beam's *length*, sign picks
  the direction. Distinct from the subtle animated **waver**; both are windowed (`sin πu`) so the ends stay
  pinned.
- **Randomize arc** — re-rolls the arc between **Arc min / Arc max** each cast cycle, seeded from `ctx.seed` so
  a combat replay reproduces the same bends.

## Gotcha logged

Editing a primitive file can't HMR — `registerPrimitive` throws on the duplicate id, which wedges Vite into
serving stale code (no refresh fixes it). Restart the dev server after a primitive edit. (User memory:
`ascent-fx-primitive-edit-needs-server-restart`.)
