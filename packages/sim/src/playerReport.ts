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
 */
import { CARD_INDEX, RUNE_INDEX, type SetId } from '@game/content';
import { CONFIG } from './config';
import { HEROES } from './heroes';
import { upgradeShape, wilson, SAMPLE_GATES, type DerivedRun, type GoldEvent, type UpgradeWaveRow } from './runDerive';
import { aggregatePlayerReport, type PlayerReport, type RunTelemetry, type TelemetrySource } from './runTelemetry';

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
  const inSet = ladder.filter((r) => telemetrySetOf(r) === setId);
  return {
    rows: inSet,
    counts: {
      fetched: rows.length,
      ladder: ladder.length,
      inSet: inSet.length,
      unstamped: ladder.filter((r) => r.setId == null).length,
      withDerived: inSet.filter((r) => r.derived != null).length,
    },
    applied: [
      'ladder runs only: mode is lobby and the source stamp, when present, is ladder (never a Scene Builder sandbox, practice or tutorial run)',
      `set is ${setId}: a row with no set stamp counts as ${LEGACY_SET}, never as the live set`,
    ],
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
  /** 95% interval on the delta (pooled-variance normal approximation on the difference of two means). */
  deltaCi: { lo: number; hi: number } | null;
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
  let delta: number | null = null, deltaCi: { lo: number; hi: number } | null = null, impact: number | null = null;
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
  gate: SampleGate;
}

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
export function cardImpact(rows: RunTelemetry[]): CardImpactRow[] {
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
    out.push({
      id, name: def.name, spell: !!def.spell, tier: def.tier, tribe: def.tribe, tribe2: def.tribe2 ?? null,
      runsSeen: a.runsSeen, runsBought: a.runsBought,
      shopSeen: a.shopSeen, shopBought: a.shopBought, shopBuyRate: pctOf(a.shopBought, a.shopSeen),
      discSeen: a.discSeen, discBought: a.discBought, discRate: pctOf(a.discBought, a.discSeen),
      ...placementImpact(a.places, pool),
      tierDelta: null, // filled below, once every card's delta is known
      avgBuyWave: a.buyWaves.length > 0 ? r1(a.buyWaves.reduce((s, w) => s + w, 0) / a.buyWaves.length) : null,
      gate: sampleGateOf(a.runsBought),
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
  return sortByImpact(out);
}

/** A group (a tier, a tribe, a forge) rolled up from its rows. `delta` and `avgPlace` are weighted by each
 *  row's placed runs, so a tier's delta reads "the average buyer of a card in this tier finishes this much
 *  better (negative) or worse (positive) than the field". `cards` = the rows in the group (cards, runes, ...)
 *  and `runsBought` = their summed sample (buyer runs, picker runs, ...). */
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
}

const heroNameOf = (id: string): string => HEROES.find((h) => h.id === id)?.name ?? id;

export function heroImpact(rows: RunTelemetry[]): HeroImpactRow[] {
  const acc = new Map<string, { offered: number; runs: number; winsSum: number; places: number[] }>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) { a = { offered: 0, runs: 0, winsSum: 0, places: [] }; acc.set(id, a); }
    return a;
  };
  const pool = placementPool(rows);
  for (const r of rows) {
    for (const id of r.heroOffer) get(id).offered++;
    if (!r.heroOffer.includes(r.heroId)) get(r.heroId).offered++; // a pick outside the recorded trio still counts as offered
    const a = get(r.heroId);
    a.runs++;
    a.winsSum += r.wins;
    if (r.placement != null) a.places.push(r.placement);
  }
  const out: HeroImpactRow[] = [];
  for (const [id, a] of acc) {
    out.push({
      id, name: heroNameOf(id),
      offered: a.offered, runs: a.runs,
      offerRate: pctOf(a.offered, rows.length), pickRate: pctOf(a.runs, a.offered),
      avgWins: a.runs > 0 ? r1(a.winsSum / a.runs) : null,
      ...placementImpact(a.places, pool),
      gate: sampleGateOf(a.runs),
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
}

export function runeImpact(rows: RunTelemetry[]): RuneImpactRow[] {
  const acc = new Map<string, { offered: number; picked: number; places: number[]; offeredPlaces: number[] }>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) { a = { offered: 0, picked: 0, places: [], offeredPlaces: [] }; acc.set(id, a); }
    return a;
  };
  const pool = placementPool(rows);
  for (const r of rows) {
    const offered = new Set([...r.offeredRunes, ...r.pickedRunes]); // a pick outside the recorded offers still counts as offered
    for (const id of offered) {
      const a = get(id);
      a.offered++;
      if (r.placement != null) a.offeredPlaces.push(r.placement);
    }
    for (const id of new Set(r.pickedRunes)) {
      const a = get(id);
      a.picked++;
      if (r.placement != null) a.places.push(r.placement);
    }
  }
  const out: RuneImpactRow[] = [];
  for (const [id, a] of acc) {
    const def = RUNE_INDEX[id];
    const field = placementImpact(a.places, pool);
    out.push({
      id, name: def?.name ?? id,
      forge: def?.epic ? 'epic' : 'basic', cost: def ? def.cost : null, tribes: [...(def?.tribes ?? [])],
      offered: a.offered, picked: a.picked, pickRate: pctOf(a.picked, a.offered),
      ...placementImpact(a.places, placesPool(a.offeredPlaces)),
      fieldDelta: field.delta, fieldDeltaCi: field.deltaCi, fieldBaselineN: field.baselineN,
      gate: sampleGateOf(a.picked),
    });
  }
  return sortByImpact(out);
}

