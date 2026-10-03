/**
 * THE BALANCE REPORT'S SOURCE PICKER (2026-10-03; owner "yes fix these issues" on the export audit).
 *
 * The rule: a report field comes from LIVE capture, never from re-simulating a lobby run as an Ascent run
 * (R-REPORT-04). Until 2026-10-03 the upload built `wins`, `tierByWave`, quests and runes by replaying the
 * action log through a plain `createRun` (`reconstructRunTelemetry`), which has no lobby seats and diverges from the
 * first combat: on the 36-row content revision bba0a133, `wins` was wrong on 31 rows and `tierByWave` ran short of or
 * past the live final wave on 32. New rows carry the live values (`RunTelemetry.capture`). Old rows cannot be
 * re-uploaded, so this file picks the BEST SOURCE per field per row, in a fixed order, and says which it used:
 *
 *  · wins: 1. live (`capture` present) · 2. `derived.wins` (the live final state's record) · 3. a count of the live
 *    `derived.combats` · 4. only then the replay.
 *    Older-row caveats: `derived.wins` excluded the first 2 rounds (`calibrationRounds: 2`) until #1589 shipped
 *    (2026-09-21 01:40 UTC), so for rows before that the combat count is used instead, unless the combat rows are
 *    STACKED (before #1641, 2026-09-23 02:56 UTC, a session's observer carried an earlier run's combats into the
 *    next run and the per-wave dedupe then DROPPED the new run's early waves); a row with neither keeps
 *    `derived.wins` and is flagged `winsExcludeCalibration`.
 *  · tierByWave: 1. live (`capture.tierByWave`) · 2. rebuilt from the live derived payload: the end-of-shop board
 *    snapshots' tier (exact for every wave but the last) raised by the taken upgrades, carried forward · 3. only
 *    then the replay. Every series is CLAMPED to the live final wave, which removes the phantom waves a long replay
 *    added to the shop curve; a replay that stops short stays short and is flagged.
 *  · quests and runes: 1. live (`capture.choices`) · 2. the replay, flagged (no live source exists for old rows: the
 *    derived payload records rune and quest CARDS, never the rune or quest ids offered).
 *  · regime: 1. the upload's stamp (`RunTelemetry.regime`) · 2. INFERRED from the build that played the run
 *    (`KNOWN_BUILD_ERAS`, measured with git ancestry) · 3. INFERRED from the row's date against the cut-over merges ·
 *    else unknown. Inferred regimes are labelled so on every surface.
 *
 * Pure over the fetched rows. `applyReportFilters` runs `withBestSources` on every row, so every table, the shop
 * curve and the export read the corrected values, and `runs[].sources` says per row where each came from.
 */
import type { DerivedRun } from './runDerive';
import type { RunRegime, RunTelemetry } from './runTelemetry';
import type { StrengthFormula } from './lobby/boardStrength';
import { segmentByWave, segmentRun } from './reportCohorts';
import type { CohortRow } from './reportCohorts';

// ── Cut-overs ──────────────────────────────────────────────────────────────────────────────────────────────

/** #1589 merged: `calibrationRounds` 2 -> 0, so `derived.wins` counts every round from here on. */
export const CALIBRATION_FIX_AT = '2026-09-21T01:40:51Z';
/** #1641 merged: every new run starts a fresh live observer, so `derived.combats` holds one run from here on. */
export const FRESH_OBSERVER_AT = '2026-09-23T02:56:05Z';
/** #1871 merged: rank matchmaking bands, run strength = the plain average of board percentiles. */
export const BANDS_AT = '2026-09-30T16:53:17Z';
/** #1890 merged: run strength = the round-weighted average (20/35/45). */
export const WEIGHTED_AT = '2026-10-01T13:05:45Z';
/** #1928 merged: run strength = the final board's percentile, and the bands retuned for it. */
export const FINAL_AT = '2026-10-03T15:34:02Z';

/** The band table #1871 shipped (`STRENGTH_BANDS_VERSION` at that commit), and the retune #1928 shipped. */
export const BANDS_V1 = 'B0-30 S10-40 G20-65 P* D10-100 A20-100';
export const BANDS_V2 = 'B0-30 S10-40 G15-65 P15-100 D25-100 A35-100';

