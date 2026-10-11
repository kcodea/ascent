import { expectedLoad } from './fxBudget';
import { getDef } from './fxDefs';

/**
 * FAN BUDGETS: a per-def ceiling on how many particles ONE fan-out (one def played on every unit a moment struck)
 * may put on screen in total. Over it, EVERY play of the fan spawns with the same, evenly reduced particle count
 * (the `intensity` axis: burst `count`, emitter/smoke `rate`), so a wide fan stays inside the frame budget and every
 * target still gets the effect.
 *
 * Why not leave it to `fxBudget.admit`'s thinning: that thins on ARRIVAL ORDER. The first plays of a same-frame fan
 * spawn as authored and the last ones are cut to `MIN_PARTICLE_SCALE`, so a 13-wide fan reads as full bursts on the
 * left and wisps on the right, and its floor (0.35 of authored) still leaves a 13-wide fan of a heavy def far over
 * the cap. An even per-play scale keeps the look uniform across the board.
 *
 * A SINGLE target (and any fan whose total fits the budget) plays exactly as authored: the scale is 1, which
 * `scaleDef` treats as an exact no-op.
 *
 * GASKET (owner FX 2026-10-10): `gasket` is ~372 particles a play (two 150-shard bursts + a 150/s smoke over 480 ms).
 * Its Rally hits up to 13 bodies at once (6 friendly non-Demons + 7 enemies), which is ~4,800 particles in one
 * frame, and a Gilded Gasket fires a second pass while the first is still alive. MEASURED on the prod bench build
 * (FX layer time per 4.17 ms tick, a Gilded 13-wide double pass, four runs each): as authored, p99 12-16 ms with
 * 62-74 ticks over 6.25 ms; 1,200 / 1,000 / 800 per pass still spike one tick to 7.5-10 ms when the second pass
 * spawns; 600 never passes 1.8 ms (p99 0.6-0.9 ms). So 600: a single target plays exactly as authored, and a full pass
 * spreads ~600 particles over its 13 targets. See docs/devlog/2026-10-11-gasket-rad-rachel.md.
 */
export const FAN_PARTICLE_BUDGETS: Readonly<Record<string, number>> = {
  gasket: 600,
};

/** PURE: the per-play intensity that keeps `plays` copies of a `perPlay`-particle def inside `budget`. 1 when it
 *  already fits (or there is nothing to scale). */
export function fanIntensity(budget: number | undefined, perPlay: number, plays: number): number {
  if (!budget || !(budget > 0) || !(perPlay > 0) || plays <= 1) return 1;
  return Math.min(1, budget / (perPlay * plays));
}

/** The intensity for a fan of `plays` copies of def `defId`: its {@link FAN_PARTICLE_BUDGETS} entry against the
 *  def's static expected load. 1 for a def with no fan budget. */
export function fanIntensityFor(defId: string, plays: number): number {
  const budget = FAN_PARTICLE_BUDGETS[defId];
  if (!budget || plays <= 1) return 1;
  const def = getDef(defId);
  if (!def) return 1;
  return fanIntensity(budget, expectedLoad(def).particles, plays);
}