/** The rune rows rolled up per forge (Basic / Epic), the runes' analogue of the tier strip. */
export const runeGroups = (rows: RuneImpactRow[]): ImpactGroupRow[] =>
  groupImpact(rows, (r) => [[r.forge, r.forge === 'epic' ? 'Epic forge' : 'Basic forge']], (r) => r.picked, (a, b) => (a.key === 'basic' ? -1 : 1) - (b.key === 'basic' ? -1 : 1));

// ── Shop tiers ─────────────────────────────────────────────────────────────────────────────────────────────

/** One shop tier's read, T2 to T7. The shared placement stats are the EARLY group: runs that reached the tier
 *  by its cut wave (the mean wave runs reach it, rounded) against every other placed run (runs that reached
 *  it later or never). That is the early-vs-late question. "Reached it at all" against "never reached it" is
 *  carried as `reachedDelta`, but it reads green for every tier because the never-reached group is the runs
 *  that were eliminated early. */
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
  /** Runs of the bucket that played this round (the divisor). */
  runs: number;
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

interface WaveLedger { wave: number; goldStart: number; income: number; sold: number; unspent: number; split: Record<SpendCategory, number> }

const spendCategoryOf = (c: GoldEvent['category']): SpendCategory =>
  c === 'minion' || c === 'spell' || c === 'upgrade' || c === 'refresh' || c === 'rune' || c === 'heroPower' ? c : 'other';

/** The events of the run the row was uploaded for. A live ledger can carry EARLIER runs of the same session
 *  in front of its own (53 of the 114 live payloads did on 2026-09-22: the wave number drops back to 1 where
 *  the next run began, and the last segment is the one whose final wave matches `finalWave`). The uploaded
 *  run is the segment after the last drop. */
export function ledgerSegment(gold: GoldEvent[]): GoldEvent[] {
  let start = 0;
  for (let i = 1; i < gold.length; i++) if (gold[i]!.wave < gold[i - 1]!.wave) start = i;
  return start === 0 ? gold : gold.slice(start);
}

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
    out.push({ wave, goldStart, income, sold, unspent, split });
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
  type Acc = { runs: number; goldStart: number; income: number; sold: number; unspent: number; split: Record<SpendCategory, number> };
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
        if (!a) { a = { runs: 0, goldStart: 0, income: 0, sold: 0, unspent: 0, split: Object.fromEntries(SPEND_CATEGORIES.map((c) => [c, 0])) as Record<SpendCategory, number> }; acc[b].set(w.wave, a); }
        a.runs++;
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
        wave, runs: a.runs,
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
  author: string | null;
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

