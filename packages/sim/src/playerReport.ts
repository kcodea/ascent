/**
 * THE PLAYER BALANCE REPORT, read side (owner ask 2026-09-22): "fix up our balance report. it should only have
 * data for the active set in it, and nothing from scene builder. also make the export export everything so
 * that an ai can analyze all of the data for me at once. Make sure the balance report is extremely thorough
 * and represented well so it's easy to glean insights into overpowered and underpowered units."
 *
 * Everything here is PURE over fetched telemetry rows, so the panel, the export and the tests run the ONE code
 * path: the rows the screen renders are the rows the file carries, filtered by the same function, aggregated
 * by the same functions. Nothing in the UI computes a number the export could disagree with.
 *
 *  · `applyReportFilters` — the data filters (ladder only, active set only) + the counts behind them.
 *  · `placementImpact` — THE ONE placement-delta implementation (round 2, 2026-09-22): a group's placement
 *    stats against a pool that contains it, with the 95% interval and the shrunk impact. Cards, heroes, runes
 *    and shop tiers all feed it; none of them re-implements the math.
 *  · `cardImpact` — the per-card overpowered / underpowered read: per-RUN sample sizes, shop and Discover
 *    conversion, placement and the placement DELTA against the report-wide baseline, with intervals + gates.
 *  · `impactGroups` — the same rows rolled up per tier / per tribe (which tier over- or under-performs).
 *  · `heroImpact` / `runeImpact` / `tierImpact` — the same treatment for heroes (vs every other run), runes
 *    (vs the runs OFFERED the rune that skipped it, the survivorship-controlled baseline) and shop tiers
 *    (runs that reached a tier by its usual wave vs runs that reached it later or never).
 *  · `goldEconomy` — the Gold curve the owner asked for: per round, the Gold a player HAS at the start, SPENDS
 *    (and on what) and LEAVES unspent, for every run and by placement bucket.
 *  · `buildBalanceExport` — the whole dataset as ONE self-describing JSON object (meta + readme + aggregates +
 *    raw rows + derived streams + the id → name dictionaries an AI needs to read it without the codebase).
 *
 * THE HONEST-ASSOCIATIONS PASS (owner audit handoff 2026-09-22): the raw delta arithmetic above is correct and is
 * PRESERVED under honest names (raw buyer association; sample-weighted association; relative raw association
 * within tier), and every table now also carries what `reportCohorts.ts` adds: the exposed-run diagnostic, the
 * opportunity-based adjusted association, Welch intervals on the metric displayed, the unique players behind each
 * side, the evidence label, the data-quality counts, the balance-epoch and date-window scope, and an export
 * schema version (2) so no column is redefined under the old one.
 */
import { CARD_INDEX, RUNE_INDEX, type SetId } from '@game/content';
import { CONFIG } from './config';
import { HEROES } from './heroes';
import { upgradeShape, wilson, SAMPLE_GATES, type DerivedRun, type GoldEvent, type UpgradeWaveRow } from './runDerive';
import { aggregatePlayerReport, type PlayerReport, type RunTelemetry, type TelemetrySource } from './runTelemetry';
import {
  adjustedAssociation, cardCohorts, dataQuality, displayNameKey, epochsOf, evidenceLabel, inScope, sanitizeRows, segmentByWave, tQuantile975,
  tierDecisions, uniquePlayers, usableDerived, validPlacement, welchInterval, ALL_EPOCHS, EPOCH_MIN_RUNS, EVIDENCE_GATES, WELCH_MIN_N,
  type AdjustedStats, type CardCohorts, type CohortCoverage, type CohortRow, type DataQuality, type EpisodeExclusions, type EpochInfo,
  type EvidenceLabel, type ExposedStats, type Interval, type PlayerKeyOf, type ReportScope, type RoleStats, type TierDecisionRow,
} from './reportCohorts';

// ── The fetched row ────────────────────────────────────────────────────────────────────────────────────────

/** One `run_telemetry` row as the Balance Report reads it: the telemetry summary plus the row metadata and,
 *  when the row carries one, its derived payload (joined by id at fetch time so the derived sections and the
 *  export obey the same filters as the flat report — they used to be an unjoinable parallel read). */
export interface RunTelemetryRow extends RunTelemetry {
  /** The `run_telemetry` primary key; null on a fallback select that could not read it. */
  id: number | null;
  createdAt: string | null;
  patch: string | null;
  /** The player's display name at upload. Display-only; the account id is never fetched or exported. */
  author: string | null;
  contentRevision: string | null;
  /** The derived streams (`derived` jsonb) when the row has them; null on a pre-2026-08-05 row or a plainer select. */
  derived: DerivedRun | null;
}

// ── The data filters ───────────────────────────────────────────────────────────────────────────────────────

/** The set a row with NO stamp is read as. Every legacy site in the codebase defaults a missing set to set 1
 *  (`setIdOf`, `poolOf`, `deserialize`); the report follows suit and never substitutes the live set. */
export const LEGACY_SET: SetId = 'set1';

/** The set a telemetry row belongs to — its stamp, or the legacy default when it predates the stamp. */
export const telemetrySetOf = (row: Pick<RunTelemetry, 'setId'>): SetId => row.setId ?? LEGACY_SET;

/** A LADDER row: a lobby run whose source stamp (when present) says ladder. A sandbox / practice / tutorial
 *  stamp excludes the row even when its mode reads lobby — a loaded bug scenario keeps its original mode. */
export const isLadderRow = (row: Pick<RunTelemetry, 'mode' | 'source'>): boolean =>
  row.mode === 'lobby' && (row.source == null || row.source === 'ladder');

export interface ReportFilterCounts {
  /** Rows the fetch returned, before any filter. */
  fetched: number;
  /** Rows that are ladder runs (lobby mode, not stamped as anything else). */
  ladder: number;
  /** Ladder rows in the requested set — what the report renders. */
  inSet: number;
  /** Ladder rows carrying NO set stamp (read as set 1). Surfaced so an empty report explains itself. */
  unstamped: number;
  /** In-set rows that carry a derived payload (the derived sections' sample). */
  withDerived: number;
  /** In-set rows dropped for sharing a row id with an earlier row, and rows whose placement was not an integer
   *  1 to 8 (kept, with the placement cleared so it never counts toward a placement finding). */
  duplicateIds: number;
  placementMalformed: number;
  /** In-set rows inside the balance epoch and date window the report reads (`scopeReport`); equals inSet until
   *  a scope is applied. */
  inScope: number;
}

export interface FilteredReport<T extends RunTelemetryRow> {
  rows: T[];
  counts: ReportFilterCounts;
  /** The filters applied, in plain words, for the export's meta. */
  applied: string[];
}

/** The report's DATA filters: ladder rows only, then the requested set only. The hero / tier / tribe pickers
 *  are VIEW filters layered on top by the panel; the export always carries this whole slice. */
export function applyReportFilters<T extends RunTelemetryRow>(rows: T[], setId: SetId): FilteredReport<T> {
  const ladder = rows.filter(isLadderRow);
  const clean = sanitizeRows(ladder.filter((r) => telemetrySetOf(r) === setId));
  const inSet = clean.rows;
  return {
    rows: inSet,
    counts: {
      fetched: rows.length,
      ladder: ladder.length,
      inSet: inSet.length,
      unstamped: ladder.filter((r) => r.setId == null).length,
      withDerived: inSet.filter((r) => r.derived != null).length,
      duplicateIds: clean.duplicateIds,
      placementMalformed: clean.placementMalformed,
      inScope: inSet.length,
    },
    applied: [
      'ladder runs only: mode is lobby and the source stamp, when present, is ladder (never a Scene Builder sandbox, practice or tutorial run)',
      `set is ${setId}: a row with no set stamp counts as ${LEGACY_SET}, never as the live set`,
      'a row sharing a row id with an earlier row is dropped; a placement that is not an integer 1 to 8 is cleared and never counts as placed',
    ],
  };
}

/** The balance-epoch and date-window scope on top of the set filter (A4 of the honest-associations pass): the
 *  rows of ONE content revision (or every revision when the historical read is chosen explicitly) inside the
 *  window. Never pools older revisions on its own: the caller decides `ALL_EPOCHS`. */
export function scopeReport<T extends RunTelemetryRow>(filtered: FilteredReport<T>, scope: ReportScope): FilteredReport<T> {
  const rows = filtered.rows.filter((r) => inScope(r, scope));
  const epochWords = scope.epoch === ALL_EPOCHS ? 'every content revision (the historical read, chosen explicitly)' : `content revision ${scope.epoch} only`;
  const windowWords = scope.from || scope.to ? `runs dated ${scope.from ?? 'the oldest'} to ${scope.to ?? 'the newest'}` : 'no date window';
  return {
    rows,
    counts: { ...filtered.counts, inScope: rows.length, withDerived: rows.filter((r) => r.derived != null).length },
    applied: [...filtered.applied, `balance epoch: ${epochWords}`, windowWords],
  };
}


// ── Per-card impact ────────────────────────────────────────────────────────────────────────────────────────

/** The sample-size band a card's buyer count falls in, from `SAMPLE_GATES`. `below` = under the preliminary
 *  gate and rendered dimmed: a 1-run number is visibly a 1-run number. */
export type SampleGate = 'below' | 'preliminary' | 'actionable' | 'confident';

export const sampleGateOf = (n: number): SampleGate =>
  n < SAMPLE_GATES.preliminary ? 'below' : n < SAMPLE_GATES.actionable ? 'preliminary' : n < SAMPLE_GATES.confident ? 'actionable' : 'confident';

// ── The one placement-delta implementation ─────────────────────────────────────────────────────────────────

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const pctOf = (n: number, d: number): number | null => (d > 0 ? Math.round((100 * n) / d) : null);
const Z95 = 1.96;

/** A placement pool: the count, sum and sum of squares of the placements of a set of runs. The baseline of a
 *  delta is "the pool minus the group", so a pool must CONTAIN the group it is compared against. */
export interface PlacementPool { n: number; sum: number; sumSq: number }

export const placesPool = (places: Iterable<number>): PlacementPool => {
  const pool: PlacementPool = { n: 0, sum: 0, sumSq: 0 };
  for (const p of places) { pool.n++; pool.sum += p; pool.sumSq += p * p; }
  return pool;
};

/** The pool of every placed run among `rows` (the report-wide baseline the cards and heroes compare against). */
export const placementPool = (rows: Pick<RunTelemetry, 'placement'>[]): PlacementPool =>
  placesPool(rows.filter((r) => r.placement != null).map((r) => r.placement!));

/** A group's placement read against a pool that contains it. Every impact table (cards, heroes, runes, shop
 *  tiers) is this one object plus its own identity and sample columns, so there is exactly one delta, one
 *  interval and one shrinkage in the codebase. Rates are whole percents (null = no denominator); placements
 *  are 1-dp; the delta and its interval are 2-dp. The UI prints these numbers as they are. */
