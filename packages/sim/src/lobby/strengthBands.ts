import { medalOf, type RankMedal } from '../rank';
import { MAX_SEATS_PER_PLAYER } from './snapshotSeats';

/**
 * MATCHMAKING BANDS BY RANK (owner design 2026-09-30, R-LOBBY-09): "serve for example 0-30 for bronze, 10-40 in
 * silver, 20-65 in gold, and then uncap plat". A band is a range of RUN strength percentiles (1-100, see
 * `boardStrength.ts`); a lobby's recorded seats are drawn uniformly at random from the runs inside it, so the
 * early ranks meet weaker boards and are easier to climb. Every division of a medal shares the medal's band.
 *
 * The upper ranks (owner 2026-09-30: "maybe plat should be 50 and then diamond is like 55 average and ascendant is 60
 * average? i dont want every game to just be insanely sweaty and unwinnable"): Platinum drew from everyone (average
 * ~50), Diamond from 10-100 (average ~55), Ascendant from 20-100 (average ~60). Since the split bands (2026-10-06,
 * "Open from Platinum", below) all three draw from everyone. (From 2026-10-03 to 2026-10-06 the bands were retuned for
 * the final-board strength scale -- Gold 15-65, Platinum 15-100, Diamond 25-100, Ascendant 35-100 -- and went back
 * with the weighted strength when the owner reverted it, R-LOBBY-12.)
 *
 * - A run with no strength yet (not scored, not backfilled) is IN every band, so nothing changes until the
 *   scores exist.
 * - When a band cannot fill the table, it widens by `BAND_WIDEN_STEP` on each capped side, step by step, until it
 *   is uncapped; only then do generated seats fill what is left (`bandSteps`). A floor-only band would widen by
 *   lowering its floor.
 * - Unrated modes (Practice, the tutorial) and Platinum, Diamond and Ascendant have no band.
 *
 * Shaped for a second pool later (owner: "dont worry about the ancients and plat separation just yet"): the band
 * is one input to selection, next to the pool id the server sample takes (`pool_runs_sample(p_pool)`).
 *
 * SPLIT EARLY / LATE BANDS (owner design 2026-10-06, R-LOBBY-13): "perhaps we have multiple ratings like the weighted
 * system / and we lean into those different ratings depending on the rank / and then open it up to anything goes
 * after a certain rank / ... for bronze we should have a near 100% focus on making sure that the early board strength
 * stat is 0-20 or w/e / then silver is like 10-30 with an 80% weight / etc / then gold is 10-50 with 60% weight", then
 * "Blend, then band" and "Open from Platinum". Each band now carries the EARLY weight of the score it filters: a run's
 * score for the medal is `earlyWeight x EARLY + (1 - earlyWeight) x LATE` (`matchScoreOf`, EARLY alone when the run
 * has no round 10+), and the band's min/max apply to that score. Platinum, Diamond and Ascendant have no band.
 * (Before: the bands filtered the weighted run strength directly; Bronze 0-30, Silver 10-40, Gold 20-65, Platinum
 * none, Diamond 10-100, Ascendant 20-100.)
 *
 * OVERALL STRENGTH CAPS (owner 2026-10-09, R-LOBBY-15): "we want to add overall board strength caps on TOP of the
 * existing early rating strength matching. if a boards overall strength is over 40, it should n ever be in bronze. if a
 * boards overall stength is over 60 it should never be in silver. if a boards overall strength is over 75 it should
 * never be in gold. from there, theres no additional cap". A band may also carry `overallCap`: a run whose WEIGHTED
 * strength (`pool_runs.strength`, the "Game strength" number, not the early/late blend) is above it is never seated in
 * that medal's lobby, whatever its match score. Bronze 40, Silver 60, Gold 75; exactly the cap is allowed. The cap is
 * HARD: widening (`widenBand`) moves only min/max and carries the cap along, so the last widening step of a capped band
 * is the cap alone (`{ min: 0, max: 100, overallCap }`), never null. An unscored run stays inside.
 */