export interface BalanceExportMeta {
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
    economy: GoldEconomy;
    upgrades: UpgradeWaveRow[];
  };
  cards: Record<string, { name: string; tier: number; tribe: string; tribe2: string | null; spell: boolean; token: boolean }>;
  heroes: Record<string, string>;
  runes: Record<string, string>;
  runs: ExportedRun[];
  derived: (DerivedRun & { rowId: number | null })[];
}

export function toExportedRun(r: RunTelemetryRow): ExportedRun {
  return {
    id: r.id, createdAt: r.createdAt, patch: r.patch, author: r.author, contentRevision: r.contentRevision,
    set: telemetrySetOf(r), setId: r.setId ?? null, source: r.source ?? null, mode: r.mode ?? null,
    heroId: r.heroId, heroOffer: r.heroOffer, won: r.won, wins: r.wins, placement: r.placement ?? null,
    offeredQuests: r.offeredQuests, pickedQuests: r.pickedQuests, questTurns: r.questTurns,
    offeredRunes: r.offeredRunes, pickedRunes: r.pickedRunes,
    offeredCards: r.offeredCards, boughtCards: r.boughtCards,
    discoverOfferedCards: r.discoverOfferedCards ?? [], discoverBoughtCards: r.discoverBoughtCards ?? [],
    tierByWave: r.tierByWave, buyEvents: r.buyEvents ?? [],
  };
}

/** The plain-language key: every top-level key and every column, written INTO the file so a reader with no
 *  access to the codebase can interpret it. Kept as data so the tests can check it covers every key. */