export interface PlacementStats {
  /** Group runs that carry a placement. */
  placedN: number;
  avgPlace: number | null;
  firstRate: number | null;
  top4Rate: number | null;
  lastRate: number | null;
  /** 95% Wilson interval on the top-4 rate, whole percents. */
  top4Ci: { lo: number; hi: number } | null;
  /** The baseline: the pool minus the group, and its mean placement. */
  baselineN: number;
  baselineAvgPlace: number | null;
  /** avgPlace(group) minus avgPlace(baseline). NEGATIVE = the group finishes better than the baseline. */
  delta: number | null;
  /** 95% interval on the delta (pooled-variance normal approximation on the difference of two means). The
   *  original interval, kept for audit continuity. */
  deltaCi: { lo: number; hi: number } | null;
  /** Welch's 95% interval on the same delta (per-group variances, Satterthwaite degrees of freedom, a t
   *  quantile), suppressed under `WELCH_MIN_N` runs on either side. The interval the panel prints. */
  deltaWelch: Interval | null;
  /** The delta SHRUNK toward zero for a small sample: delta × n / (n + preliminary gate), n = placedN. A row
   *  keeps half its delta at 20 placed runs and most of it past 100, so a 2-run outlier can never top the
   *  list. The default sort. Explainable in one sentence, which a t-statistic is not. */
  impact: number | null;
}

/**
 * The group's placements against the pool that contains them. `places` = the placements of the group's placed
 * runs; `pool` = the placements of every run the group is compared with, the group INCLUDED (the baseline is
 * derived by subtraction). The interval needs at least two runs on each side.
 */
export function placementImpact(places: number[], pool: PlacementPool): PlacementStats {
  const n = places.length;
  const sum = places.reduce((s, p) => s + p, 0);
  const sumSq = places.reduce((s, p) => s + p * p, 0);
  const avg = n > 0 ? sum / n : null;
  const otherN = pool.n - n;
  const otherSum = pool.sum - sum;
  const otherAvg = otherN > 0 ? otherSum / otherN : null;
  let delta: number | null = null, deltaCi: { lo: number; hi: number } | null = null, deltaWelch: Interval | null = null, impact: number | null = null;
  if (avg != null && otherAvg != null) {
    delta = avg - otherAvg;
    impact = delta * (n / (n + SAMPLE_GATES.preliminary));
    if (n >= 2 && otherN >= 2) {
      // POOLED sample variance across the two groups (the other group's from the pool minus the group): a
      // two-run group whose both runs placed 1st has a sample variance of zero, and a per-group (Welch)
      // error bar then collapses to nothing for exactly the rows that deserve the widest one.
      const varB = Math.max(0, (sumSq - n * avg * avg) / (n - 1));
      const varO = Math.max(0, ((pool.sumSq - sumSq) - otherN * otherAvg * otherAvg) / (otherN - 1));
      const pooled = ((n - 1) * varB + (otherN - 1) * varO) / (n + otherN - 2);
      const se = Math.sqrt(pooled * (1 / n + 1 / otherN));
      deltaCi = { lo: r2(delta - Z95 * se), hi: r2(delta + Z95 * se) };
      // Welch on the same moments, which is why it is SUPPRESSED under WELCH_MIN_N a side rather than printed
      // collapsed (the honest-associations pass, 2026-09-22).
      if (n >= WELCH_MIN_N && otherN >= WELCH_MIN_N) {
        const vB = varB / n, vO = varO / otherN;
        const se2 = vB + vO;
        if (se2 === 0) deltaWelch = { lo: r2(delta), hi: r2(delta) };
        else {
          const t = tQuantile975((se2 * se2) / ((vB * vB) / (n - 1) + (vO * vO) / (otherN - 1)));
          deltaWelch = { lo: r2(delta - t * Math.sqrt(se2)), hi: r2(delta + t * Math.sqrt(se2)) };
        }
      }
    }
  }
  const top4 = places.filter((p) => p <= 4).length;
  const ci = wilson(top4, n);
  return {
    placedN: n,
    avgPlace: avg == null ? null : r1(avg),
    firstRate: pctOf(places.filter((p) => p === 1).length, n),
    top4Rate: pctOf(top4, n),
    lastRate: pctOf(places.filter((p) => p >= 8).length, n),
    top4Ci: ci ? { lo: Math.round(ci.lo * 100), hi: Math.round(ci.hi * 100) } : null,
    baselineN: otherN,
    baselineAvgPlace: otherAvg == null ? null : r1(otherAvg),
    delta: delta == null ? null : r2(delta),
    deltaCi,
    deltaWelch,
    impact: impact == null ? null : r2(impact),
  };
}

/** Default order of every impact table: impact ascending (the strongest, best-supported advantage first);
 *  rows without one sink, then by name so the order is stable. */
export function sortByImpact<R extends { impact: number | null; name: string }>(rows: R[]): R[] {
  return rows.sort((x, y) => {
    if (x.impact == null && y.impact == null) return x.name.localeCompare(y.name);
    if (x.impact == null) return 1;
    if (y.impact == null) return -1;
    return x.impact - y.impact || x.name.localeCompare(y.name);
  });
}

// ── Per-card impact ────────────────────────────────────────────────────────────────────────────────────────

/** One card's overpowered / underpowered read: the shared placement stats (the baseline = every OTHER placed
 *  run in the report) plus the card's identity, per-run samples and conversion. */
export interface CardImpactRow extends PlacementStats {
  id: string;
  name: string;
  spell: boolean;
  tier: number;
  tribe: string;
  tribe2: string | null;
  /** Runs that saw the card anywhere (shop or Discover) / runs that acquired it anywhere. PER RUN: a card
   *  bought three times in one run is one buyer run. */
  runsSeen: number;
  runsBought: number;
  /** Raw shop sightings and buys (a card seen four times in one run counts four) and their ratio. */
  shopSeen: number;
  shopBought: number;
  shopBuyRate: number | null;
  /** Raw Discover offers and picks and their ratio. */
  discSeen: number;
  discBought: number;
  discRate: number | null;
  /** The delta minus the average delta of the card's TIER (same kind: minions against minions, spells against
   *  spells; weighted by placed buyer runs). A high tier is bought only by runs that lived long enough to reach
   *  it, so a whole tier reads negative; this is the within-tier read that shows who actually stands out. */
  tierDelta: number | null;
  /** Mean wave of acquisition, from the wave-tagged buy events (null pre-migration). */
  avgBuyWave: number | null;
  /** The sample band of runsBought (`SAMPLE_GATES`): a neutral size description, never a verdict. */
  gate: SampleGate;
  /** Buyer runs with NO placement: they support no placement finding and are not in placedN. */
  missingPlacement: number;
  /** The cohort reads (`reportCohorts.ts`): buyers by this run's own streams, the unique players on each side,
   *  the tiers the card was observed at, the exposed diagnostic on both bases, the shop episodes and the
   *  adjusted association, the role read and the evidence label. */
  segmentedBuyers: number;
  buyerPlayers: number | null;
  controlPlayers: number | null;
  observedTiers: number[];
  exposed: ExposedStats;
  exposedFlat: ExposedStats;
  episodes: number;
  episodeBuyers: number;
  episodeExclusions: EpisodeExclusions;
  adjusted: AdjustedStats;
  role: RoleStats;
  evidence: EvidenceLabel;
  evidenceBasis: CardCohorts['evidenceBasis'];
}

/** What `cardImpact` computes beside the rows: the cohort coverage the evidence banner prints. */
export interface CardImpactResult { rows: CardImpactRow[]; coverage: CohortCoverage }

interface ImpactAcc {
  runsSeen: number; runsBought: number;
  shopSeen: number; shopBought: number; discSeen: number; discBought: number;
  places: number[]; buyWaves: number[];
}

/**
 * Per-card impact over the filtered rows. Placement is credited PER RUN (a buyer run counts once however many
 * copies it bought), which is why these numbers can differ from `aggregatePlayerReport`'s per-acquisition
 * `avgPlace`; the panel's legend says so. The baseline for the delta is every other placed run in the same
 * rows, so a card's delta always answers "did the runs that bought it finish better than the runs that
 * did not, in this report".
 */
export function cardImpact(rows: CohortRow[], keyOf: PlayerKeyOf = displayNameKey): CardImpactRow[] {
  return cardImpactWithCoverage(rows, keyOf).rows;
}

export function cardImpactWithCoverage(rows: CohortRow[], keyOf: PlayerKeyOf = displayNameKey): CardImpactResult {
  const cohorts = cardCohorts(rows, keyOf);
  const acc = new Map<string, ImpactAcc>();
  const get = (id: string): ImpactAcc => {
    let a = acc.get(id);
    if (!a) { a = { runsSeen: 0, runsBought: 0, shopSeen: 0, shopBought: 0, discSeen: 0, discBought: 0, places: [], buyWaves: [] }; acc.set(id, a); }
    return a;
  };
  // The report-wide placement pool: every placed run, whatever it bought.
  const pool = placementPool(rows);
  for (const r of rows) {
    for (const id of r.offeredCards) if (CARD_INDEX[id]) get(id).shopSeen++;
    for (const id of r.boughtCards) if (CARD_INDEX[id]) get(id).shopBought++;
    for (const id of r.discoverOfferedCards ?? []) if (CARD_INDEX[id]) get(id).discSeen++;
    for (const id of r.discoverBoughtCards ?? []) if (CARD_INDEX[id]) get(id).discBought++;
    for (const e of r.buyEvents ?? []) if (CARD_INDEX[e.id]) get(e.id).buyWaves.push(e.wave);
    const seen = new Set([...r.offeredCards, ...(r.discoverOfferedCards ?? [])].filter((id) => CARD_INDEX[id]));
    const bought = new Set([...r.boughtCards, ...(r.discoverBoughtCards ?? [])].filter((id) => CARD_INDEX[id]));
    for (const id of seen) get(id).runsSeen++;
    for (const id of bought) {
      const a = get(id);
      a.runsBought++;
      if (r.placement != null) a.places.push(r.placement);
    }
  }
  const out: CardImpactRow[] = [];
  for (const [id, a] of acc) {
    const def = CARD_INDEX[id];
    if (!def) continue;
    const c = cohorts.byCard.get(id) ?? EMPTY_COHORTS;
    const stats = placementImpact(a.places, pool);
    out.push({
      id, name: def.name, spell: !!def.spell, tier: def.tier, tribe: def.tribe, tribe2: def.tribe2 ?? null,
      runsSeen: a.runsSeen, runsBought: a.runsBought,
      shopSeen: a.shopSeen, shopBought: a.shopBought, shopBuyRate: pctOf(a.shopBought, a.shopSeen),
      discSeen: a.discSeen, discBought: a.discBought, discRate: pctOf(a.discBought, a.discSeen),
      ...stats,
      tierDelta: null, // filled below, once every card's delta is known
      avgBuyWave: a.buyWaves.length > 0 ? r1(a.buyWaves.reduce((s, w) => s + w, 0) / a.buyWaves.length) : null,
      gate: sampleGateOf(a.runsBought),
      missingPlacement: a.runsBought - stats.placedN,
      segmentedBuyers: c.segmentedBuyers, buyerPlayers: c.buyerPlayers, controlPlayers: c.controlPlayers, observedTiers: c.observedTiers,
      exposed: c.exposed, exposedFlat: c.exposedFlat,
      episodes: c.episodes, episodeBuyers: c.episodeBuyers, episodeExclusions: c.episodeExclusions,
      adjusted: c.adjusted, role: c.role, evidence: c.evidence, evidenceBasis: c.evidenceBasis,
    });
  }
  // The within-tier read: each card against the placed-buyer-weighted delta of its tier, minions and spells
  // rolled up separately (the panel's tier strip shows the same numbers).
  for (const spell of [false, true]) {
    const tierDeltas = new Map(impactGroups(out.filter((r) => r.spell === spell), 'tier').map((g) => [g.key, g.delta]));
    for (const r of out) {
      if (r.spell !== spell || r.delta == null) continue;
      const g = tierDeltas.get(String(r.tier));
      r.tierDelta = g == null ? null : r2(r.delta - g);
    }
  }
  return { rows: sortByImpact(out), coverage: cohorts.coverage };
}