export interface StrengthBand {
  min: number;
  max: number;
  /** The EARLY weight, 0..1, of the score this band filters (R-LOBBY-13). Absent = the band filters the run's weighted
   *  strength itself (a band saved before the split, e.g. in an older lobby's `poolAtStart`). */
  earlyWeight?: number;
  /** The OVERALL cap (R-LOBBY-15): a run whose weighted `strength` is above it is outside the band, at every widening
   *  step (the cap never widens). Absent = no cap (Platinum up, and a band saved before 2026-10-09). */
  overallCap?: number;
}

/** A run's ratings as the pool delivers them: the weighted `strength` (R-LOBBY-12, what "Game strength" shows) and the
 *  EARLY / LATE ratings (R-LOBBY-13). Absent / null = not known or not scored. */
export interface RunStrengths { strength?: number | null; early?: number | null; late?: number | null }

const finiteOrNull = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The early weight as whole percent, clamped to 0..100 (so the blend is exact integer arithmetic). */
export const earlyWeightPct = (weight: number): number => Math.min(100, Math.max(0, Math.round(weight * 100)));

/** A run's match score for a rank TIMES 100, in exact integers (see `matchScoreOf`), so a band check never rounds
 *  differently from the SQL's exact numeric. Null = unscored. */
export function matchScore100(run: RunStrengths, weight: number | null | undefined): number | null {
  const strength = finiteOrNull(run.strength);
  if (weight === null || weight === undefined || !Number.isFinite(weight)) return strength === null ? null : strength * 100;
  const early = finiteOrNull(run.early);
  const late = finiteOrNull(run.late);
  const w = earlyWeightPct(weight);
  if (early !== null && late !== null) return w * early + (100 - w) * late;
  if (early !== null) return early * 100;
  if (late !== null) return late * 100;
  return strength === null ? null : strength * 100;
}

/**
 * A run's MATCH SCORE for a rank (owner design 2026-10-06, R-LOBBY-13: "Blend, then band"):
 * `weight x EARLY + (1 - weight) x LATE`. When LATE is null (the run ended before round 10) it is EARLY (and LATE alone
 * when only LATE exists). Without either rating it falls back to the run's weighted `strength` (a run delivered by a
 * server or a cache from before the early/late SQL), and is null when that is missing too: an unscored run, inside
 * every band. With no weight (a band from before R-LOBBY-13) it is the weighted `strength` itself.
 * SQL twin: `pool_match_score` (supabase/migrations/2026-10-06-early-late-strength.sql), parity-tested.
 */
export function matchScoreOf(run: RunStrengths, weight: number | null | undefined): number | null {
  const s = matchScore100(run, weight);
  return s === null ? null : s / 100;
}

export const STRENGTH_BANDS: Readonly<Record<RankMedal, StrengthBand | null>> = Object.freeze({
  Bronze: { min: 0, max: 20, earlyWeight: 1, overallCap: 40 },
  Silver: { min: 10, max: 30, earlyWeight: 0.8, overallCap: 60 },
  Gold: { min: 10, max: 50, earlyWeight: 0.6, overallCap: 75 },
  Platinum: null,
  Diamond: null,
  Ascendant: null,
});

/** One band as a label: `"10-30"`, with the early weight as `/e80` and the overall cap as `/c60` when it has them;
 *  `"*"` = uncapped. */
export const bandVersionLabel = (b: StrengthBand | null | undefined): string =>
  (b ? `${b.min}-${b.max}${typeof b.earlyWeight === 'number' ? `/e${earlyWeightPct(b.earlyWeight)}` : ''}${typeof b.overallCap === 'number' ? `/c${b.overallCap}` : ''}` : '*');

/** The band TABLE as a version string, read off `STRENGTH_BANDS` itself (2026-10-03, the Balance Report regime
 *  stamp): `"B0-20/e100/c40 S10-30/e80/c60 G10-50/e60/c75 P* D* A*"` today (`*` = an uncapped null band, `/eN` = the
 *  early weight in percent, `/cN` = the overall cap, R-LOBBY-15). Any threshold or weight change changes the string, so a run stamped with it names the exact bands it
 *  was matched under, with no version number to forget. */
export const STRENGTH_BANDS_VERSION: string = (Object.entries(STRENGTH_BANDS) as [RankMedal, StrengthBand | null][])
  .map(([medal, b]) => `${medal.charAt(0)}${bandVersionLabel(b)}`)
  .join(' ');