export function exportReadme(): BalanceExport['readme'] {
  return {
    about: 'ASCENT balance export. ASCENT is an auto-battler: a shop phase (buy minions and spells, upgrade the shop tier) alternates with auto-resolved combats inside an eight-seat elimination lobby. A run ends with a placement from 1 (won the lobby) to 8 (first out). Lower placement is better. This file holds every ladder run of one card set: the aggregate tables the in-game Balance Report shows, the raw per-run telemetry those tables are computed from, and the derived event streams per run. The aggregates are computed from exactly the runs in `runs`, so any number here can be re-derived from the raw data.',
    readme: 'This key: a plain-language description of every top-level key and every column in the file.',
    howToRead: 'Start with aggregates.impact.minions (and .spells), already ordered by impact: each row is one card with its sample size and its placement delta. A NEGATIVE delta means runs that bought the card finished better (lower placement) than runs that did not, so the card is a candidate for overpowered; a POSITIVE delta means underpowered. Trust rows in proportion to placedN and read the gate; impact is the delta already discounted for a thin sample. Cross-check with shopBuyRate (do players want it) and top4Rate. aggregates.heroImpact, runeImpact and tierImpact carry the same delta for heroes, runes and shop tiers (read each section\'s note for what its baseline is); aggregates.economy is the Gold curve per round and per placement bucket. Then use runs and derived for anything the tables do not answer.',
    meta: {
      generatedAt: 'When the file was made (ISO time).',
      appVersion: 'Game version plus build commit that made the file.',
      activeSet: 'The card set the report reads. Only runs of this set are in the file.',
      contentRevision: 'A hash of every card, rune and quest definition in the build that made the file. Each run carries the revision it was played under; never pool rows across different revisions.',
      patches: 'Every game build (version+commit) the exported runs were played on, oldest first.',
      dateRange: 'Oldest and newest run in the file.',
      counts: 'fetched = rows read from the database; ladder = rows that are real lobby runs; inSet = ladder rows in the active set (the rows exported); unstamped = ladder rows with no set stamp (they count as set1); withDerived = exported rows that carry a derived payload; exportedRuns / exportedDerived = the lengths of runs and derived; heroes = distinct heroes in the file.',
      filters: 'The data filters applied, in plain words. The in-game hero, tier and tribe pickers are view filters and are NOT applied: the file always carries every hero.',
      sampleGates: 'The sample-size bands used to label a claim: below preliminary (20) is noise, actionable (50) is worth a look, confident (100) is a finding.',
    },
    aggregates: {
      report: 'The classic report tables and the run count. totalRuns = the runs every table below was computed from (every run in runs). heroes / runes / quests / minions / spells: one row per id, with its name; offered = runs it was offered in; picked = runs that took it; games = runs played with it; offerRate / pickRate / winRate = whole percents (-1 = no data); avgWins = average round wins per run (heroes; null elsewhere); avgTurns = turns to complete (quests; null elsewhere); avgPlace / firstRate / lastRate / placedGames = placement stats over placed runs that took it (avgPlace is null when none). For minions and spells, offered and picked are RAW COUNTS of sightings and buys (a card seen four times in one run counts four), split by source into shopOffered / shopPicked (the tavern) and discoverOffered / discoverPicked (Discover picks); avgPlace there is credited PER ACQUISITION (a run that bought a card three times contributes three finishes), which is why it can differ from impact.avgPlace. shopCurve = the shop-leveling curve: maxWave = the last wave any run reached; won and lost = the mean shop tier at each wave over runs that won (placement 1) and runs that did not, arrays indexed BY WAVE with index 0 unused and null where no run reached the wave; wonRuns and lostRuns = the runs behind each; avgWaveToTier = the mean wave a run first reaches each shop tier, indexed BY TIER with index 0 unused (tier 1 is always wave 1); byPlacement = the same mean-tier-by-wave series, one per final placement, indexed BY PLACEMENT 1 to 8 with index 0 unused and null where no run finished there; placedRuns = the runs behind each placement series, indexed the same way.',
      impact: 'The overpowered / underpowered table, PER RUN, one row per card. id and name = the card (see cards); spell = true for a spell, false for a minion; tier = its shop tier; tribe and tribe2 = its tribe and, for a dual-tribe card, its second tribe (else null). Columns: runsSeen = runs that saw the card anywhere; runsBought = runs that acquired it anywhere (a run counts once however many copies); shopSeen / shopBought / shopBuyRate = raw tavern sightings, buys and buys as a percent of sightings; discSeen / discBought / discRate = the same for Discover offers; placedN = buyer runs with a placement; avgPlace = their mean placement (1 best, 8 worst); firstRate / top4Rate / lastRate = percent of buyer runs finishing 1st, in the top 4, 8th; top4Ci = 95% Wilson interval on top4Rate; baselineN / baselineAvgPlace = every other placed run and its mean placement; delta = avgPlace minus baselineAvgPlace (negative = buyers finish better than the field); tierDelta = delta minus the average delta of the card\'s tier (minions against minions, spells against spells), the within-tier read, because a high tier is bought only by runs that survived long enough to reach it and so reads negative as a whole; deltaCi = 95% interval on the delta (pooled-variance normal approximation on the difference of two means); impact = the delta shrunk toward zero for a small sample, delta times placedN / (placedN + 20), so a card keeps half its delta at 20 placed buyer runs and most of it past 100 (the default order: the strongest, best-supported buyer advantage first); avgBuyWave = mean wave the card was acquired on; gate = the sample band of runsBought.',
      byTier: 'impact rolled up per shop tier: key and label = the tier (1 to 7, shown T1 to T7); cards = cards of that tier seen in the data; runsBought and placedN = summed over those cards; avgPlace and delta = weighted by each card\'s placed buyer runs.',
      byTribe: 'impact rolled up per tribe: key = the tribe id and label = its name; cards = cards of that tribe seen in the data; runsBought and placedN = summed over those cards; avgPlace and delta = weighted by each card\'s placed buyer runs. A dual-tribe card counts for both tribes.',
      heroImpact: 'The same placement read per HERO, one row per hero id (see heroes). id and name = the hero; offered = runs whose picker offered it; runs = runs that picked it (the sample); offerRate = offered as a percent of all runs; pickRate = runs as a percent of offered; avgWins = mean combat rounds won per run with it; placedN = picker runs with a placement; avgPlace, firstRate, top4Rate, lastRate, top4Ci = their placement stats as in impact; baselineN / baselineAvgPlace = every other placed run (every run has exactly one hero, so the baseline is the rest of the field and there is no tier-style adjustment); delta = avgPlace minus baselineAvgPlace (negative = the hero finishes better than the field); deltaCi = its 95% interval; impact = the delta shrunk toward zero for a small sample (the default order); gate = the sample band of runs.',
      runeImpact: 'The same placement read per RUNE, one row per rune id (see runes). id and name = the rune; forge = basic (offered on turn 6) or epic (turn 9); cost = its Gold cost; tribes = its tribe gate (usually empty); offered = runs the Runeforge offered it to, counted once per run; picked = runs that took it (the sample); pickRate = picked as a percent of offered; placedN, avgPlace, firstRate, top4Rate, lastRate, top4Ci = placement stats of the picker runs as in impact. The BASELINE is CONTROLLED: baselineN / baselineAvgPlace = the placed runs that were OFFERED the rune and skipped it, because a rune is only offered to runs that survived to its forge and every rune would read green against the whole field; delta = avgPlace minus that baseline (negative = takers finish better than skippers); deltaCi = its 95% interval; impact = that delta shrunk toward zero for a small sample (the default order). fieldDelta, fieldDeltaCi and fieldBaselineN = the uncontrolled read against every other placed run, for reference; gate = the sample band of picked.',
      byForge: 'runeImpact rolled up per forge: key = basic or epic, label = its name; cards = runes of that forge seen in the data; runsBought and placedN = picker runs summed over those runes; avgPlace and delta = weighted by each rune\'s placed picker runs.',
      tierImpact: 'One row per shop tier, tier 2 to 7 (tier 1 is where every run starts). tier and name = the tier; runsReached = runs whose shop ever reached it; reachRate = that as a percent of all runs; avgWaveReached = the mean wave those runs first reached it; reachedPlacedN and reachedAvgPlace = the placed runs among them and their mean placement; reachedDelta = reachedAvgPlace minus the mean placement of runs that never reached the tier (reads negative for every tier, because the never-reached runs are the early eliminations). The EARLY group answers the useful question: cutWave = avgWaveReached rounded; earlyRuns = runs that reached the tier by the cut wave; placedN, avgPlace, firstRate, top4Rate, lastRate, top4Ci = the early runs\' placement stats as in impact; baselineN / baselineAvgPlace = every other placed run (runs that reached the tier later or never); delta = avgPlace minus that (negative = leveling by the cut wave goes with a better finish); deltaCi = its 95% interval; impact = the delta shrunk toward zero for a small sample; gate = the sample band of earlyRuns.',
      economy: 'The Gold curve per round, from the derived Gold ledgers. runs = the runs in each bucket; skipped = ledgers left out because they were partial (diverged) or did not open on the game\'s starting 3 Gold (a dev build\'s cheat Gold); a ledger that carries earlier runs of the same session in front of its own (the wave number drops back to 1) counts only its last segment, the uploaded run. waves = one array of rows per bucket, rounds ascending. The buckets: all = every run with a ledger, first = runs that placed 1st, top4 = placed 1 to 4, bottom4 = placed 5 to 8 (a run with no placement is in all only). Each row: wave = the round; runs = runs of the bucket that played it (the divisor); goldStart = mean Gold at the start of the round, after the refill; income = mean Gold that came in during the round (card payouts, hero effects), not the refill; sold = mean Gold recovered by selling; spent = mean Gold spent, all categories; unspent = mean Gold left when the round ended, which is lost because the next round refills to the cap instead of carrying it; spentPct = spent as a whole percent of goldStart plus income plus sold; split = where the spent Gold went, mean Gold per run per category: minion, spell, upgrade (shop tier-ups), refresh (rerolls), rune (Runeforge buys and rerolls), heroPower and other (the ledger\'s ruby, henchman and other categories, which no live run has used). For every run, goldStart plus income plus sold equals spent plus unspent. Gold rules have not changed across the content revisions in the file, so the rows pool every revision.',
      upgrades: 'Per wave: wave = the wave; offered = turns where a shop tier-up was available; taken = turns it was taken; takeRate = taken over offered (fraction); avgCost = the mean Gold paid; afterLossTakeRate and afterLossN = the take rate and its sample specifically after a lost combat.',
    },
    cards: 'Dictionary of every card id that appears anywhere in the file: name, shop tier, tribe (and tribe2 for dual-tribe cards), spell (true for spells, false for minions), token (true for cards that are granted, never bought from the shop).',
    heroes: 'Dictionary of hero id to display name.',
    runes: 'Dictionary of rune id to display name. Runes are run-long passive upgrades picked from the Runeforge.',
    runs: {
      about: 'One object per exported run, the raw telemetry. Card, hero and rune ids resolve through the dictionaries above.',
      id: 'Database row id. Matches derived[].rowId.',
      createdAt: 'When the run finished (ISO time).',
      patch: 'Game build the run was played on.',
      author: 'The player\'s display name at the time. Several runs share an author when one player played several runs.',
      contentRevision: 'The content revision the run was played under.',
      set: 'The card set the report read the run as: its stamp, or set1 when unstamped.',
      setId: 'The raw set stamp: the set_id column, or the stamp the client wrote inside its derived payload when the column did not exist yet. Null on runs recorded before 2026-09-22.',
      source: 'What produced the row: ladder for a real lobby run. Null on rows recorded before 2026-09-22; the report reads such a row as ladder when its mode is lobby.',
      mode: 'The run mode. Always lobby in this file.',
      heroId: 'The hero the player picked.',
      heroOffer: 'The three heroes the picker offered.',
      won: 'True when the run won the lobby (placement 1).',
      wins: 'Combat rounds won during the run.',
      placement: 'Final lobby placement, 1 (won) to 8 (first eliminated).',
      offeredQuests: 'Quest ids offered (quests are retired content; usually empty).',
      pickedQuests: 'Quest ids taken.',
      questTurns: 'Completed quest id to turns it took.',
      offeredRunes: 'Rune ids offered by the Runeforge this run (deduplicated).',
      pickedRunes: 'Rune ids the player took.',
      offeredCards: 'Every tavern sighting this run, one entry per fresh shop offer (NOT deduplicated).',
      boughtCards: 'Every tavern purchase this run, one entry per buy.',
      discoverOfferedCards: 'Every option shown in a Discover (three per Discover), one entry each.',
      discoverBoughtCards: 'Every Discover pick, one entry each.',
      tierByWave: 'Shop tier at the end of each wave; index = wave (index 0 unused).',
      buyEvents: 'Every acquisition with the wave it happened on and its source (shop or discover).',
    },
    derived: {
      about: 'One object per exported run that carries a derived payload, keyed to runs by rowId. Observed live as the run was played: the offer-by-offer, Gold-by-Gold event streams. Card ids carry a rev (that card\'s content revision at the time).',
      rowId: 'The run_telemetry row id this payload belongs to.',
      contentRevision: 'The content revision the run was played under.',
      heroId: 'The hero.',
      mode: 'The run mode.',
      setId: 'The card set stamp (absent on payloads before 2026-09-22).',
      source: 'What produced the run (absent on payloads before 2026-09-22).',
      seed: 'The run seed.',
      finalWave: 'The last wave reached.',
      wins: 'Scored round wins.',
      won: 'True when the run won the lobby.',
      diverged: 'True when the streams are partial and must not be pooled.',
      offers: 'One row per individual card copy offered in the tavern: wave, slot (0 to 6 left to right, or spell for the spell slot), cardId, rev, shopTier, cardTier, cost, gold (the player\'s Gold at the offer), maxGold, upgradeCost, resolve (health), boardSize, boardAttack, boardHealth, bought (did the player buy this copy), goldAfter, frozen, topTribe (the board\'s most common tribe at the time).',
      acquisitions: 'One row per card that entered the player\'s possession: cardId, rev, wave, source (shop, discover, quest, rune, heroPower, henchman, generated), goldPaid, played, playedWave, soldWave, sellValue, finalBoard (survived to the final board), golden (gilded).',
      gold: 'One row per Gold movement: wave, amount (negative = spent), category (minion, spell, ruby, refresh, upgrade, heroPower, rune, henchman, sell, income, other), sourceCard, goldAfter, maxGoldAfter.',
      upgrades: 'One row per turn a shop tier-up was available: wave, fromTier, toTier, cost, taken, goldBefore, goldAfter, resolve, prevResult (the previous combat: win, loss, draw), boardSize, boardAttack, boardHealth, cardsBoughtThisTurn.',
      combats: 'One row per combat: wave, result, damage dealt to the loser, attacks, friendlyDeaths, enemyDeaths, summons, spellCasts, beats (event count, a proxy for fight length), boardSize, boardAttack, boardHealth, shopTier, triggers (per-keyword trigger counts).',
      triggers: 'One row per threshold engine (Avenge) that entered a combat: wave, cardId, rev, keyword, threshold, deathsAvailable, triggers, diedBeforeTrigger, failure (insufficientDeaths or diedEarly).',
      boards: 'End-of-shop board snapshots: wave, tier, cards (id, rev, pos, attack, health, golden), totalAttack, totalHealth, goldSpentThisTurn.',
      playerActions: 'Number of player decisions taken over the run.',
    },
  };
}