/** A card the cohorts never saw (no derived payload in the slice): every cohort read empty, never invented. */
const EMPTY_COHORTS: CardCohorts = {
  segmentedBuyers: 0, buyerPlayers: null, controlPlayers: null, observedTiers: [],
  exposed: { buyers: 0, skippers: 0, buyerAvg: null, skipperAvg: null, delta: null, ci: null, notExposedBuyers: 0, buyerPlayers: null, skipperPlayers: null },
  exposedFlat: { buyers: 0, skippers: 0, buyerAvg: null, skipperAvg: null, delta: null, ci: null, notExposedBuyers: 0, buyerPlayers: null, skipperPlayers: null },
  episodes: 0, episodeBuyers: 0, episodeExclusions: { priorAcquisition: 0, sameWaveGrant: 0, unaffordable: 0, neverAffordable: 0 },
  adjusted: adjustedAssociation([]),
  role: { earlyBuyers: 0, midBuyers: 0, lateBuyers: 0, playedPct: null, finalBoardPct: null, soldPct: null, nextCombatWinPct: null, acquisitions: 0 },
  evidence: 'insufficient', evidenceBasis: 'none',
};

/** The default Performance order (B5 of the honest-associations pass): rows whose evidence clears the candidate
 *  gate come first, by their adjusted association (the exposed diagnostic when no adjusted read exists); every
 *  other row sinks alphabetically, visible but never ranked as the worst card. */
export function performanceSortValue(r: Pick<CardImpactRow, 'evidence' | 'evidenceBasis' | 'adjusted' | 'exposed'>): number | null {
  if (r.evidence === 'insufficient') return null;
  return r.evidenceBasis === 'adjusted' ? r.adjusted.association : r.evidenceBasis === 'exposed' ? r.exposed.delta : null;
}

/** A group (a tier, a tribe, a forge) rolled up from its rows. `delta` and `avgPlace` are weighted by each
 *  row's placed runs, so a tier's delta reads "the average buyer of a card in this tier finishes this much
 *  better (negative) or worse (positive) than the field". `cards` = the rows in the group (cards, runes, ...)
 *  and `runsBought` = their summed sample: CARD-BUYER INCIDENCES, not unique runs (a run that bought five cards
 *  of a tier counts five times; a dual-tribe card counts for both tribes). Labelled so on every surface. */
export interface ImpactGroupRow {
  key: string;
  label: string;
  cards: number;
  runsBought: number;
  placedN: number;
  avgPlace: number | null;
  delta: number | null;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The generic roll-up: `keysOf` names the group(s) a row belongs to (a dual-tribe card belongs to two),
 *  `sampleOf` its sample count. Sorted by the order the keys are first seen unless `order` says otherwise. */
export function groupImpact<R extends PlacementStats>(
  rows: R[],
  keysOf: (r: R) => [key: string, label: string][],
  sampleOf: (r: R) => number,
  order: (a: ImpactGroupRow, b: ImpactGroupRow) => number = (a, b) => a.label.localeCompare(b.label),
): ImpactGroupRow[] {
  const groups = new Map<string, { label: string; cards: number; runsBought: number; placedN: number; placeW: number; deltaN: number; deltaW: number }>();
  for (const r of rows) {
    for (const [key, label] of keysOf(r)) {
      let g = groups.get(key);
      if (!g) { g = { label, cards: 0, runsBought: 0, placedN: 0, placeW: 0, deltaN: 0, deltaW: 0 }; groups.set(key, g); }
      g.cards++;
      g.runsBought += sampleOf(r);
      g.placedN += r.placedN;
      if (r.avgPlace != null) g.placeW += r.avgPlace * r.placedN;
      if (r.delta != null) { g.deltaN += r.placedN; g.deltaW += r.delta * r.placedN; }
    }
  }
  const out = [...groups.entries()].map(([key, g]): ImpactGroupRow => ({
    key, label: g.label, cards: g.cards, runsBought: g.runsBought, placedN: g.placedN,
    avgPlace: g.placedN > 0 ? r1(g.placeW / g.placedN) : null,
    delta: g.deltaN > 0 ? r2(g.deltaW / g.deltaN) : null,
  }));
  return out.sort(order);
}

const byNumericKey = (a: ImpactGroupRow, b: ImpactGroupRow): number => Number(a.key) - Number(b.key);

export function impactGroups(rows: CardImpactRow[], by: 'tier' | 'tribe'): ImpactGroupRow[] {
  return by === 'tier'
    ? groupImpact(rows, (r) => [[String(r.tier), `T${r.tier}`]], (r) => r.runsBought, byNumericKey)
    : groupImpact(rows, (r) => (r.tribe2 ? [[r.tribe, cap(r.tribe)], [r.tribe2, cap(r.tribe2)]] : [[r.tribe, cap(r.tribe)]]), (r) => r.runsBought);
}

// ── Heroes ─────────────────────────────────────────────────────────────────────────────────────────────────

/** One hero's read. The baseline is every other placed run (every run has exactly one hero, so this is the
 *  hero against the rest of the field; there is no tier-style adjustment to make). */
export interface HeroImpactRow extends PlacementStats {
  id: string;
  name: string;
  /** Runs that were offered the hero (the picker trio; a pick outside the recorded trio counts as offered). */
  offered: number;
  /** Runs that picked it: the sample. */
  runs: number;
  /** offered as a percent of all runs; runs as a percent of offered. */
  offerRate: number | null;
  pickRate: number | null;
  /** Mean combat rounds won per run with it. */
  avgWins: number | null;
  gate: SampleGate;
  /** The offered-not-chosen comparison (B4 of the honest-associations pass): placed runs whose RECORDED picker
   *  trio offered the hero and that picked another one, their mean placement, and avgPlace minus it (negative =
   *  runs that chose the hero finished better than runs offered it that chose otherwise). Runs with no recorded
   *  trio cannot enter this comparison (`dataQuality.heroOfferMissing`). Within an epoch when one is selected;
   *  pooled across revisions on the historical read. Picking a hero is selected behaviour, not a random
   *  treatment. */
  offeredSkippers: number;
  offeredSkipperAvg: number | null;
  offeredDelta: number | null;
  offeredCi: Interval | null;
  /** Unique players (display-name proxy) among the picker runs and the offered-skipper runs. */
  players: number | null;
  skipperPlayers: number | null;
  /** Evidence for the offered comparison: both sides and the players behind them. */
  evidence: EvidenceLabel;
}

const heroNameOf = (id: string): string => HEROES.find((h) => h.id === id)?.name ?? id;

export function heroImpact(rows: CohortRow[], keyOf: PlayerKeyOf = displayNameKey): HeroImpactRow[] {
  const acc = new Map<string, { offered: number; runs: number; winsSum: number; places: number[]; skipperPlaces: number[]; keys: (string | null)[]; skipperKeys: (string | null)[] }>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) { a = { offered: 0, runs: 0, winsSum: 0, places: [], skipperPlaces: [], keys: [], skipperKeys: [] }; acc.set(id, a); }
    return a;
  };
  const pool = placementPool(rows);
  for (const r of rows) {
    const key = keyOf(r);
    const placed = validPlacement(r.placement) ? r.placement : null;
    for (const id of new Set(r.heroOffer)) {
      get(id).offered++;
      // The offered-not-chosen side: a placed run whose recorded trio offered the hero and that picked another.
      if (id !== r.heroId && placed != null) { get(id).skipperPlaces.push(placed); get(id).skipperKeys.push(key); }
    }
    if (!r.heroOffer.includes(r.heroId)) get(r.heroId).offered++; // a pick outside the recorded trio still counts as offered
    const a = get(r.heroId);
    a.runs++;
    a.winsSum += r.wins;
    if (placed != null) { a.places.push(placed); a.keys.push(key); }
  }
  const out: HeroImpactRow[] = [];
  for (const [id, a] of acc) {
    const stats = placementImpact(a.places, pool);
    const skipAvg = a.skipperPlaces.length ? a.skipperPlaces.reduce((x, y) => x + y, 0) / a.skipperPlaces.length : null;
    const players = uniquePlayers(a.keys), skipperPlayers = uniquePlayers(a.skipperKeys);
    out.push({
      id, name: heroNameOf(id),
      offered: a.offered, runs: a.runs,
      offerRate: pctOf(a.offered, rows.length), pickRate: pctOf(a.runs, a.offered),
      avgWins: a.runs > 0 ? r1(a.winsSum / a.runs) : null,
      ...stats,
      gate: sampleGateOf(a.runs),
      offeredSkippers: a.skipperPlaces.length,
      offeredSkipperAvg: skipAvg == null ? null : r1(skipAvg),
      offeredDelta: stats.avgPlace == null || skipAvg == null ? null : r2(a.places.reduce((x, y) => x + y, 0) / a.places.length - skipAvg),
      offeredCi: welchInterval(a.places, a.skipperPlaces),
      players, skipperPlayers,
      evidence: evidenceLabel(a.places.length, a.skipperPlaces.length, players == null || skipperPlayers == null ? null : Math.min(players, skipperPlayers)),
    });
  }
  return sortByImpact(out);
}

// ── Runes ──────────────────────────────────────────────────────────────────────────────────────────────────

/** One rune's read. The DELTA here is against the runs that were OFFERED the rune and skipped it: a rune is
 *  offered only to runs that survived to its forge (turn 6 for Basic, turn 9 for Epic), so "every other run"
 *  is dragged toward 8th by the early eliminations and every rune reads green. The field delta is carried
 *  beside it under its own name. */
export interface RuneImpactRow extends PlacementStats {
  id: string;
  name: string;
  /** Which forge offers it: the Basic forge (turn 6) or the Epic forge (turn 9). */
  forge: 'basic' | 'epic';
  cost: number | null;
  /** The tribe gate, when the rune has one (most do not). */
  tribes: string[];
  /** Runs that were offered it (deduplicated per run) / runs that took it (the sample). */
  offered: number;
  picked: number;
  pickRate: number | null;
  /** The uncontrolled read: avgPlace(pickers) minus avgPlace(every other placed run), with its interval and
   *  the size of that baseline. */
  fieldDelta: number | null;
  fieldDeltaCi: { lo: number; hi: number } | null;
  fieldBaselineN: number;
  gate: SampleGate;
  /** Unique players (display-name proxy) among the taker runs and the offered-and-skipped runs, and the evidence
   *  label of the taker-vs-skipper comparison. The offers themselves are REPLAY-derived (`offeredRunes` comes
   *  from re-running the action log, which is not guaranteed faithful for a lobby run), so "reached the forge"
   *  is inferred from a recorded offer, not observed live. */
  players: number | null;
  skipperPlayers: number | null;
  evidence: EvidenceLabel;
}

