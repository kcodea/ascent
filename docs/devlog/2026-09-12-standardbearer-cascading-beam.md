# 2026-09-12 — Standard Bearer's Rally fires a cascading beam

Wired Standard Bearer (`n2_standardbearer`) to the `heavy-beam` def so its Rally buff sends a beam of light to
each minion it empowers, cascading one after another instead of firing the generic green tendril.

## Path

Standard Bearer is mechanically identical to Paragon — `onAttack → onRallyBuffOnePerTribe` — so the buff is
absorbed into the attack wind-up and reaches the player only through `fireBuffCasts`'s source-authored branch
(`sourceBuffDefFor`, PR #1416). Binding `n2_standardbearer.buffWave → heavy-beam` (`fanOut: 'buffed'`) swaps the
beam in for the tendril, same as Paragon → lightning-bolt-blue.

## Two things the cascade needed

1. **Per-target index in the absorbed path.** Per-recipient cascade is driven by `staggerLayers` shifting each
   layer's `at` by `stagger × index`. The un-absorbed `buffWave` cue in `score.ts` already passes `index: i`,
   but the absorbed `fireBuffCasts` source-authored branch fired every beam at `index 0` — so a def stagger did
   nothing. Added a `srcAuthoredIndex` counter that increments per source-authored beam in the (single, batched)
   `fireBuffCasts(windupCasts)` call, and pass it as `playDef`'s `index`. Now the beams fan out one unit at a
   time (heavy-beam ships `stagger: 120` on all three layers).

2. **Workbench: Stagger control was gated to travel-anchored layers.** The per-recipient Stagger slider lived
   inside the `selLayer.anchor === 'travel'` block in `Workbench.tsx`, so the beam layer (travel) had it but the
   emitter/spark layers (source/target anchored) didn't — even though `stagger` is valid on any layer and the
   control's own comment said "shown for every layer". Lifted it out of the travel gate so every layer exposes
   it; a whole multi-layer beam cascades only when each layer carries the same stagger.

## Gotcha (again)

A direct def-JSON edit doesn't reach a running tab without a **full page reload** — `fxDefs.ts` builds its def
registry once from an eager `import.meta.glob` and rebuilds only on a fresh load. The cascade "didn't work"
purely because the tab (churned through a server restart) still held the pre-stagger def; a hard reload fixed
it. See `ascent-fx-primitive-edit-needs-server-restart` for the primitive-module variant.
