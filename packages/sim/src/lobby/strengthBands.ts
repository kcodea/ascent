import { medalOf, type RankMedal } from '../rank';
import { MAX_SEATS_PER_PLAYER } from './snapshotSeats';

/**
 * MATCHMAKING BANDS BY RANK (owner design 2026-09-30, R-LOBBY-09): "serve for example 0-30 for bronze, 10-40 in
 * silver, 20-65 in gold, and then uncap plat". A band is a range of RUN strength percentiles (1-100, see
 * `boardStrength.ts`); a lobby's recorded seats are drawn uniformly at random from the runs inside it, so the
 * early ranks meet weaker boards and are easier to climb. Every division of a medal shares the medal's band.
 *
 * The upper ranks (owner 2026-09-30: "maybe plat should be 50 and then diamond is like 55 average and ascendant is 60
 * average? i dont want every game to just be insanely sweaty and unwinnable"): Platinum draws from everyone (average
 * ~50), Diamond from 10-100 (average ~55), Ascendant from 20-100 (average ~60). Those only have a FLOOR, so widening
 * lowers the floor by 10 a step. (From 2026-10-03 to 2026-10-06 the bands were retuned for the final-board strength
 * scale -- Gold 15-65, Platinum 15-100, Diamond 25-100, Ascendant 35-100 -- and went back with the weighted strength
 * when the owner reverted it, R-LOBBY-12.)
 *
 * - A run with no strength yet (not scored, not backfilled) is IN every band, so nothing changes until the
 *   scores exist.
 * - When a band cannot fill the table, it widens by `BAND_WIDEN_STEP` on each capped side, step by step, until it
 *   is uncapped; only then do generated seats fill what is left (`bandSteps`).
 * - Unrated modes (Practice, the tutorial) and Platinum have no band.
 *
 * Shaped for a second pool later (owner: "dont worry about the ancients and plat separation just yet"): the band
 * is one input to selection, next to the pool id the server sample takes (`pool_runs_sample(p_pool)`).
 */
export interface StrengthBand { min: number; max: number }

export const STRENGTH_BANDS: Readonly<Record<RankMedal, StrengthBand | null>> = Object.freeze({
  Bronze: { min: 0, max: 30 },
  Silver: { min: 10, max: 40 },
  Gold: { min: 20, max: 65 },
  Platinum: null,
  Diamond: { min: 10, max: 100 },
  Ascendant: { min: 20, max: 100 },
});

/** The band TABLE as a version string, read off `STRENGTH_BANDS` itself (2026-10-03, the Balance Report regime
 *  stamp): `"B0-30 S10-40 G20-65 P* D10-100 A20-100"` today (`*` = an uncapped null band). Any threshold change changes the
 *  string, so a run stamped with it names the exact bands it was matched under, with no version number to forget. */
export const STRENGTH_BANDS_VERSION: string = (Object.entries(STRENGTH_BANDS) as [RankMedal, StrengthBand | null][])
  .map(([medal, b]) => `${medal.charAt(0)}${b ? `${b.min}-${b.max}` : '*'}`)
  .join(' ');

/** Percentile points a band gains on each capped side per widening step. */
export const BAND_WIDEN_STEP = 10;

/** The band for a ladder position (by division index). Null = uncapped. */
export function strengthBandForDivision(divisionIndex: number): StrengthBand | null {
  const b = STRENGTH_BANDS[medalOf(divisionIndex)];
  return b ? { ...b } : null;
}

/** Is a run of this strength inside the band? Unscored (null / undefined) runs are inside every band; a null
 *  band holds everything. */
export function inStrengthBand(strength: number | null | undefined, band: StrengthBand | null): boolean {
  if (!band || typeof strength !== 'number' || !Number.isFinite(strength)) return true;
  return strength >= band.min && strength <= band.max;
}

/** One widening step: each capped side moves `BAND_WIDEN_STEP` outwards. Null once nothing is capped. */
export function widenBand(band: StrengthBand | null): StrengthBand | null {
  if (!band) return null;
  const next = { min: Math.max(0, band.min - BAND_WIDEN_STEP), max: Math.min(100, band.max + BAND_WIDEN_STEP) };
  return next.min <= 0 && next.max >= 100 ? null : next;
}

/** The band and every widening of it, ending with null (uncapped). A null band is just `[null]`. */
export function bandSteps(band: StrengthBand | null): (StrengthBand | null)[] {
  const out: (StrengthBand | null)[] = [band];
  let b = band;
  while (b) { b = widenBand(b); out.push(b); }
  return out;
}

/** Seats a set of runs could fill under the per-player cap (a run with no known owner counts alone). The pool fetch
 *  widens its band until this reaches the table's seven opponent seats. */
export function seatableRuns(owners: readonly (string | null | undefined)[], cap = MAX_SEATS_PER_PLAYER): number {
  const per = new Map<string, number>();
  let loose = 0;
  for (const o of owners) {
    if (!o) { loose++; continue; }
    per.set(o, (per.get(o) ?? 0) + 1);
  }
  let n = loose;
  for (const c of per.values()) n += Math.min(cap, c);
  return n;
}

/** Opponent seats at a table (8 seats, one is the player). */
export const OPPONENT_SEATS = 7;

export const sameBand = (a: StrengthBand | null | undefined, b: StrengthBand | null | undefined): boolean =>
  (a ?? null) === (b ?? null) || (!!a && !!b && a.min === b.min && a.max === b.max);