/** A matchmaking era. `preBands` = no strength bands at all. */
export type RegimeEra = 'preBands' | 'bandsAverage' | 'bandsWeighted' | 'bandsFinal';

const ERA_REGIME: Record<RegimeEra, { bandsVersion: string | null; strengthFormula: StrengthFormula | null }> = {
  preBands: { bandsVersion: null, strengthFormula: null },
  bandsAverage: { bandsVersion: BANDS_V1, strengthFormula: 'average' },
  bandsWeighted: { bandsVersion: BANDS_V1, strengthFormula: 'weighted' },
  bandsFinal: { bandsVersion: BANDS_V2, strengthFormula: 'final' },
};

/**
 * The builds the live table's rows were played on around the cut-overs, by git ancestry (2026-10-03:
 * `git merge-base --is-ancestor 7828c273a <sha>` for #1871 and `739c43ef6 <sha>` for #1890; none of them contains
 * #1928, 3c23602e3). Most are branch builds,
 * not `main` commits, which is why the row's DATE is not enough: build 842413357 (no bands) uploaded rows a day
 * after the bands merged. A build missing here falls back to the date. Only rows uploaded before the regime stamp
 * shipped need this; a stamped row never reads it, so the table never needs to grow.
 */
export const KNOWN_BUILD_ERAS: Readonly<Record<string, RegimeEra>> = Object.freeze({
  '6248d1c47': 'bandsWeighted',
  '2bc85cc32': 'bandsWeighted',
  'a3f8f2d0c': 'bandsWeighted',
  'e9163d6ea': 'bandsWeighted',
  '38fb7c921': 'bandsAverage',
  '6c4d91c2c': 'bandsAverage',
  'd186965a5': 'bandsAverage',
  'df39ca4bd': 'bandsAverage',
  '842413357': 'preBands',
  '0789bde22': 'preBands',
  '09ba9e87a': 'preBands',
  '34daf5b68': 'preBands',
  '6e2f97c24': 'preBands',
});

/** The client build of a row: the commit after the `+` in its patch (`0.1.0+6248d1c47`), or the whole patch, or
 *  `unknown`. */
export const buildOf = (patch: string | null | undefined): string => {
  if (!patch) return UNKNOWN_BUILD;
  const i = patch.indexOf('+');
  return i >= 0 ? patch.slice(i + 1) || UNKNOWN_BUILD : patch;
};
export const UNKNOWN_BUILD = 'unknown';

// ── Regime ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a row's regime came from. */
export type RegimeBasis = 'stamped' | 'inferredFromBuild' | 'inferredFromDate' | 'unknown';

/** A row's regime with its basis. `key` is the filter value (`regimeKeyOf`). */
export interface ResolvedRegime extends RunRegime { basis: RegimeBasis; key: string }

/** The filter key of a regime: `no bands`, or `<formula> strength, bands <version>`. Band per medal is NOT part of
 *  the key (it is the player's rank, a different axis); it rides in `band` / `bandUsed`. */
export function regimeKeyOf(r: Pick<RunRegime, 'bandsVersion' | 'strengthFormula'>): string {
  if (!r.bandsVersion) return 'no bands';
  return `${r.strengthFormula ?? 'unknown'} strength, bands ${r.bandsVersion}`;
}
/** The key of a row whose regime could not be determined at all. */
export const UNKNOWN_REGIME = 'unknown';

type RegimeRow = Pick<RunTelemetry, 'regime' | 'lobbyPool'> & { patch?: string | null; createdAt?: string | null; derived?: DerivedRun | null };

export function resolveRegime(row: RegimeRow): ResolvedRegime {
  const stamp = row.regime ?? row.derived?.regime;
  if (stamp) return { ...stamp, basis: 'stamped', key: regimeKeyOf(stamp) };
  const pool = row.lobbyPool ?? row.derived?.lobbyPool ?? null;
  const band = { band: pool?.strengthBand ?? null, bandUsed: pool?.strengthBandUsed ?? null };
  const fromBuild = KNOWN_BUILD_ERAS[buildOf(row.patch)];
  if (fromBuild) return { ...ERA_REGIME[fromBuild], ...band, basis: 'inferredFromBuild', key: regimeKeyOf(ERA_REGIME[fromBuild]) };
  const at = row.createdAt ? Date.parse(row.createdAt) : NaN;
  if (Number.isFinite(at)) {
    const era: RegimeEra = at < Date.parse(BANDS_AT) ? 'preBands' : at < Date.parse(WEIGHTED_AT) ? 'bandsAverage' : at < Date.parse(FINAL_AT) ? 'bandsWeighted' : 'bandsFinal';
    return { ...ERA_REGIME[era], ...band, basis: 'inferredFromDate', key: regimeKeyOf(ERA_REGIME[era]) };
  }
  return { bandsVersion: null, strengthFormula: null, ...band, basis: 'unknown', key: UNKNOWN_REGIME };
}