export function runeImpact(rows: CohortRow[], keyOf: PlayerKeyOf = displayNameKey): RuneImpactRow[] {
  const acc = new Map<string, { offered: number; picked: number; places: number[]; offeredPlaces: number[]; keys: (string | null)[]; skipperKeys: (string | null)[] }>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) { a = { offered: 0, picked: 0, places: [], offeredPlaces: [], keys: [], skipperKeys: [] }; acc.set(id, a); }
    return a;
  };
  const pool = placementPool(rows);
  for (const r of rows) {
    const key = keyOf(r);
    const placed = validPlacement(r.placement) ? r.placement : null;
    const picked = new Set(r.pickedRunes);
    const offered = new Set([...r.offeredRunes, ...r.pickedRunes]); // a pick outside the recorded offers still counts as offered
    for (const id of offered) {
      const a = get(id);
      a.offered++;
      if (placed != null) { a.offeredPlaces.push(placed); if (!picked.has(id)) a.skipperKeys.push(key); }
    }
    for (const id of picked) {
      const a = get(id);
      a.picked++;
      if (placed != null) { a.places.push(placed); a.keys.push(key); }
    }
  }
  const out: RuneImpactRow[] = [];
  for (const [id, a] of acc) {
    const def = RUNE_INDEX[id];
    const field = placementImpact(a.places, pool);
    const stats = placementImpact(a.places, placesPool(a.offeredPlaces));
    const players = uniquePlayers(a.keys), skipperPlayers = uniquePlayers(a.skipperKeys);
    out.push({
      id, name: def?.name ?? id,
      forge: def?.epic ? 'epic' : 'basic', cost: def ? def.cost : null, tribes: [...(def?.tribes ?? [])],
      offered: a.offered, picked: a.picked, pickRate: pctOf(a.picked, a.offered),
      ...stats,
      fieldDelta: field.delta, fieldDeltaCi: field.deltaCi, fieldBaselineN: field.baselineN,
      gate: sampleGateOf(a.picked),
      players, skipperPlayers,
      evidence: evidenceLabel(stats.placedN, stats.baselineN, players == null || skipperPlayers == null ? null : Math.min(players, skipperPlayers)),
    });
  }
  return sortByImpact(out);
}

/** The rune rows rolled up per forge (Basic / Epic), the runes' analogue of the tier strip. */
export const runeGroups = (rows: RuneImpactRow[]): ImpactGroupRow[] =>
  groupImpact(rows, (r) => [[r.forge, r.forge === 'epic' ? 'Epic forge' : 'Basic forge']], (r) => r.picked, (a, b) => (a.key === 'basic' ? -1 : 1) - (b.key === 'basic' ? -1 : 1));

// ── Shop tiers ─────────────────────────────────────────────────────────────────────────────────────────────

/** One shop tier's read, T2 to T7, from the flat `tierByWave`. The shared placement stats are the EARLY group:
 *  runs that reached the tier by its cut wave (the mean wave runs reach it, rounded) against every other placed
 *  run (runs that reached it later or never). That is the early-vs-late question. "Reached it at all" against
 *  "never reached it" is carried as `reachedDelta`, but it reads green for every tier because the never-reached
 *  group is the runs that were eliminated early.
 *  CAVEAT (honest-associations pass): `tierByWave` is REPLAY-derived (a lobby replay without the lobby seats)
 *  and disagreed with the live wave count on 91 of 110 rows on 2026-09-22 (`dataQuality.replayDisagree`). The
 *  decision-based read is `tierDecisions` in reportCohorts.ts, from the live derived upgrade rows. */
export interface TierImpactRow extends PlacementStats {
  tier: number;
  name: string;
  /** Runs that ever reached the tier, as a count and a percent of all runs, and the mean wave they did. */
  runsReached: number;
  reachRate: number | null;
  avgWaveReached: number | null;
  /** Placement of every run that reached the tier, and its delta against runs that never did. */
  reachedPlacedN: number;
  reachedAvgPlace: number | null;
  reachedDelta: number | null;
  /** The cut wave: round(avgWaveReached). Null when no run reached the tier. */
  cutWave: number | null;
  /** Runs that reached the tier by the cut wave (the early group's sample, placed or not). */
  earlyRuns: number;
  gate: SampleGate;
}

/** The first wave a run's shop was at or above `tier`, or null when it never got there. */
export function waveReached(tierByWave: number[] | undefined, tier: number): number | null {
  const t = tierByWave ?? [];
  for (let w = 1; w < t.length; w++) if (t[w] != null && t[w]! >= tier) return w;
  return null;
}

export const MAX_SHOP_TIER = 7;

export function tierImpact(rows: RunTelemetry[]): TierImpactRow[] {
  const pool = placementPool(rows);
  const out: TierImpactRow[] = [];
  for (let tier = 2; tier <= MAX_SHOP_TIER; tier++) {
    const reached = rows.map((r) => ({ r, w: waveReached(r.tierByWave, tier) })).filter((x): x is { r: RunTelemetry; w: number } => x.w != null);
    const avgWave = reached.length > 0 ? reached.reduce((s, x) => s + x.w, 0) / reached.length : null;
    const cut = avgWave == null ? null : Math.round(avgWave);
    const early = cut == null ? [] : reached.filter((x) => x.w <= cut);
    const reachedStats = placementImpact(reached.filter((x) => x.r.placement != null).map((x) => x.r.placement!), pool);
    out.push({
      tier, name: `T${tier}`,
      runsReached: reached.length, reachRate: pctOf(reached.length, rows.length),
      avgWaveReached: avgWave == null ? null : r1(avgWave),
      reachedPlacedN: reachedStats.placedN, reachedAvgPlace: reachedStats.avgPlace, reachedDelta: reachedStats.delta,
      cutWave: cut, earlyRuns: early.length,
      ...placementImpact(early.filter((x) => x.r.placement != null).map((x) => x.r.placement!), pool),
      gate: sampleGateOf(early.length),
    });
  }
  return out;
}

// ── The Gold economy ───────────────────────────────────────────────────────────────────────────────────────

/** The spend split the economy table shows. `other` folds the ledger's ruby, henchman and other categories,
 *  which no live run has used. */
export type SpendCategory = 'minion' | 'spell' | 'upgrade' | 'refresh' | 'rune' | 'heroPower' | 'other';
export const SPEND_CATEGORIES: SpendCategory[] = ['minion', 'spell', 'upgrade', 'refresh', 'rune', 'heroPower', 'other'];

/** The placement buckets the economy is cut by. `all` = every run with a derived ledger (placed or not);
 *  the other three need a placement. */
export type EconomyBucket = 'all' | 'first' | 'top4' | 'bottom4';
export const ECONOMY_BUCKETS: EconomyBucket[] = ['all', 'first', 'top4', 'bottom4'];

/** One round of the Gold curve, averaged over the runs of a bucket that played the round. Every figure is
 *  mean Gold per run, 1-dp. goldStart + income + sold = spent + unspent for every run. */
export interface EconomyWaveRow {
  wave: number;
  /** Runs of the bucket whose ledger reached this round (the divisor of every average): a run counts for every
   *  round up to its last wave, whether or not Gold moved that round. */
  runs: number;
  /** Runs of the bucket with at least one Gold movement logged this round. Not the divisor; stated because
   *  "runs with a logged Gold movement on round N" and "runs alive at round N" are different denominators. */
  moved: number;
  /** Gold at the start of the round, after the refill. */
  goldStart: number;
  /** Gold that came in DURING the round (card payouts, hero effects), not the refill. */
  income: number;
  /** Gold recovered by selling during the round. */
  sold: number;
  /** Gold spent during the round, all categories. */
  spent: number;
  /** Gold left when the round ended. It is not carried over: the next round refills to the cap, so this is lost. */
  unspent: number;
  /** spent as a whole percent of goldStart + income + sold (null when nothing was available). */
  spentPct: number | null;
  /** Where the spent Gold went: mean Gold per run per category. */
  split: Record<SpendCategory, number>;
}

export interface GoldEconomy {
  /** Runs in each bucket. */
  runs: Record<EconomyBucket, number>;
  /** One row per round, per bucket, waves ascending. */
  waves: Record<EconomyBucket, EconomyWaveRow[]>;
  /** Ledgers left out: partial (diverged) ones, and ones that did not open on the game's starting Gold (a dev
   *  build's cheat Gold; the live table carried seven at 999). */
  skipped: number;
}

interface WaveLedger { wave: number; goldStart: number; income: number; sold: number; unspent: number; split: Record<SpendCategory, number>; events: number }

const spendCategoryOf = (c: GoldEvent['category']): SpendCategory =>
  c === 'minion' || c === 'spell' || c === 'upgrade' || c === 'refresh' || c === 'rune' || c === 'heroPower' ? c : 'other';

/** The events of the run the row was uploaded for. A live ledger can carry EARLIER runs of the same session
 *  in front of its own (53 of the 114 live payloads did on 2026-09-22: the wave number drops back to 1 where
 *  the next run began, and the last segment is the one whose final wave matches `finalWave`). The uploaded
 *  run is the segment after the last drop. */
export const ledgerSegment = (gold: GoldEvent[]): GoldEvent[] => segmentByWave(gold);

/**
 * One run's ledger folded into rounds. How the ledger records a round (see `observeAction` in runDerive):
 * every event is stamped with the wave the ACTION happened on, so the per-turn refill, which happens inside the
 * action that advances the wave, is the LAST event of the wave it closes: an `income` whose `goldAfter` is the
 * next round's opening Gold, or a negative `other` when the round closed holding more Gold than the next cap
 * (the refill SETS Gold to the cap, so the surplus is lost, not spent). Wave 1 opens on `CONFIG.startEmbers`
 * with no event. A round with no event at all
 * (nothing bought, nothing sold, and the refill happened to change nothing) carries the previous opening Gold.
 */