/**
 * Build the whole-dataset export from the report's FILTERED rows — the same rows the panel renders — plus
 * the run metadata. Pure; the panel stringifies and downloads it, the tests assert on it.
 */
export function buildBalanceExport(
  rows: RunTelemetryRow[],
  info: { activeSet: { id: SetId; name: string }; appVersion: string; generatedAt: string; contentRevision: string; counts: ReportFilterCounts; filters: string[] },
): BalanceExport {
  const report = aggregatePlayerReport(rows);
  const impact = cardImpact(rows);
  const minions = impact.filter((r) => !r.spell);
  const spells = impact.filter((r) => r.spell);
  const runes = runeImpact(rows);
  const derivedRuns = rows.filter((r) => r.derived != null).map((r) => ({ rowId: r.id, ...r.derived! }));
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
  return {
    meta: {
      generatedAt: info.generatedAt,
      appVersion: info.appVersion,
      activeSet: info.activeSet,
      contentRevision: info.contentRevision,
      patches,
      dateRange: { oldest: dates[0] ?? null, newest: dates[dates.length - 1] ?? null },
      counts: { ...info.counts, exportedRuns: rows.length, exportedDerived: derivedRuns.length, heroes: new Set(rows.map((r) => r.heroId)).size },
      filters: info.filters,
      sampleGates: SAMPLE_GATES,
    },
    readme: exportReadme(),
    aggregates: {
      report,
      impact: { minions, spells },
      byTier: { minions: impactGroups(minions, 'tier'), spells: impactGroups(spells, 'tier') },
      byTribe: { minions: impactGroups(minions, 'tribe'), spells: impactGroups(spells, 'tribe') },
      heroImpact: heroImpact(rows),
      runeImpact: runes,
      byForge: runeGroups(runes),
      tierImpact: tierImpact(rows),
      economy: goldEconomy(rows),
      upgrades: upgradeShape(derivedRuns),
    },
    cards,
    heroes,
    runes: runeNames,
    runs: rows.map(toExportedRun),
    derived: derivedRuns,
  };
}
