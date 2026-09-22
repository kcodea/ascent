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
 *  · `cardImpact` — the per-card overpowered / underpowered read: per-RUN sample sizes, shop and Discover
 *    conversion, placement and the placement DELTA against the report-wide baseline, with intervals + gates.
 *  · `impactGroups` — the same rows rolled up per tier / per tribe (which tier over- or under-performs).
 *  · `buildBalanceExport` — the whole dataset as ONE self-describing JSON object (meta + readme + aggregates +
 *    raw rows + derived streams + the id → name dictionaries an AI needs to read it without the codebase).
 */
import { CARD_INDEX, RUNE_INDEX, type SetId } from '@game/content';
import { HEROES } from './heroes';
import { cardDemand, goldCurve, upgradeShape, wilson, SAMPLE_GATES, type CardDemand, type DerivedRun, type GoldWaveRow, type UpgradeWaveRow } from './runDerive';
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

/** One card's overpowered / underpowered read. Rates are whole percents (null = no denominator); placements
 *  are 1-dp; the delta and its interval are 2-dp. The UI prints these numbers as they are, so the screen and
 *  the export can never disagree. */
export interface CardImpactRow {
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
  /** Placement, over buyer runs that carry a placement. */
  placedN: number;
  avgPlace: number | null;
  firstRate: number | null;
  top4Rate: number | null;
  lastRate: number | null;
  /** 95% Wilson interval on the top-4 rate, whole percents. */
  top4Ci: { lo: number; hi: number } | null;
  /** The baseline: every OTHER placed run in the report (runs that did not buy the card). */
  baselineN: number;
  baselineAvgPlace: number | null;
  /** avgPlace(buyers) minus avgPlace(non-buyers). NEGATIVE = buyers finish better than the field. */
  delta: number | null;
  /** The delta minus the average delta of the card's TIER (same kind: minions against minions, spells against
   *  spells; weighted by placed buyer runs). A high tier is bought only by runs that lived long enough to reach
   *  it, so a whole tier reads negative; this is the within-tier read that shows who actually stands out. */
  tierDelta: number | null;
  /** 95% interval on the delta (pooled-variance normal approximation on the difference of two means). */
  deltaCi: { lo: number; hi: number } | null;
  /** The delta SHRUNK toward zero for a small sample: delta × n / (n + preliminary gate), n = placed buyer runs.
   *  A card keeps half its delta at 20 placed buyer runs and most of it past 100, so a 2-run outlier can never
   *  top the list. The default sort. Explainable in one sentence, which a t-statistic is not. */
  impact: number | null;
  /** Mean wave of acquisition, from the wave-tagged buy events (null pre-migration). */
  avgBuyWave: number | null;
  gate: SampleGate;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;
const r2 = (n: number): number => Math.round(n * 100) / 100;
const pctOf = (n: number, d: number): number | null => (d > 0 ? Math.round((100 * n) / d) : null);
const Z95 = 1.96;

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
  let allN = 0, allSum = 0, allSumSq = 0;
  for (const r of rows) {
    if (r.placement != null) { allN++; allSum += r.placement; allSumSq += r.placement * r.placement; }
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
    const n = a.places.length;
    const sum = a.places.reduce((s, p) => s + p, 0);
    const sumSq = a.places.reduce((s, p) => s + p * p, 0);
    const avg = n > 0 ? sum / n : null;
    const otherN = allN - n;
    const otherSum = allSum - sum;
    const otherAvg = otherN > 0 ? otherSum / otherN : null;
    let delta: number | null = null, deltaCi: { lo: number; hi: number } | null = null, impact: number | null = null;
    if (avg != null && otherAvg != null) {
      delta = avg - otherAvg;
      impact = delta * (n / (n + SAMPLE_GATES.preliminary));
      if (n >= 2 && otherN >= 2) {
        // POOLED sample variance across the two groups (the other group's from the pool minus the buyers): a
        // two-buyer group whose both buyers placed 1st has a sample variance of zero, and a per-group (Welch)
        // error bar then collapses to nothing for exactly the rows that deserve the widest one.
        const varB = Math.max(0, (sumSq - n * avg * avg) / (n - 1));
        const varO = Math.max(0, ((allSumSq - sumSq) - otherN * otherAvg * otherAvg) / (otherN - 1));
        const pooled = ((n - 1) * varB + (otherN - 1) * varO) / (n + otherN - 2);
        const se = Math.sqrt(pooled * (1 / n + 1 / otherN));
        deltaCi = { lo: r2(delta - Z95 * se), hi: r2(delta + Z95 * se) };
      }
    }
    const top4 = a.places.filter((p) => p <= 4).length;
    const ci = wilson(top4, n);
    out.push({
      id, name: def.name, spell: !!def.spell, tier: def.tier, tribe: def.tribe, tribe2: def.tribe2 ?? null,
      runsSeen: a.runsSeen, runsBought: a.runsBought,
      shopSeen: a.shopSeen, shopBought: a.shopBought, shopBuyRate: pctOf(a.shopBought, a.shopSeen),
      discSeen: a.discSeen, discBought: a.discBought, discRate: pctOf(a.discBought, a.discSeen),
      placedN: n,
      avgPlace: avg == null ? null : r1(avg),
      firstRate: pctOf(a.places.filter((p) => p === 1).length, n),
      top4Rate: pctOf(top4, n),
      lastRate: pctOf(a.places.filter((p) => p >= 8).length, n),
      top4Ci: ci ? { lo: Math.round(ci.lo * 100), hi: Math.round(ci.hi * 100) } : null,
      baselineN: otherN,
      baselineAvgPlace: otherAvg == null ? null : r1(otherAvg),
      delta: delta == null ? null : r2(delta),
      tierDelta: null, // filled below, once every card's delta is known
      deltaCi,
      impact: impact == null ? null : r2(impact),
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
  // Default order: impact ascending (the strongest, best-supported buyer advantage first); rows without one
  // sink, then by name so the order is stable.
  out.sort((x, y) => {
    if (x.impact == null && y.impact == null) return x.name.localeCompare(y.name);
    if (x.impact == null) return 1;
    if (y.impact == null) return -1;
    return x.impact - y.impact || x.name.localeCompare(y.name);
  });
  return out;
}

/** A tier or tribe rolled up from its cards' impact rows. `delta` and `avgPlace` are weighted by each card's
 *  placed buyer runs, so a tier's delta reads "the average buyer of a card in this tier finishes this much
 *  better (negative) or worse (positive) than the field". */
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

export function impactGroups(rows: CardImpactRow[], by: 'tier' | 'tribe'): ImpactGroupRow[] {
  const groups = new Map<string, { label: string; cards: number; runsBought: number; placedN: number; placeW: number; deltaN: number; deltaW: number }>();
  const add = (key: string, label: string, r: CardImpactRow): void => {
    let g = groups.get(key);
    if (!g) { g = { label, cards: 0, runsBought: 0, placedN: 0, placeW: 0, deltaN: 0, deltaW: 0 }; groups.set(key, g); }
    g.cards++;
    g.runsBought += r.runsBought;
    g.placedN += r.placedN;
    if (r.avgPlace != null) g.placeW += r.avgPlace * r.placedN;
    if (r.delta != null) { g.deltaN += r.placedN; g.deltaW += r.delta * r.placedN; }
  };
  for (const r of rows) {
    if (by === 'tier') add(String(r.tier), `T${r.tier}`, r);
    else {
      add(r.tribe, cap(r.tribe), r);
      if (r.tribe2) add(r.tribe2, cap(r.tribe2), r); // a dual-tribe card counts for both
    }
  }
  const out = [...groups.entries()].map(([key, g]): ImpactGroupRow => ({
    key, label: g.label, cards: g.cards, runsBought: g.runsBought, placedN: g.placedN,
    avgPlace: g.placedN > 0 ? r1(g.placeW / g.placedN) : null,
    delta: g.deltaN > 0 ? r2(g.deltaW / g.deltaN) : null,
  }));
  out.sort((a, b) => (by === 'tier' ? Number(a.key) - Number(b.key) : a.label.localeCompare(b.label)));
  return out;
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
    demand: CardDemand[];
    economy: GoldWaveRow[];
    upgrades: UpgradeWaveRow[];
  };
  cards: Record<string, { name: string; tier: number; tribe: string; tribe2: string | null; spell: boolean; token: boolean }>;
  heroes: Record<string, string>;
  runes: Record<string, string>;
  runs: ExportedRun[];
  derived: (DerivedRun & { rowId: number | null })[];
}

const heroNameOf = (id: string): string => HEROES.find((h) => h.id === id)?.name ?? id;

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
    howToRead: 'Start with aggregates.impact.minions (and .spells), already ordered by impact: each row is one card with its sample size and its placement delta. A NEGATIVE delta means runs that bought the card finished better (lower placement) than runs that did not, so the card is a candidate for overpowered; a POSITIVE delta means underpowered. Trust rows in proportion to placedN and read the gate; impact is the delta already discounted for a thin sample. Cross-check with shopBuyRate (do players want it) and top4Rate. Then use runs and derived for anything the tables do not answer.',
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
      report: 'The classic report tables. heroes / runes / quests: per id, offered = runs it was offered in, picked = runs that took it, games = runs played with it, offerRate / pickRate / winRate = whole percents (-1 = no data), avgWins = average round wins per run (heroes), avgTurns = turns to complete (quests), avgPlace / firstRate / lastRate / placedGames = placement stats over placed runs that took it. minions / spells: offered and picked are RAW COUNTS of sightings and buys (a card seen four times in one run counts four), split into shopOffered / shopPicked (the tavern) and discoverOffered / discoverPicked (Discover picks); avgPlace here is credited PER ACQUISITION (a run that bought a card three times contributes three finishes), which is why it can differ from impact.avgPlace. shopCurve: the average shop tier reached by wave for won vs lost runs, by placement, and the average wave each tier is first reached.',
      impact: 'The overpowered / underpowered table, PER RUN. Columns: runsSeen = runs that saw the card anywhere; runsBought = runs that acquired it anywhere (a run counts once however many copies); shopSeen / shopBought / shopBuyRate = raw tavern sightings, buys and buys as a percent of sightings; discSeen / discBought / discRate = the same for Discover offers; placedN = buyer runs with a placement; avgPlace = their mean placement (1 best, 8 worst); firstRate / top4Rate / lastRate = percent of buyer runs finishing 1st, in the top 4, 8th; top4Ci = 95% Wilson interval on top4Rate; baselineN / baselineAvgPlace = every other placed run and its mean placement; delta = avgPlace minus baselineAvgPlace (negative = buyers finish better than the field); tierDelta = delta minus the average delta of the card\'s tier (minions against minions, spells against spells), the within-tier read, because a high tier is bought only by runs that survived long enough to reach it and so reads negative as a whole; deltaCi = 95% interval on the delta (pooled-variance normal approximation on the difference of two means); impact = the delta shrunk toward zero for a small sample, delta times placedN / (placedN + 20), so a card keeps half its delta at 20 placed buyer runs and most of it past 100 (the default order: the strongest, best-supported buyer advantage first); avgBuyWave = mean wave the card was acquired on; gate = the sample band of runsBought.',
      byTier: 'impact rolled up per shop tier (T1 to T7): cards = cards of that tier seen in the data, runsBought and placedN summed, avgPlace and delta weighted by each card\'s placed buyer runs.',
      byTribe: 'impact rolled up per tribe, the same way. A dual-tribe card counts for both tribes.',
      demand: 'Per card AND content revision (rev), from the derived streams: copiesOffered / copiesBought = individual copies offered in a tavern and bought; copyConversion = their ratio; shopsWithCard / shopsConverted / shopConversion = tavern turns showing the card and turns that led to a buy; runsOffered / runsAcquired / runAcquisitionRate = runs offered it and runs that got it by any source; copiesPerShopAppearance; bySource = acquisitions by source (shop, discover, quest, rune, heroPower, henchman, generated); acquisitions = total; playRate = share of acquisitions ever played to the board; finalBoardRate = share still on the final board; avgAcquiredWave. Rates are fractions 0 to 1.',
      economy: 'Per wave, the mean Gold moved per run that reached the wave: income, and spends by category (minion, spell, refresh, upgrade, heroPower, rune, sell is Gold recovered by selling).',
      upgrades: 'Per wave: turns where a shop tier-up was available (offered), taken, takeRate (fraction), avgCost, and the take rate specifically after a lost combat (afterLossTakeRate, afterLossN).',
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
      setId: 'The raw set stamp, null on runs recorded before 2026-09-22.',
      source: 'What produced the row: ladder for a real lobby run. Null on rows recorded before 2026-09-22 (all ladder by construction).',
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
  const runes: Record<string, string> = {};
  for (const id of [...runeIds].sort()) runes[id] = RUNE_INDEX[id]?.name ?? id;
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
      demand: cardDemand(derivedRuns),
      economy: goldCurve(derivedRuns),
      upgrades: upgradeShape(derivedRuns),
    },
    cards,
    heroes,
    runes,
    runs: rows.map(toExportedRun),
    derived: derivedRuns,
  };
}