// ── Per-field sources ──────────────────────────────────────────────────────────────────────────────────────

export type WinsSource = 'live' | 'derivedWins' | 'derivedCombats' | 'replay';
export type TierSource = 'live' | 'derived' | 'replay';
export type ChoiceSource = 'live' | 'replay';

/** What is imperfect about an old row, named so it is flagged instead of silently mixed in. */
export type SourceFlag =
  /** `derived.wins` of a row before #1589, kept because its combat rows were stacked: rounds 1-2 are not counted. */
  | 'winsExcludeCalibration'
  /** The derived combat rows carried an earlier run of the session (before #1641); never counted. */
  | 'combatsStacked'
  /** The stored tier series ran past the live final wave (phantom replay waves); trimmed. */
  | 'tierClamped'
  /** Only the replay's tier series was available and it stops before the live final wave. */
  | 'tierShort'
  /** Quests and runes are replay-derived (no live source for this row). */
  | 'choicesReplay'
  /** ...and that replay demonstrably diverged (its stored tier series does not end on the live final wave), so
   *  offers or picks after the divergence may be missing or invented. */
  | 'choicesDiverged';

export interface RowSources {
  wins: WinsSource;
  tierByWave: TierSource;
  choices: ChoiceSource;
  /** The values as uploaded, before any correction. */
  storedWins: number;
  storedTierWaves: number;
  /** The live final wave the series are clamped to (null when the row carries neither a payload nor the stamp). */
  finalWave: number | null;
  flags: SourceFlag[];
}

type SourceRow = CohortRow & { finalWave?: number | null };

/** Combat rows that may hold more than one run. Before #1641 the observer carried an earlier run of the session
 *  into the next, and the per-wave dedupe then DROPPED the new run's early waves, so a stacked combat list can look
 *  perfectly ordered (run A's waves 1-8, then run B's 9-12). It is caught by its own shape (a wave out of order, a
 *  wave past the run's end) or by the payload's other streams, which the same observer stacked at the same time. */
export function combatsStacked(d: Pick<DerivedRun, 'combats' | 'finalWave'> & Partial<DerivedRun>): boolean {
  const c = d.combats ?? [];
  for (let i = 1; i < c.length; i++) if (c[i]!.wave <= c[i - 1]!.wave) return true;
  if (c.length > d.finalWave || c.some((x) => x.wave > d.finalWave)) return true;
  return !!(d.offers && d.acquisitions && d.gold && d.upgrades && d.boards) && segmentRun(d as DerivedRun).stacked;
}

/** The end-of-wave shop tier rebuilt from a live derived payload (last segment): each wave's board snapshot (taken
 *  as the wave closed) raised by the upgrades taken that wave, carried forward, waves 1..finalWave. */
export function tierFromDerived(d: Pick<DerivedRun, 'boards' | 'upgrades' | 'finalWave'>): number[] {
  const boards = segmentByWave(d.boards ?? []);
  const ups = segmentByWave(d.upgrades ?? []).filter((u) => u.taken);
  const boardTier = new Map<number, number>();
  for (const b of boards) boardTier.set(b.wave, Math.max(boardTier.get(b.wave) ?? 0, b.tier));
  const upTier = new Map<number, number>();
  for (const u of ups) upTier.set(u.wave, Math.max(upTier.get(u.wave) ?? 0, u.toTier));
  const out: number[] = [];
  let carry = 1;
  for (let w = 1; w <= d.finalWave; w++) {
    carry = Math.max(carry, boardTier.get(w) ?? 0, upTier.get(w) ?? 0);
    out[w] = carry;
  }
  return out;
}