export function runLedger(d: DerivedRun): WaveLedger[] {
  const byWave = new Map<number, GoldEvent[]>();
  let lastWave = d.finalWave;
  for (const g of ledgerSegment(d.gold)) {
    (byWave.get(g.wave) ?? byWave.set(g.wave, []).get(g.wave)!).push(g);
    if (g.wave > lastWave) lastWave = g.wave;
  }
  const out: WaveLedger[] = [];
  let carry = CONFIG.startEmbers;
  for (let wave = 1; wave <= lastWave; wave++) {
    const evs = byWave.get(wave) ?? [];
    // The opening Gold: the Gold before the round's first movement, or the carried refill when nothing moved.
    const goldStart = evs.length > 0 ? evs[0]!.goldAfter - evs[0]!.amount : carry;
    // The refill closes every round but the last: the last event of the round. It is an income when the round
    // closed under the next cap, and a negative `other` (the wave advance is the only action categorise sends
    // there) when the round closed holding MORE Gold than the cap refills to; both are the refill, never a spend.
    const last = evs[evs.length - 1];
    const refill = wave < lastWave && last && ((last.category === 'income' && last.amount > 0) || (last.category === 'other' && last.amount < 0)) ? last : null;
    const split = Object.fromEntries(SPEND_CATEGORIES.map((c) => [c, 0])) as Record<SpendCategory, number>;
    let income = 0, sold = 0;
    for (const g of evs) {
      if (g === refill) continue;
      if (g.amount < 0) split[spendCategoryOf(g.category)] += -g.amount;
      else if (g.category === 'sell') sold += g.amount;
      else income += g.amount;
    }
    const unspent = refill ? refill.goldAfter - refill.amount : last ? last.goldAfter : goldStart;
    out.push({ wave, goldStart, income, sold, unspent, split, events: evs.length });
    carry = refill ? refill.goldAfter : unspent;
  }
  return out;
}

const bucketsOf = (placement: number | null | undefined): EconomyBucket[] => {
  const b: EconomyBucket[] = ['all'];
  if (placement == null) return b;
  if (placement === 1) b.push('first');
  b.push(placement <= 4 ? 'top4' : 'bottom4');
  return b;
};

/**
 * The Gold curve over the runs that carry a derived ledger (a diverged ledger is skipped, like every derived
 * table). Takes the flat rows, because a `DerivedRun` carries no placement: the buckets need `row.placement`.
 */
export function goldEconomy(rows: { derived: DerivedRun | null; placement?: number }[]): GoldEconomy {
  type Acc = { runs: number; moved: number; goldStart: number; income: number; sold: number; unspent: number; split: Record<SpendCategory, number> };
  const acc: Record<EconomyBucket, Map<number, Acc>> = { all: new Map(), first: new Map(), top4: new Map(), bottom4: new Map() };
  const runs: Record<EconomyBucket, number> = { all: 0, first: 0, top4: 0, bottom4: 0 };
  let skipped = 0;
  for (const row of rows) {
    const d = row.derived;
    if (!d) continue;
    if (d.diverged) { skipped++; continue; }
    const ledger = runLedger(d);
    // A run that did not open on the game's starting Gold was played with a dev build's cheat Gold; its curve
    // says nothing about the game's economy.
    if (ledger.length > 0 && ledger[0]!.goldStart !== CONFIG.startEmbers) { skipped++; continue; }
    for (const b of bucketsOf(row.placement)) {
      runs[b]++;
      for (const w of ledger) {
        let a = acc[b].get(w.wave);
        if (!a) { a = { runs: 0, moved: 0, goldStart: 0, income: 0, sold: 0, unspent: 0, split: Object.fromEntries(SPEND_CATEGORIES.map((c) => [c, 0])) as Record<SpendCategory, number> }; acc[b].set(w.wave, a); }
        a.runs++;
        if (w.events > 0) a.moved++;
        a.goldStart += w.goldStart; a.income += w.income; a.sold += w.sold; a.unspent += w.unspent;
        for (const c of SPEND_CATEGORIES) a.split[c] += w.split[c];
      }
    }
  }
  const waves = {} as Record<EconomyBucket, EconomyWaveRow[]>;
  for (const b of ECONOMY_BUCKETS) {
    waves[b] = [...acc[b].entries()].sort((x, y) => x[0] - y[0]).map(([wave, a]): EconomyWaveRow => {
      const spentTotal = SPEND_CATEGORIES.reduce((s, c) => s + a.split[c], 0);
      const available = a.goldStart + a.income + a.sold;
      return {
        wave, runs: a.runs, moved: a.moved,
        goldStart: r1(a.goldStart / a.runs), income: r1(a.income / a.runs), sold: r1(a.sold / a.runs),
        spent: r1(spentTotal / a.runs), unspent: r1(a.unspent / a.runs),
        spentPct: available > 0 ? Math.round((100 * spentTotal) / available) : null,
        split: Object.fromEntries(SPEND_CATEGORIES.map((c) => [c, r1(a.split[c] / a.runs)])) as Record<SpendCategory, number>,
      };
    });
  }
  return { runs, waves, skipped };
}

// ── The export ─────────────────────────────────────────────────────────────────────────────────────────────

/** A raw run as the export carries it: the fetched row with `derived` lifted out (it lives under `derived`,
 *  keyed by `rowId`) and the set resolved beside its raw stamp. */
export interface ExportedRun {
  id: number | null;
  createdAt: string | null;
  patch: string | null;
  /** A per-file alias ("player 1", "player 2", ...) for the run's display name, so unique-player counts can be
   *  re-derived without a name in the file. Null when the row carries no name. See `playerAliases`. */
  player: string | null;
  contentRevision: string | null;
  /** The set the report READ the run as (the stamp, or set1 when unstamped). */
  set: SetId;
  /** The raw stamps as stored: null on rows written before 2026-09-22. */
  setId: SetId | null;
  source: TelemetrySource | null;
  mode: string | null;
  heroId: string;
  heroOffer: string[];
  won: boolean;
  wins: number;
  placement: number | null;
  offeredQuests: string[];
  pickedQuests: string[];
  questTurns: Record<string, number>;
  offeredRunes: string[];
  pickedRunes: string[];
  offeredCards: string[];
  boughtCards: string[];
  discoverOfferedCards: string[];
  discoverBoughtCards: string[];
  tierByWave: number[];
  buyEvents: { id: string; wave: number; src: 'shop' | 'discover' }[];
}

/** The export schema version. Bumped to 2 by the honest-associations pass (2026-09-22): every column of
 *  version 1 keeps its formula and its name; version 2 ADDS the cohort columns, the Welch intervals, the
 *  evidence labels, the scope and the quality / fetch / coverage meta. A column is never redefined under a
 *  version that already shipped. */
export const EXPORT_SCHEMA_VERSION = 2;

/** How much of the eligible data the fetch actually read (A5): the caps, the pages, and what they dropped. The
 *  panel fills it from the fetch results; a file whose `flatTruncated` is true is bounded, never "all". */
export interface FetchCoverage {
  flatCap: number;
  flatPageSize: number;
  flatFetched: number;
  flatTruncated: boolean;
  derivedCap: number;
  derivedRequested: number;
  derivedFetched: number;
  /** Requested ids whose payload did not come back (missing, malformed or timed out). */
  derivedDropped: number;
}

export interface BalanceExportMeta {
  schemaVersion: number;
  generatedAt: string;
  appVersion: string;
  activeSet: { id: SetId; name: string };
  /** The content revision of the BUILD that produced the file (each run carries its own). */
  contentRevision: string;
  patches: string[];
  dateRange: { oldest: string | null; newest: string | null };
  counts: ReportFilterCounts & { exportedRuns: number; exportedDerived: number; heroes: number };
  filters: string[];
  sampleGates: typeof SAMPLE_GATES;
  /** The balance epoch and date window the file reads, with the revisions it actually contains. */
  scope: ReportScope & { epochRuns: number; revisionsIncluded: string[] };
  /** Every epoch in the set slice BEFORE the scope, newest first, so a reader can see what was left out. */
  epochs: EpochInfo[];
  quality: DataQuality;
  fetch: FetchCoverage;
  coverage: CohortCoverage;
  /** How unique players are counted, and what a trusted key would need. */
  playerKey: { basis: 'displayName'; note: string };
  /** The sensitivity toggle: the runs of the most prolific player left out (0 when the toggle is off). */
  excludedProlificRuns: number;
  thresholds: { welchMinN: number; evidenceGates: typeof EVIDENCE_GATES; epochMinRuns: number; roundBands: string; goldBands: string };
  /** Per-metric exclusions in plain words, with counts, so a reader knows which rows fed which table. */
  exclusions: Record<string, string>;
}

export interface BalanceExport {
  meta: BalanceExportMeta;
  readme: Record<string, string | Record<string, string>>;
  aggregates: {
    report: PlayerReport;
    impact: { minions: CardImpactRow[]; spells: CardImpactRow[] };
    byTier: { minions: ImpactGroupRow[]; spells: ImpactGroupRow[] };
    byTribe: { minions: ImpactGroupRow[]; spells: ImpactGroupRow[] };
    heroImpact: HeroImpactRow[];
    runeImpact: RuneImpactRow[];
    byForge: ImpactGroupRow[];
    tierImpact: TierImpactRow[];
    tierDecisions: TierDecisionRow[];
    economy: GoldEconomy;
    upgrades: UpgradeWaveRow[];
  };
  cards: Record<string, { name: string; tier: number; tribe: string; tribe2: string | null; spell: boolean; token: boolean }>;
  heroes: Record<string, string>;
  runes: Record<string, string>;
  runs: ExportedRun[];
  derived: (DerivedRun & { rowId: number | null })[];
}

/** Per-file player aliases: each distinct display name among `rows` becomes "player 1", "player 2", ... in order
 *  of first appearance, and a row with no name stays null. The aliases preserve every unique-player count the
 *  tables print while no display name leaves the report (the handoff: never send display names into an
 *  analytical export to make a player key). Stable only within the one file: a different scope renumbers. */
export function playerAliases(rows: readonly Pick<RunTelemetryRow, 'author'>[]): Map<string, string> {
  const alias = new Map<string, string>();
  for (const r of rows) if (r.author != null && !alias.has(r.author)) alias.set(r.author, `player ${alias.size + 1}`);
  return alias;
}

export function toExportedRun(r: RunTelemetryRow, player: string | null): ExportedRun {
  return {
    id: r.id, createdAt: r.createdAt, patch: r.patch, player, contentRevision: r.contentRevision,
    set: telemetrySetOf(r), setId: r.setId ?? null, source: r.source ?? null, mode: r.mode ?? null,
    heroId: r.heroId, heroOffer: r.heroOffer, won: r.won, wins: r.wins, placement: r.placement ?? null,
    offeredQuests: r.offeredQuests, pickedQuests: r.pickedQuests, questTurns: r.questTurns,
    offeredRunes: r.offeredRunes, pickedRunes: r.pickedRunes,
    offeredCards: r.offeredCards, boughtCards: r.boughtCards,
    discoverOfferedCards: r.discoverOfferedCards ?? [], discoverBoughtCards: r.discoverBoughtCards ?? [],
    tierByWave: r.tierByWave, buyEvents: r.buyEvents ?? [],
  };
}

const PLACEMENT_COLS = 'placedN = group runs with a placement (placed buyers); avgPlace = their mean placement (1 best, 8 worst); firstRate / top4Rate / lastRate = percent of them finishing 1st, in the top 4, 8th; top4Ci = 95% Wilson interval on top4Rate; baselineN / baselineAvgPlace = the placed runs on the other side of the comparison (placed controls) and their mean placement; delta = avgPlace minus baselineAvgPlace, the RAW association (negative = the group finished better than its baseline among the runs observed, which is not a guaranteed benefit from the choice); deltaCi = the version-1 95% interval (pooled-variance normal approximation, kept for audit continuity); deltaWelch = Welch 95% interval on the same delta (per-group variances, Satterthwaite degrees of freedom, t quantile), null under 5 runs a side; impact = the SAMPLE-WEIGHTED association, delta times placedN / (placedN + 20), a heuristic shrinkage toward zero for a thin sample (half the delta at 20 placed runs)';