/** Percentile points a band gains on each capped side per widening step. */
export const BAND_WIDEN_STEP = 10;

/** The band for a ladder position (by division index). Null = uncapped. */
export function strengthBandForDivision(divisionIndex: number): StrengthBand | null {
  const b = STRENGTH_BANDS[medalOf(divisionIndex)];
  return b ? { ...b } : null;
}

/** Is a SCORE inside the band? An unscored (null / undefined) score is inside every band; a null band holds
 *  everything. The score must already be the one the band filters (see `runInStrengthBand`). */
export function inStrengthBand(strength: number | null | undefined, band: StrengthBand | null): boolean {
  if (!band || typeof strength !== 'number' || !Number.isFinite(strength)) return true;
  return strength >= band.min && strength <= band.max;
}

/** Is a run's WEIGHTED strength at or under the band's overall cap (R-LOBBY-15)? True without a cap, and for an
 *  unscored run (no `strength`). Exactly the cap is under it ("over 40" is out, 40 is in). SQL twin: the
 *  `p_strength_cap` filter of `pool_runs_sample` (supabase/migrations/2026-10-09-strength-overall-caps.sql). */
export function runUnderOverallCap(run: Pick<RunStrengths, 'strength'>, band: StrengthBand | null | undefined): boolean {
  const cap = band?.overallCap;
  if (typeof cap !== 'number' || !Number.isFinite(cap)) return true;
  const strength = finiteOrNull(run.strength);
  return strength === null || strength <= cap;
}

/** Is a RUN inside the band? Its weighted strength must be at or under the band's overall cap (R-LOBBY-15,
 *  `runUnderOverallCap`), AND its match score for the band's early weight (R-LOBBY-13, `matchScoreOf`) inside min..max,
 *  checked in exact integers (score x 100 against min x 100 .. max x 100, as the SQL's exact numeric does). An
 *  unscored run is inside every band; a null band holds everything. */
export function runInStrengthBand(run: RunStrengths, band: StrengthBand | null): boolean {
  if (!band) return true;
  if (!runUnderOverallCap(run, band)) return false;
  const s = matchScore100(run, band.earlyWeight);
  if (s === null) return true;
  return s >= band.min * 100 && s <= band.max * 100;
}

const hasOverallCap = (b: StrengthBand | null | undefined): boolean => typeof b?.overallCap === 'number';
const scoreBandOpen = (b: StrengthBand): boolean => b.min <= 0 && b.max >= 100;

/** One widening step: each capped side of min..max moves `BAND_WIDEN_STEP` outwards; the early weight and the overall
 *  cap are kept (R-LOBBY-15: the cap NEVER widens). Null once nothing is capped. A band with an overall cap whose
 *  min..max opens fully becomes the cap alone, `{ min: 0, max: 100, overallCap }`, and only THAT widens to null (no
 *  further step: `bandSteps` never lists the null after it, so seat selection and the pool fetch never drop the cap). */
export function widenBand(band: StrengthBand | null): StrengthBand | null {
  if (!band) return null;
  if (scoreBandOpen(band)) return null;
  const next: StrengthBand = { min: Math.max(0, band.min - BAND_WIDEN_STEP), max: Math.min(100, band.max + BAND_WIDEN_STEP) };
  if (typeof band.earlyWeight === 'number') next.earlyWeight = band.earlyWeight;
  if (hasOverallCap(band)) next.overallCap = band.overallCap;
  return scoreBandOpen(next) && !hasOverallCap(next) ? null : next;
}

/** The band and every widening of it. An uncapped band ends with null (anything goes); a band with an overall cap
 *  ends with the cap alone (`{ min: 0, max: 100, overallCap }`, R-LOBBY-15), never null. A null band is `[null]`. */
export function bandSteps(band: StrengthBand | null): (StrengthBand | null)[] {
  const out: (StrengthBand | null)[] = [band];
  let b = band;
  while (b) {
    const next = widenBand(b);
    if (!next && hasOverallCap(b)) break; // the cap alone is the last step: never widened away
    out.push(next);
    b = next;
  }
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
  (a ?? null) === (b ?? null) || (!!a && !!b && a.min === b.min && a.max === b.max && a.earlyWeight === b.earlyWeight && a.overallCap === b.overallCap);