/** A tier series cut to waves 1..finalWave. */
const clampSeries = (t: number[], finalWave: number): number[] => (t.length - 1 > finalWave ? t.slice(0, finalWave + 1) : t);

/** The best value and its source for each field of one row (see the file comment for the order). */
export function bestSources(row: SourceRow): { wins: number; tierByWave: number[]; sources: RowSources } {
  const d = row.derived && !row.derived.diverged ? row.derived : null;
  const finalWave = d?.finalWave ?? row.finalWave ?? null;
  const storedTier = row.tierByWave ?? [];
  const storedTierWaves = Math.max(0, storedTier.length - 1);
  const flags: SourceFlag[] = [];
  const at = row.createdAt ? Date.parse(row.createdAt) : NaN;

  // WINS
  let wins = row.wins;
  let winsSrc: WinsSource = 'replay';
  if (row.capture) winsSrc = 'live';
  else if (d) {
    const stacked = combatsStacked(d);
    if (stacked) flags.push('combatsStacked');
    const preCalibrationFix = !Number.isFinite(at) || at < Date.parse(CALIBRATION_FIX_AT);
    if (!preCalibrationFix) { wins = d.wins; winsSrc = 'derivedWins'; }
    else if (!stacked) { wins = d.combats.filter((c) => c.result === 'win').length; winsSrc = 'derivedCombats'; }
    else { wins = d.wins; winsSrc = 'derivedWins'; flags.push('winsExcludeCalibration'); }
  }

  // TIER CURVE
  let tierByWave = storedTier;
  let tierSrc: TierSource = 'replay';
  if (row.capture?.tierByWave) tierSrc = 'live';
  else if (d) { tierByWave = tierFromDerived(d); tierSrc = 'derived'; }
  if (finalWave != null) {
    if (tierSrc === 'replay' && storedTierWaves > finalWave) flags.push('tierClamped');
    if (tierSrc === 'replay' && storedTierWaves < finalWave) flags.push('tierShort');
    tierByWave = clampSeries(tierByWave, finalWave);
  }

  // QUESTS + RUNES
  const choicesSrc: ChoiceSource = row.capture?.choices ? 'live' : 'replay';
  if (choicesSrc === 'replay') {
    flags.push('choicesReplay');
    if (finalWave != null && storedTierWaves !== finalWave) flags.push('choicesDiverged');
  }

  return {
    wins, tierByWave,
    sources: { wins: winsSrc, tierByWave: tierSrc, choices: choicesSrc, storedWins: row.wins, storedTierWaves, finalWave, flags },
  };
}

/** The row with its `wins` and `tierByWave` replaced by the best source, and `sources` + `regimeInfo` attached.
 *  Idempotent: a row that already carries `sources` is returned as is. */
export function withBestSources<T extends SourceRow>(row: T): T {
  if (row.sources) return row;
  const best = bestSources(row);
  return { ...row, wins: best.wins, tierByWave: best.tierByWave, sources: best.sources, regimeInfo: resolveRegime(row) };
}

/** Counts per source over a set of rows, for the export's quality block and the panel's banner. */
export interface SourceCounts {
  wins: Record<WinsSource, number>;
  tierByWave: Record<TierSource, number>;
  choices: Record<ChoiceSource, number>;
  regime: Record<RegimeBasis, number>;
  flags: Record<SourceFlag, number>;
}

export function sourceCounts(rows: SourceRow[]): SourceCounts {
  const c: SourceCounts = {
    wins: { live: 0, derivedWins: 0, derivedCombats: 0, replay: 0 },
    tierByWave: { live: 0, derived: 0, replay: 0 },
    choices: { live: 0, replay: 0 },
    regime: { stamped: 0, inferredFromBuild: 0, inferredFromDate: 0, unknown: 0 },
    flags: { winsExcludeCalibration: 0, combatsStacked: 0, tierClamped: 0, tierShort: 0, choicesReplay: 0, choicesDiverged: 0 },
  };
  for (const r of rows) {
    const s = r.sources ?? bestSources(r).sources;
    c.wins[s.wins]++; c.tierByWave[s.tierByWave]++; c.choices[s.choices]++;
    for (const f of s.flags) c.flags[f]++;
    c.regime[(r.regimeInfo ?? resolveRegime(r)).basis]++;
  }
  return c;
}