/** The plain-language key: every top-level key and every column, written INTO the file so a reader with no
 *  access to the codebase can interpret it. Kept as data so the tests can check it covers every key. */
export function exportReadme(): BalanceExport['readme'] {
  return {
    about: 'ASCENT balance export, schema version 2. ASCENT is an auto-battler: a shop phase (buy minions and spells, upgrade the shop tier) alternates with auto-resolved combats inside an eight-seat elimination lobby. A run ends with a placement from 1 (won the lobby) to 8 (first out). Lower placement is better. This file holds the ladder runs of one card set inside one balance epoch and date window (see meta.scope): the aggregate tables the in-game Balance Report shows, the raw per-run telemetry those tables are computed from, and the derived event streams per run. The aggregates are computed from exactly the runs in `runs`, so any number here can be re-derived from the raw data. Every comparison in the file is OBSERVATIONAL: an association between a choice and the final placement among the runs observed, never a measured contribution of the card, hero, rune or tier to winning.',
    readme: 'This key: a plain-language description of every top-level key and every column in the file.',
    howToRead: 'Start with meta: the scope (which content revision, which dates), the quality counts, the fetch coverage and the exclusions say what the tables can and cannot support. Then aggregates.impact.minions and .spells, one row per card. Three comparisons sit side by side and each answers a different question. delta is the RAW BUYER ASSOCIATION: buyer runs against every other run, so a run eliminated on wave 4 counts against a wave-12 card it never saw; survival and card access read as card strength here, and most cards read negative for that reason. exposed is the EXPOSED DIAGNOSTIC: buyers against the runs that saw the card and passed. adjusted is the ADJUSTED ASSOCIATION: buy against pass inside the first affordable shop offer, among runs in the same round band and shop tier; its association is null when no comparable skippers exist, which is a valid answer (insufficient comparable data), not zero and not a worst card. Read evidence before any number: insufficient, candidate for review, or supported association, from both group sizes and the unique players behind them; none of them means confirmed overpowered. Read the Welch intervals of the metric you are looking at, never a raw interval on an adjusted number. No bootstrap and no multiple-comparison screening is run on this file (Stage C of the analytics correction is deferred): both need many independent players, and over the handful behind these runs they would manufacture confidence, so each 95% range stands alone and an interval that excludes zero is not a screened discovery. heroImpact, runeImpact, tierImpact and tierDecisions carry the same discipline for heroes (chosen against offered-not-chosen), runes (takers against runs offered the rune that skipped it), and shop tiers (replay-derived reach, and took-against-declined decisions). economy is the Gold curve per round. Then use runs and derived for anything the tables do not answer.',
    meta: {
      schemaVersion: 'The export schema version (2). Version-1 columns keep their names and formulas; version 2 adds the cohort columns, the Welch intervals, the evidence labels and the scope, quality, fetch and coverage keys. A column is never redefined under a shipped version.',
      generatedAt: 'When the file was made (ISO time).',
      appVersion: 'Game version plus build commit that made the file.',
      activeSet: 'The card set the report reads. Only runs of this set are in the file.',
      contentRevision: 'A hash of every card, rune and quest definition in the build that made the file. Each run carries the revision it was played under. Card names and tiers in the tables are the CURRENT content (this build); observedTiers per card lists the tiers the shop actually offered the card at in the runs, so a moved tier is visible rather than relabelled.',
      patches: 'Every game build (version+commit) the exported runs were played on, newest first.',
      dateRange: 'Oldest and newest run in the file.',
      counts: 'fetched = rows read from the database; ladder = rows that are real lobby runs; inSet = ladder rows in the active set after sanitising; unstamped = ladder rows with no set stamp (they count as set1); withDerived = exported rows that carry a derived payload; duplicateIds = in-set rows dropped for sharing a row id with an earlier row; placementMalformed = rows whose placement was not an integer 1 to 8 (kept with the placement cleared, so they never count as placed); inScope = in-set rows inside the epoch and window (the rows exported); exportedRuns / exportedDerived = the lengths of runs and derived; heroes = distinct heroes in the file.',
      filters: 'The data filters applied, in plain words. The in-game hero, tier and tribe pickers are view filters and are NOT applied: the file always carries every hero.',
      sampleGates: 'The sample-size bands a row is described by (below 20 runs the row is shown dimmed; 50 and 100 are the next bands). Neutral size descriptions, not verdicts.',
      scope: 'The balance epoch (one content revision, or all for the explicit historical read) and the date window (from / to, calendar days, null = open) the file reads; epochRuns = runs in that scope; revisionsIncluded = every content revision actually present. The epoch is a filter, never a stratum. The report never pools older revisions on its own: the historical read is a choice the reader made.',
      epochs: 'Every content revision in the set slice before the scope was applied, newest first: rev, runs, oldest and newest run. An unknown rev is a row with no revision stamp.',
      quality: 'Data-integrity counts over the exported rows: rows; placementMissing (no placement) and placementMalformed (cleared); duplicateIds; withDerived, diverged (partial payloads, left out of every derived read) and stackedStreams (payloads whose streams carried earlier runs of the same browser session in front of their own, read by their last segment only); replayDisagree = rows whose replay-derived tierByWave does not match the live finalWave, short or long (the flat tier table and shop curve are unreliable for them); heroOfferMissing = rows with no recorded hero trio; revisionMissing = rows with no content revision stamp.',
      fetch: 'What the fetch read: flatCap and flatPageSize (the flat rows are paged with range queries until a short page or the cap), flatFetched, flatTruncated (true when the cap stopped the walk: the file is then BOUNDED, not all); derivedCap, derivedRequested, derivedFetched and derivedDropped (payloads asked for by id that did not come back).',
      coverage: 'The cohort coverage: runs (in scope), placed, withDerived (usable payloads), excludedNoDerived (runs left out of the exposed and adjusted reads for lacking one), stacked (payloads read by their last segment), uniquePlayers (distinct display names across the runs, see playerKey).',
      playerKey: 'How unique players are counted. basis = displayName: the display name at upload, a labelled PROXY (a name can change and can be shared, so a count of names is not a count of accounts; with two names behind most runs the player dimension is thin). No trusted pseudonymous key exists yet; the note says what one needs. No name and no account id is ever written into a table, and runs[].player is a per-file alias, not the name.',
      excludedProlificRuns: 'The sensitivity toggle: how many runs of the most prolific player (by display name) were left out of every table in this file. 0 = the toggle was off.',
      thresholds: 'welchMinN = runs needed on each side before a Welch interval is printed; evidenceGates = the group sizes and unique players behind candidate and supported; epochMinRuns = runs an epoch needs before it is read on its own; roundBands and goldBands = the strata definitions in words.',
      exclusions: 'Per metric, which runs fed it and which were left out, with counts: raw (the placement tables), exposed, adjusted, heroes, runes, tiers, tierDecisions, economy.',
    },
    aggregates: {
      report: 'The classic report tables and the run count. totalRuns = the runs every table below was computed from (every run in runs). heroes / runes / quests / minions / spells: one row per id, with its name; offered = runs it was offered in; picked = runs that took it; games = runs played with it; offerRate / pickRate / winRate = whole percents (-1 = no data); avgWins = average round wins per run (heroes; null elsewhere); avgTurns = turns to complete (quests; null elsewhere); avgPlace / firstRate / lastRate / placedGames = placement stats over placed runs that took it (avgPlace is null when none). For minions and spells, offered and picked are RAW COUNTS of sightings and buys (a card seen four times in one run counts four), split by source into shopOffered / shopPicked (the tavern) and discoverOffered / discoverPicked (Discover picks); avgPlace there is credited PER ACQUISITION (a run that bought a card three times contributes three finishes), which is why it can differ from impact.avgPlace. shopCurve = the shop-leveling curve: maxWave = the last wave any run reached; won and lost = the mean shop tier at each wave over runs that won (placement 1) and runs that did not, arrays indexed BY WAVE with index 0 unused and null where no run reached the wave; wonRuns and lostRuns = the runs behind each; avgWaveToTier = the mean wave a run first reaches each shop tier, indexed BY TIER with index 0 unused (tier 1 is always wave 1); byPlacement = the same mean-tier-by-wave series, one per final placement, indexed BY PLACEMENT 1 to 8 with index 0 unused and null where no run finished there; placedRuns = the runs behind each placement series, indexed the same way. The shop curve is REPLAY-derived (see meta.quality.replayDisagree).',
      impact: `The per-card table, PER RUN, one row per card. id and name = the card (see cards; names and tiers are the current content); spell = true for a spell, false for a minion; tier = its current shop tier; tribe and tribe2 = its tribe and, for a dual-tribe card, its second tribe (else null). DEMAND: runsSeen = runs that saw the card anywhere (shop or Discover, by the upload-time arrays); runsBought = runs that acquired it anywhere by those arrays (a run counts once however many copies); shopSeen / shopBought / shopBuyRate = raw tavern sightings, buys and buys as a percent of sightings; discSeen / discBought / discRate = the same for Discover offers; avgBuyWave = mean wave the card was acquired on; gate = the sample band of runsBought. NOTE the upload-time arrays can carry EARLIER runs of the same browser session (meta.quality.stackedStreams): segmentedBuyers = buyer runs by this run's own derived streams (shop or Discover, last segment), the honest per-run count. RAW PERFORMANCE: ${PLACEMENT_COLS}; missingPlacement = buyer runs with no placement, never counted toward a finding; tierDelta = the RELATIVE raw association within tier: delta minus the placed-buyer-weighted average delta of the card's tier (minions against minions, spells against spells), a secondary read, not a survival correction; buyerPlayers / controlPlayers = unique players (display-name proxy) among the placed buyers and the placed controls; observedTiers = the card tiers the derived shop offers actually carried in these runs (the row's tier is the current one; a moved tier shows here instead of being relabelled). EXPOSED DIAGNOSTIC: exposed = buyers against exposed skippers, both sides restricted to runs whose last-segment derived shop offers included the card (buyers = acquired it by shop or Discover in that run; skippers = saw it and did not): buyers, skippers (placed), buyerAvg, skipperAvg, delta = buyerAvg minus skipperAvg (negative = buyers finished better than the runs that saw it and passed), ci = Welch 95% on that delta (null under 5 a side), notExposedBuyers = placed buyers with no recorded sighting (a coverage mismatch, reported not repaired), buyerPlayers / skipperPlayers; exposedFlat = the same comparison on the upload-time arrays (sightings by shop or Discover), the handoff's section-2 definition, which inherits the stacked-stream contamination; kept for audit continuity. A diagnostic only: a sighting at any time is not a comparable decision. ADJUSTED ASSOCIATION: episodes = runs with a primary observation for the card, one per run: the first shop wave the card was on offer and affordable (any copy with gold at or above its base cost, or bought) before any prior acquisition of it; episodeBuyers = those that bought a copy in that wave; episodeExclusions = why runs offered the card had no episode: priorAcquisition (acquired, any source, in an earlier wave), sameWaveGrant (a non-shop acquisition in the offer wave, buy and grant indistinguishable), unaffordable (offer waves skipped for being unaffordable at sighting) and neverAffordable (every offer wave was). adjusted = the opportunity-based read: buyers and skippers (placed episodes on each side); strata = round band (early waves 1 to 4, mid 5 to 8, late 9 and later) x shop tier at the offer; supportedStrata = strata holding both a buyer and a skipper; buyersInSupport / skippersInSupport; outsideSupportPct = placed buyers in unsupported strata as a percent of placed buyers; association = sum over supported strata of (buyer share of the stratum) x (mean buyer placement minus mean skipper placement), negative = buying went with a better finish in the situations buyers were actually in, NULL when no stratum is supported (insufficient comparable data, never zero); ci = a stratified Welch-type 95% interval (weighted per-stratum variances, Satterthwaite degrees of freedom), null under 5 a side in support or when a supported stratum has one observation on a side; crossover = passes followed by a later acquisition (reported, never relabelled); unplaced = observations with no placement; buyerPlayers / skipperPlayers; supported = the supported strata (key, buyers, skippers, buyerAvg, skipperAvg, delta). Uncontrolled: player intention, hero, board strength, Gold beyond affordability, positioning, synergy, and the offer context being captured at first sighting rather than at the decision. ROLE AND TIMING (descriptive): role = earlyBuyers / midBuyers / lateBuyers (buyer runs by the round band of their first acquisition), playedPct / finalBoardPct / soldPct (of every acquisition: played to the board, survived to the final board, sold; a minion sold after doing its job is not a failure), nextCombatWinPct (percent of acquisitions whose same-wave combat was won), acquisitions. EVIDENCE: evidence = insufficient, candidate or supported, from both sides of the comparison in evidenceBasis (adjusted when an association exists, else exposed, else none) and the unique players on the smaller side; none of them means confirmed overpowered or underpowered.`,
      byTier: 'impact rolled up per shop tier: key and label = the tier (1 to 7, shown T1 to T7); cards = cards of that tier seen in the data; runsBought and placedN = CARD-BUYER INCIDENCES summed over those cards (a run that bought five cards of the tier counts five times; not unique runs); avgPlace and delta = weighted by each card\'s placed buyer runs.',
      byTribe: 'impact rolled up per tribe: key = the tribe id and label = its name; cards = cards of that tribe seen in the data; runsBought and placedN = CARD-BUYER INCIDENCES summed over those cards (not unique runs); avgPlace and delta = weighted by each card\'s placed buyer runs. A dual-tribe card counts for both tribes.',
      heroImpact: `The same read per HERO, one row per hero id (see heroes). id and name = the hero; offered = runs whose recorded picker trio offered it (a pick outside the trio counts as offered); runs = runs that picked it (the sample); offerRate = offered as a percent of all runs; pickRate = runs as a percent of offered; avgWins = mean combat rounds won per run with it; gate = the sample band of runs. RAW: ${PLACEMENT_COLS}, where the baseline is every other placed run (every run has exactly one hero). OFFERED COMPARISON (the primary read): offeredSkippers = placed runs whose recorded trio offered the hero and that picked another; offeredSkipperAvg = their mean placement; offeredDelta = avgPlace minus offeredSkipperAvg (negative = runs that chose the hero finished better than runs offered it that chose otherwise); offeredCi = Welch 95% on it (null under 5 a side). Runs with no recorded trio (meta.quality.heroOfferMissing) cannot enter it. Within one revision when the scope is an epoch; pooled across revisions on the historical read. players / skipperPlayers = unique players (display-name proxy) on each side; evidence = the label of the offered comparison. Picking a hero is selected behaviour, not a random treatment.`,
      runeImpact: `The same read per RUNE, one row per rune id (see runes). id and name = the rune; forge = basic (offered on turn 6) or epic (turn 9); cost = its Gold cost; tribes = its tribe gate (usually empty); offered = runs the Runeforge offered it to, counted once per run; picked = runs that took it (the sample); pickRate = picked as a percent of offered; gate = the sample band of picked. ${PLACEMENT_COLS}, where the baseline is CONTROLLED: the placed runs that were OFFERED the rune and skipped it (equivalent forge access), because a rune is only offered to runs that survived to its forge and every rune would read green against the whole field. fieldDelta, fieldDeltaCi and fieldBaselineN = that uncontrolled read against every other placed run, for reference. players / skipperPlayers = unique players (display-name proxy) among takers and offered skippers; evidence = the label of the taker-vs-skipper comparison. The offers are REPLAY-derived (offeredRunes comes from re-running the action log, which is not guaranteed faithful for a lobby run), so reaching the forge is inferred from a recorded offer, not observed live.`,
      byForge: 'runeImpact rolled up per forge: key = basic or epic, label = its name; cards = runes of that forge seen in the data; runsBought and placedN = picker runs summed over those runes (RUNE-PICKER INCIDENCES, not unique runs); avgPlace and delta = weighted by each rune\'s placed picker runs.',
      tierImpact: `One row per shop tier, tier 2 to 7 (tier 1 is where every run starts), from the REPLAY-derived tierByWave (see meta.quality.replayDisagree: on 2026-09-22 the replay disagreed with the live wave count on 91 of 110 rows, so read tierDecisions for the decision-based view). tier and name = the tier; runsReached = runs whose shop ever reached it; reachRate = that as a percent of all runs; avgWaveReached = the mean wave those runs first reached it; reachedPlacedN and reachedAvgPlace = the placed runs among them and their mean placement; reachedDelta = reachedAvgPlace minus the mean placement of runs that never reached the tier (reads negative for every tier, because the never-reached runs are the early eliminations: a survival statistic, not a tier effect). The EARLY group: cutWave = avgWaveReached rounded; earlyRuns = runs that reached the tier by the cut wave; ${PLACEMENT_COLS}, where the group is the early runs and the baseline every other placed run (reached later or never); gate = the sample band of earlyRuns.`,
      tierDecisions: 'Shop tier-ups as DECISIONS, from the live derived upgrade rows (last segment; a row exists for every wave a tier-up was taken and for every wave one was affordable and declined). One primary observation per run per tier: the first wave a tier-up to that tier was affordable, took or declined; a later take never relabels a decline. tier and name = the tier reached; decisions = runs with a primary decision; took / declined; declinedIdle = declines in a wave the run bought no card either (a run holding its Gold, or one the player stopped acting in; early-wave declines are mostly the second, so an early row\'s interval is not a finding; disclosed, never excluded, because dropping them would guess at intent); crossover = declines followed by a later take; avgWave = mean wave of the decision; tookPlaced / declinedPlaced = placed runs on each side; tookAvg / declinedAvg = their mean placement; rawDelta = tookAvg minus declinedAvg among runs that had the decision (negative = taking went with a better finish); rawCi = Welch 95% on it (null under 5 a side); adjusted = the stratified read, took weighted, on round band (early 1 to 4, mid 5 to 8, late 9 and later) x spare Gold after paying (tight 0 to 1, spare 2 to 4, rich 5 and more), with the same fields as impact.adjusted, buyers = took and skippers = declined: buyers, skippers, strata, supportedStrata, buyersInSupport, skippersInSupport, outsideSupportPct, association, ci, crossover, unplaced, buyerPlayers, skipperPlayers, supported (key, buyers, skippers, buyerAvg, skipperAvg, delta); evidence = the label of the adjusted read. Runs that never could afford the tier-up are in neither group.',
      economy: 'The Gold curve per round, from the derived Gold ledgers. runs = the runs in each bucket; skipped = ledgers left out because they were partial (diverged) or did not open on the game\'s starting 3 Gold (a dev build\'s cheat Gold); a ledger that carries earlier runs of the same session in front of its own (the wave number drops back to 1) counts only its last segment, the uploaded run. waves = one array of rows per bucket, rounds ascending. The buckets: all = every run with a ledger, first = runs that placed 1st, top4 = placed 1 to 4, bottom4 = placed 5 to 8 (a run with no placement is in all only). Each row: wave = the round; runs = runs of the bucket whose ledger reached the round (the divisor of every average: a run counts for every round up to its last wave, whether or not Gold moved); moved = runs of the bucket with at least one Gold movement logged that round (stated because the two denominators differ; not the divisor); goldStart = mean Gold at the start of the round, after the refill; income = mean Gold that came in during the round (card payouts, hero effects), not the refill; sold = mean Gold recovered by selling; spent = mean Gold spent, all categories; unspent = mean Gold left when the round ended, which is lost because the next round refills to the cap instead of carrying it; spentPct = spent as a whole percent of goldStart plus income plus sold; split = where the spent Gold went, mean Gold per run per category: minion, spell, upgrade (shop tier-ups), refresh (rerolls), rune (Runeforge buys and rerolls), heroPower and other (the ledger\'s ruby, henchman and other categories, which no live run has used). For every run, goldStart plus income plus sold equals spent plus unspent. The rows pool every content revision inside the scope; Gold rules are assumed unchanged across them, which is not checked here.',
      upgrades: 'Per wave, from the derived upgrade rows (stacked payloads included as stored): wave = the wave; offered = turns where a shop tier-up was available; taken = turns it was taken; takeRate = taken over offered (fraction); avgCost = the mean Gold paid; afterLossTakeRate and afterLossN = the take rate and its sample specifically after a lost combat.',
    },
    cards: 'Dictionary of every card id that appears anywhere in the file: name, shop tier, tribe (and tribe2 for dual-tribe cards), spell (true for spells, false for minions), token (true for cards that are granted, never bought from the shop). CURRENT content: a renamed or moved card is presented by its current name and tier; impact.observedTiers shows the tiers the shop actually offered it at.',
    heroes: 'Dictionary of hero id to display name.',
    runes: 'Dictionary of rune id to display name. Runes are run-long passive upgrades picked from the Runeforge.',
    runs: {
      about: 'One object per exported run, the raw telemetry. Card, hero and rune ids resolve through the dictionaries above. The card arrays are UPLOAD-TIME arrays and can carry earlier runs of the same browser session in front of the run\'s own (meta.quality.stackedStreams); the derived streams carry waves and can be cut to the last segment.',
      id: 'Database row id. Matches derived[].rowId.',
      createdAt: 'When the run finished (ISO time).',
      patch: 'Game build the run was played on.',
      player: 'A per-file alias for the run\'s display name: player 1, player 2, ... in order of first appearance, null when the row carries no name. Several runs share an alias when one display name played several runs, so every unique-player count in the tables can be re-derived from it. No display name and no account id is written into the file; the numbering is stable only inside this one file (another scope renumbers).',
      contentRevision: 'The content revision the run was played under (its balance epoch).',
      set: 'The card set the report read the run as: its stamp, or set1 when unstamped.',
      setId: 'The raw set stamp: the set_id column, or the stamp the client wrote inside its derived payload when the column did not exist yet. Null on runs recorded before 2026-09-22.',
      source: 'What produced the row: ladder for a real lobby run. Null on rows recorded before 2026-09-22; the report reads such a row as ladder when its mode is lobby.',
      mode: 'The run mode. Always lobby in this file.',
      heroId: 'The hero the player picked.',
      heroOffer: 'The three heroes the picker offered (empty when not recorded).',
      won: 'True when the run won the lobby (placement 1).',
      wins: 'Combat rounds won during the run.',
      placement: 'Final lobby placement, 1 (won) to 8 (first eliminated). Null when missing or when the stored value was not an integer 1 to 8.',
      offeredQuests: 'Quest ids offered (quests are retired content; usually empty).',
      pickedQuests: 'Quest ids taken.',
      questTurns: 'Completed quest id to turns it took.',
      offeredRunes: 'Rune ids offered by the Runeforge this run (deduplicated; replay-derived).',
      pickedRunes: 'Rune ids the player took.',
      offeredCards: 'Every tavern sighting this run, one entry per fresh shop offer (NOT deduplicated).',
      boughtCards: 'Every tavern purchase this run, one entry per buy.',
      discoverOfferedCards: 'Every option shown in a Discover (three per Discover), one entry each.',
      discoverBoughtCards: 'Every Discover pick, one entry each.',
      tierByWave: 'Shop tier at the end of each wave; index = wave (index 0 unused). Replay-derived.',
      buyEvents: 'Every acquisition with the wave it happened on and its source (shop or discover).',
    },
    derived: {
      about: 'One object per exported run that carries a derived payload, keyed to runs by rowId. Observed live as the run was played: the offer-by-offer, Gold-by-Gold event streams. Card ids carry a rev (that card\'s content revision at the time). A payload can carry EARLIER runs of the same browser session in front of its own: the wave number drops back to 1 where the next run began; every table in this file reads the last segment.',
      rowId: 'The run_telemetry row id this payload belongs to.',
      contentRevision: 'The content revision the run was played under.',
      heroId: 'The hero.',
      mode: 'The run mode.',
      setId: 'The card set stamp (absent on payloads before 2026-09-22).',
      source: 'What produced the run (absent on payloads before 2026-09-22).',
      seed: 'The run seed.',
      finalWave: 'The last wave reached (live).',
      wins: 'Scored round wins.',
      won: 'True when the run won the lobby.',
      diverged: 'True when the streams are partial and must not be pooled.',
      offers: 'One row per individual card copy offered in the tavern, recorded ONCE at FIRST SIGHTING (the board, Gold and health context is the state when the copy first appeared, not the decision moment; on a buy, gold and goldAfter are updated to purchase time): wave, slot (0 to 6 left to right, or spell for the spell slot), cardId, rev, shopTier, cardTier (the card\'s tier at the time), cost (the card\'s BASE cost, not a discounted price), gold, maxGold, upgradeCost, resolve (health), boardSize, boardAttack, boardHealth, bought (did the player buy this copy), goldAfter, frozen (never set on a live row: a freeze happens after the offers are minted, so a carried-over offer is one row at its first-sighting wave), topTribe (the board\'s most common tribe at the time).',
      acquisitions: 'One row per card that entered the player\'s possession: cardId, rev, wave, source (shop, discover, quest, rune, heroPower, henchman, generated), goldPaid, played, playedWave, soldWave, sellValue, finalBoard (survived to the final board), golden (gilded). No sequence number links an offer to an acquisition inside a wave.',
      gold: 'One row per Gold movement: wave, amount (negative = spent), category (minion, spell, ruby, refresh, upgrade, heroPower, rune, henchman, sell, income, other), sourceCard, goldAfter, maxGoldAfter.',
      upgrades: 'One row per turn a shop tier-up was available: wave, fromTier, toTier, cost, taken, goldBefore, goldAfter, resolve, prevResult (the previous combat: win, loss, draw), boardSize, boardAttack, boardHealth, cardsBoughtThisTurn.',
      combats: 'One row per combat: wave, result, damage dealt to the loser, attacks, friendlyDeaths, enemyDeaths, summons, spellCasts, beats (event count, a proxy for fight length), boardSize, boardAttack, boardHealth, shopTier, triggers (per-keyword trigger counts).',
      triggers: 'One row per threshold engine (Avenge) that entered a combat: wave, cardId, rev, keyword, threshold, deathsAvailable, triggers, diedBeforeTrigger, failure (insufficientDeaths or diedEarly).',
      boards: 'End-of-shop board snapshots: wave, tier, cards (id, rev, pos, attack, health, golden), totalAttack, totalHealth, goldSpentThisTurn.',
      playerActions: 'Number of player decisions taken over the run.',
    },
  };
}

