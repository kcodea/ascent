/**
 * Deterministic, seeded PRNG. The single source of randomness for the entire
 * engine — shop offers, combat targeting, summons all flow through this.
 *
 * Implementation: mulberry32 (same algorithm proven in the prototype). One
 * 32-bit integer of state; fully reproducible from a numeric seed.
 *
 * `fork()` derives an independent child stream from the parent's current state,
 * so each subsystem (a single combat, an enemy-board build) can be re-run in
 * isolation and reproduce identically. Never use `Math.random` in the engine.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). Returns 0 if maxExclusive <= 0. */
  int(maxExclusive: number): number;
  /** Uniformly pick an element. Caller must ensure the array is non-empty. */
  pick<T>(xs: readonly T[]): T;
  /** A new, independent RNG seeded deterministically from this one's state. */
  fork(): Rng;
  /**
   * Current internal state. Persist this to resume the exact same stream later
   * (`makeRng(rng.state())`) — lets a pure reducer thread RNG through plain,
   * serializable state.
   */
  state(): number;
}

export function makeRng(seed: number): Rng {
  let a = seed | 0;

  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (maxExclusive) => (maxExclusive <= 0 ? 0 : Math.floor(next() * maxExclusive)),
    pick: (xs) => xs[rng.int(xs.length)] as (typeof xs)[number],
    fork: () => makeRng((next() * 4294967296) >>> 0),
    state: () => a,
  };

  return rng;
}
