/**
 * The FX workbench's deterministic randomness.
 *
 * Every particle primitive used to call `Math.random()` directly. That is *correct* — the UI layer is
 * explicitly exempt from the repo's `Math.random` ban, which covers `core`/`content`/`sim` only, and none
 * of this feeds the simulation — but it is hostile to AUTHORING: a tuning can't be held still while you
 * tune around it, the ribbon visibly re-rolled its noise phase on every rebuild, and an A/B between two
 * tunings whose randomness differs isn't a comparison at all. Seeding the primitives fixes all three: the
 * same seed replays the same roll, so a good-looking variant is reproducible and screenshot-able.
 *
 * Algorithm: **mulberry32**, deliberately the same one `packages/core/src/rng.ts` runs — one PRNG in the
 * codebase, not two. This is the bare function form (no `int`/`pick`/`fork`/`state` surface): the
 * primitives only ever want "next uniform float", and a plain closure keeps the per-particle call path
 * allocation-free.
 */

/** A source of uniform values in `[0, 1)` — the shape `Math.random` itself has, so it drops in anywhere. */
export type FxRandom = () => number;

/**
 * A deterministic `[0, 1)` stream from a 32-bit integer seed. The same seed always yields the same
 * sequence; each returned closure carries its own independent state.
 */
export function makeRng(seed: number): FxRandom {
  let a = seed | 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fresh 32-bit seed. Used as the fallback when no seed was supplied (`ctx.seed ?? randomSeed()`), which
 * is what keeps an unseeded instance behaving exactly as it did before seeding existed — a fresh random
 * roll per instance. `Math.random` is fine HERE for the reason in this module's header: the UI layer is
 * exempt from the engine's determinism ban and nothing in the workbench feeds the simulation.
 */
export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