/** What `buildBalanceExport` needs beside the rows: the build and fetch facts only the panel knows. */
export interface BalanceExportInfo {
  activeSet: { id: SetId; name: string };
  appVersion: string;
  generatedAt: string;
  contentRevision: string;
  counts: ReportFilterCounts;
  filters: string[];
  scope: ReportScope;
  /** Every epoch in the set slice before the scope. */
  epochs: EpochInfo[];
  fetch: FetchCoverage;
  excludedProlificRuns?: number;
  keyOf?: PlayerKeyOf;
}

/**
 * Build the whole-dataset export from the report's FILTERED and SCOPED rows — the same rows the panel renders —
 * plus the run metadata. Pure; the panel stringifies and downloads it, the tests assert on it.
 */
export function buildBalanceExport(rows: RunTelemetryRow[], info: BalanceExportInfo): BalanceExport {
  const keyOf = info.keyOf ?? displayNameKey;
  const report = aggregatePlayerReport(rows);
  const { rows: impact, coverage } = cardImpactWithCoverage(rows, keyOf);
  const minions = impact.filter((r) => !r.spell);
  const spells = impact.filter((r) => r.spell);
  const runes = runeImpact(rows, keyOf);
  const derivedRuns = rows.filter((r) => r.derived != null).map((r) => ({ rowId: r.id, ...r.derived! }));
  const quality = dataQuality(rows);
  const cardIds = new Set<string>();
  const runeIds = new Set<string>();
  const heroIds = new Set<string>();
  for (const r of rows) {
    for (const id of [...r.offeredCards, ...r.boughtCards, ...(r.discoverOfferedCards ?? []), ...(r.discoverBoughtCards ?? [])]) cardIds.add(id);
    for (const id of [...r.offeredRunes, ...r.pickedRunes]) runeIds.add(id);
    heroIds.add(r.heroId);
    for (const id of r.heroOffer) heroIds.add(id);
    if (r.derived) {
      for (const o of r.derived.offers) cardIds.add(o.cardId);
      for (const q of r.derived.acquisitions) cardIds.add(q.cardId);
    }
  }
  const cards: BalanceExport['cards'] = {};
  for (const id of [...cardIds].sort()) {
    const def = CARD_INDEX[id];
    if (def) cards[id] = { name: def.name, tier: def.tier, tribe: def.tribe, tribe2: def.tribe2 ?? null, spell: !!def.spell, token: !!def.token };
  }
  const heroes: Record<string, string> = {};
  for (const id of [...heroIds].sort()) heroes[id] = heroNameOf(id);
  const runeNames: Record<string, string> = {};
  for (const id of [...runeIds].sort()) runeNames[id] = RUNE_INDEX[id]?.name ?? id;
  const dates = rows.map((r) => r.createdAt).filter((d): d is string => !!d).sort();
  const patches = [...new Set(rows.map((r) => r.patch).filter((p): p is string => !!p))];
  const economy = goldEconomy(rows);
  const usable = rows.filter((r) => usableDerived(r) != null).length;
  const placed = rows.filter((r) => validPlacement(r.placement)).length;
  const aliases = playerAliases(rows);
  return {
    meta: {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      generatedAt: info.generatedAt,
      appVersion: info.appVersion,
      activeSet: info.activeSet,
      contentRevision: info.contentRevision,
      patches,
      dateRange: { oldest: dates[0] ?? null, newest: dates[dates.length - 1] ?? null },
      counts: { ...info.counts, exportedRuns: rows.length, exportedDerived: derivedRuns.length, heroes: new Set(rows.map((r) => r.heroId)).size },
      filters: info.filters,
      sampleGates: SAMPLE_GATES,
      scope: { ...info.scope, epochRuns: rows.length, revisionsIncluded: epochsOf(rows).map((e) => e.rev) },
      epochs: info.epochs,
      quality,
      fetch: info.fetch,
      coverage,
      playerKey: {
        basis: 'displayName',
        note: 'Unique players are distinct display names at upload, a proxy: a name can change and can be shared. A trusted key would be a server-side hash of the account id with a secret (a view or RPC the owner creates), read on its own select rung and never written into the export.',
      },
      excludedProlificRuns: info.excludedProlificRuns ?? 0,
      thresholds: {
        welchMinN: WELCH_MIN_N, evidenceGates: EVIDENCE_GATES, epochMinRuns: EPOCH_MIN_RUNS,
        roundBands: 'early = waves 1 to 4, mid = 5 to 8, late = 9 and later',
        goldBands: 'spare Gold after paying the tier-up: tight = 0 to 1, spare = 2 to 4, rich = 5 and more',
      },
      exclusions: {
        raw: `placement tables read the ${placed} placed runs of ${rows.length}; ${rows.length - placed} unplaced runs count toward demand only`,
        exposed: `exposed diagnostic and segmented buyer counts read the ${usable} runs with a usable derived payload; ${rows.length - usable} runs without one (${quality.diverged} diverged) are left out`,
        adjusted: `adjusted association reads shop episodes from the same ${usable} usable payloads; per card, runs with a prior acquisition, a same-wave grant or no affordable offer contribute no episode (impact[].episodeExclusions)`,
        heroes: `the offered comparison reads runs with a recorded hero trio; ${quality.heroOfferMissing} runs have none and enter the raw read only`,
        runes: 'the taker-vs-skipper comparison reads runs the replay recorded an offer for; a run with no recorded rune offer is in neither group',
        tiers: `tierImpact reads the replay-derived tierByWave of every run; ${quality.replayDisagree} rows disagree with the live wave count`,
        tierDecisions: `tierDecisions reads the last-segment upgrade rows of the ${usable} usable payloads`,
        economy: `economy reads ${economy.runs.all} ledgers; ${economy.skipped} skipped (diverged, or not opening on the starting Gold)`,
      },
    },
    readme: exportReadme(),
    aggregates: {
      report,
      impact: { minions, spells },
      byTier: { minions: impactGroups(minions, 'tier'), spells: impactGroups(spells, 'tier') },
      byTribe: { minions: impactGroups(minions, 'tribe'), spells: impactGroups(spells, 'tribe') },
      heroImpact: heroImpact(rows, keyOf),
      runeImpact: runes,
      byForge: runeGroups(runes),
      tierImpact: tierImpact(rows),
      tierDecisions: tierDecisions(rows, keyOf),
      economy,
      upgrades: upgradeShape(derivedRuns),
    },
    cards,
    heroes,
    runes: runeNames,
    runs: rows.map((r) => toExportedRun(r, r.author == null ? null : aliases.get(r.author) ?? null)),
    derived: derivedRuns,
  };
}
