/**
 * THE BALANCE REPORT'S COHORT MATH (owner ask 2026-09-22, the "honest associations" pass): everything the
 * report needs beyond the raw buyer association, PURE over the fetched rows so the panel, the export and the
 * tests run one code path.
 *
 * The problem this file answers (the owner's audit handoff, 2026-09-22): the raw buyer association compares a
 * card's buyers with EVERY other run, and a run that was eliminated on wave 4 never had the chance to see, afford
 * or buy a wave-12 card. Survival and card access read as card power. Nothing here makes the observational data
 * causal; each helper just narrows the comparison to runs that had the decision, says how many runs support it,
 * and refuses to print a number the data does not carry ("insufficient comparable data" is a valid output).
 *
 *  · `segmentByWave` / `segmentRun` — the LAST run of a stacked derived payload. A live payload can carry earlier
 *    runs of the same browser session in front of its own (the wave number drops back to 1 where the next run
 *    began; 51 of the 110 live Set 2 payloads did on 2026-09-22, and the FLAT card arrays stack the same way).
 *    Every cohort below reads the last segment, so a buyer run is a run that bought the card in THAT run.
 *  · `exposedDiagnostic` — both sides restricted to runs that SAW the card: buyers against exposed skippers. A
 *    diagnostic, never the adjusted estimate: a sighting at any time is not a comparable decision.
 *  · `shopEpisodesOf` / `adjustedAssociation` — the opportunity-based read: one primary observation per run per
 *    card (the first affordable Shop offer wave before any prior acquisition), buy versus pass inside that wave,
 *    stratified on round band x Shop tier, buyers weighted, only strata that hold both a buyer and a skipper.
 *  · `welchInterval` — the unequal-variance interval on the metric actually displayed, suppressed under a
 *    documented minimum per side (`WELCH_MIN_N`), because a two-run group whose both runs won has zero variance
 *    and would print the narrowest interval on exactly the worst row.
 *  · `evidenceLabel` — driven by BOTH group sizes and the unique players behind them. None of the labels means
 *    "confirmed overpowered".
 *  · `tierDecisions` — shop tier-ups as decisions: runs that could afford the tier-up at the same round band with
 *    similar spare Gold, took against declined.
 *  · `dataQuality` / `sanitizeRows` / `epochsOf` — the integrity counts the evidence banner and the export meta
 *    print, and the balance-epoch (content revision) filter.
 *
 * Analytics only: no gameplay RNG, no card, hero, rune or economy change, no bot data.
 */
import type { AcquisitionEvent, BoardSnapshotLite, DerivedRun, GoldEvent, OfferEvent, UpgradeEvent } from './runDerive';
import type { RunTelemetry } from './runTelemetry';

// ── The row the cohorts read ───────────────────────────────────────────────────────────────────────────────

/** A telemetry row with the pieces the cohorts need beyond the flat summary: the derived streams (when the row
 *  carries them), the row id, the player's display name and the content revision. `RunTelemetryRow` satisfies
 *  it; a plain `RunTelemetry` does too (every extra field is optional), so the raw tables keep their fixtures. */
export type CohortRow = RunTelemetry & {
  id?: number | null;
  author?: string | null;
  contentRevision?: string | null;
  createdAt?: string | null;
  derived?: DerivedRun | null;
};

/** The pseudonymous player key of a row, or null when the row has none. The DEFAULT is the display name, a
 *  labelled PROXY (the export and the panel both say "display names, not accounts"): a scoped pseudonymous key
 *  needs a trusted path (a server-side hash of `user_id`, see the export's `playerKey` note) that does not exist
 *  yet. The key itself is never written into any table or the export; only distinct counts are. */
export type PlayerKeyOf = (row: CohortRow) => string | null;
export const displayNameKey: PlayerKeyOf = (row) => row.author ?? null;

/** Distinct non-null keys; null when NO key was available at all (so the banner prints n/a, never 0). */
export function uniquePlayers(keys: Iterable<string | null>): number | null {
  const set = new Set<string>();
  let any = false;
  for (const k of keys) { if (k != null) { any = true; set.add(k); } }
  return any ? set.size : null;
}

/** A valid placement: an integer 1 to 8. Anything else never counts toward a placement finding. */
export const validPlacement = (p: unknown): p is number => typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 8;

// ── Stacked streams: the last segment ──────────────────────────────────────────────────────────────────────

/** The rows after the LAST drop in `wave`: the run the payload was uploaded for. A stream with no drop is
 *  returned as is (same reference), so an already-clean payload costs nothing. */
export function segmentByWave<T extends { wave: number }>(arr: T[]): T[] {
  let start = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i]!.wave < arr[i - 1]!.wave) start = i;
  return start === 0 ? arr : arr.slice(start);
}

export interface SegmentedRun {
  offers: OfferEvent[];
  acquisitions: AcquisitionEvent[];
  gold: GoldEvent[];
  upgrades: UpgradeEvent[];
  boards: BoardSnapshotLite[];
  /** True when any stream carried an earlier run in front of this one. */
  stacked: boolean;
}

/** The derived streams of the uploaded run only. `combats` never stack (the observer dedupes them per wave)
 *  and are read from the payload directly. */
export function segmentRun(d: DerivedRun): SegmentedRun {
  const offers = segmentByWave(d.offers);
  const acquisitions = segmentByWave(d.acquisitions);
  const gold = segmentByWave(d.gold);
  const upgrades = segmentByWave(d.upgrades);
  const boards = segmentByWave(d.boards);
  return {
    offers, acquisitions, gold, upgrades, boards,
    stacked: offers !== d.offers || acquisitions !== d.acquisitions || gold !== d.gold || upgrades !== d.upgrades || boards !== d.boards,
  };
}

/** A usable derived payload: present and not diverged. */
export const usableDerived = (row: CohortRow): DerivedRun | null => (row.derived && !row.derived.diverged ? row.derived : null);

// ── Welch's interval ───────────────────────────────────────────────────────────────────────────────────────

export interface Interval { lo: number; hi: number }

/** The minimum runs on EACH side before a Welch interval is printed. Under it the interval is suppressed
 *  (null), never collapsed: a two-run group whose both runs placed 1st has a sample variance of zero. */
export const WELCH_MIN_N = 5;

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs: number[], m: number): number => (xs.length < 2 ? 0 : Math.max(0, xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1)));

/** The 0.975 quantile of Student's t with `df` degrees of freedom: the Cornish-Fisher expansion around the
 *  normal quantile (Abramowitz and Stegun 26.7.5), within 0.01 of the table from df 4 upward, which is where
 *  `WELCH_MIN_N` puts every interval this file prints. */
export function tQuantile975(df: number): number {
  const z = 1.959964;
  if (!Number.isFinite(df) || df <= 0) return z;
  const z2 = z * z, z3 = z2 * z, z5 = z3 * z2, z7 = z5 * z2, z9 = z7 * z2;
  return z
    + (z3 + z) / (4 * df)
    + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df)
    + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df * df * df)
    + (79 * z9 + 776 * z7 + 1482 * z5 - 1920 * z3 - 945 * z) / (92160 * df * df * df * df);
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Welch's 95% interval on mean(a) minus mean(b): per-group variances, Welch-Satterthwaite degrees of freedom,
 *  a t quantile. Null under `minN` on either side. When both variances are zero the interval is the point. */
export function welchInterval(a: number[], b: number[], minN = WELCH_MIN_N): Interval | null {
  if (a.length < minN || b.length < minN || a.length < 2 || b.length < 2) return null;
  const ma = mean(a), mb = mean(b);
  const va = variance(a, ma) / a.length, vb = variance(b, mb) / b.length;
  const d = ma - mb;
  const se2 = va + vb;
  if (se2 === 0) return { lo: r2(d), hi: r2(d) };
  const df = (se2 * se2) / ((va * va) / (a.length - 1) + (vb * vb) / (b.length - 1));
  const t = tQuantile975(df);
  const se = Math.sqrt(se2);
  return { lo: r2(d - t * se), hi: r2(d + t * se) };
}

// ── Evidence ───────────────────────────────────────────────────────────────────────────────────────────────

/** How much to trust a comparison. `insufficient` = either side, or the players behind them, under the
 *  candidate gate; `candidate` = worth a look; `supported` = the association is supported by the data at hand.
 *  NONE of them means confirmed overpowered or underpowered: the comparisons are observational. */
export type EvidenceLabel = 'insufficient' | 'candidate' | 'supported';

/** The gates: runs on EACH side of the comparison, and the unique players on the smaller side. With the
 *  display-name proxy a player count is an upper bound on accounts, so `supported` needs five of them and is
 *  never reached when no key exists (players = null). Tuning policy, not a guarantee of validity. */
export const EVIDENCE_GATES = {
  candidate: { side: 10, players: 3 },
  supported: { side: 20, players: 5 },
} as const;

export function evidenceLabel(sideA: number, sideB: number, players: number | null): EvidenceLabel {
  const side = Math.min(sideA, sideB);
  const p = players ?? 0;
  if (side >= EVIDENCE_GATES.supported.side && p >= EVIDENCE_GATES.supported.players) return 'supported';
  if (side >= EVIDENCE_GATES.candidate.side && p >= EVIDENCE_GATES.candidate.players) return 'candidate';
  return 'insufficient';
}

// ── Data quality ───────────────────────────────────────────────────────────────────────────────────────────

export interface DataQuality {
  /** Rows the counts below were taken over (after the set / ladder / epoch / window filters). */
  rows: number;
  /** Rows with no placement at all, and rows whose placement is not an integer 1 to 8 (cleared, never counted
   *  as placed). */
  placementMissing: number;
  placementMalformed: number;
  /** Rows sharing a row id with an earlier row (dropped by `sanitizeRows`, the first kept). */
  duplicateIds: number;
  /** Rows with a derived payload; among them, diverged payloads and payloads whose streams carried earlier runs
   *  of the same session (read by their last segment). */
  withDerived: number;
  diverged: number;
  stackedStreams: number;
  /** Rows whose replay-derived `tierByWave` does not span the live `finalWave`: the flat tier table and shop
   *  curve are unreliable for these. */
  replayDisagree: number;
  /** Rows whose hero picker trio was not recorded (they cannot enter an offered-not-chosen comparison). */
  heroOfferMissing: number;
  /** Rows with no content revision stamp (they form the `unknown` epoch). */
  revisionMissing: number;
}

export function dataQuality(rows: CohortRow[]): DataQuality {
  const q: DataQuality = { rows: rows.length, placementMissing: 0, placementMalformed: 0, duplicateIds: 0, withDerived: 0, diverged: 0, stackedStreams: 0, replayDisagree: 0, heroOfferMissing: 0, revisionMissing: 0 };
  const ids = new Set<number>();
  for (const r of rows) {
    if (r.placement == null) q.placementMissing++;
    else if (!validPlacement(r.placement)) q.placementMalformed++;
    if (r.id != null) { if (ids.has(r.id)) q.duplicateIds++; else ids.add(r.id); }
    if (r.derived) {
      q.withDerived++;
      if (r.derived.diverged) q.diverged++;
      else if (segmentRun(r.derived).stacked) q.stackedStreams++;
      if (r.tierByWave.length - 1 !== r.derived.finalWave) q.replayDisagree++;
    }
    if (r.heroOffer.length === 0) q.heroOfferMissing++;
    if (!r.contentRevision) q.revisionMissing++;
  }
  return q;
}

/** Drop duplicate row ids (the first occurrence, the newest, is kept) and clear any placement that is not an
 *  integer 1 to 8, so a malformed value can never count toward a placement finding. Counts what it did. */
export function sanitizeRows<T extends CohortRow>(rows: T[]): { rows: T[]; duplicateIds: number; placementMalformed: number } {
  const out: T[] = [];
  const ids = new Set<number>();
  let duplicateIds = 0, placementMalformed = 0;
  for (const r of rows) {
    if (r.id != null) { if (ids.has(r.id)) { duplicateIds++; continue; } ids.add(r.id); }
    if (r.placement != null && !validPlacement(r.placement)) { placementMalformed++; out.push({ ...r, placement: undefined }); continue; }
    out.push(r);
  }
  return { rows: out, duplicateIds, placementMalformed };
}

// ── Balance epochs ─────────────────────────────────────────────────────────────────────────────────────────

/** A balance epoch is a content revision (one hash over every card, rune and quest definition). A row with no
 *  stamp belongs to `UNKNOWN_EPOCH`. An epoch is the FILTER of the report, never a stratum: with 24 revisions
 *  over 110 runs an exact-match stratum would empty every comparison. */
export const UNKNOWN_EPOCH = 'unknown';
export const ALL_EPOCHS = 'all';
/** The runs an epoch needs before it is read on its own; under it the report says "insufficient current data"
 *  and offers the historical toggle instead of pooling older revisions silently. */
export const EPOCH_MIN_RUNS = 20;

export interface EpochInfo { rev: string; runs: number; oldest: string | null; newest: string | null }

export const epochOf = (row: Pick<CohortRow, 'contentRevision'>): string => row.contentRevision || UNKNOWN_EPOCH;

/** The epochs in the rows, newest first (by the newest run of each). */
export function epochsOf(rows: CohortRow[]): EpochInfo[] {
  const acc = new Map<string, EpochInfo>();
  for (const r of rows) {
    const rev = epochOf(r);
    let e = acc.get(rev);
    if (!e) { e = { rev, runs: 0, oldest: null, newest: null }; acc.set(rev, e); }
    e.runs++;
    const d = r.createdAt ?? null;
    if (d) {
      if (!e.oldest || d < e.oldest) e.oldest = d;
      if (!e.newest || d > e.newest) e.newest = d;
    }
  }
  return [...acc.values()].sort((a, b) => (b.newest ?? '').localeCompare(a.newest ?? '') || b.runs - a.runs);
}

/** The default epoch: the build's own content revision when the rows carry it, else the newest revision in the
 *  rows, else `ALL_EPOCHS` when there are no rows at all. Whether the choice has enough runs is the caller's
 *  check (`EPOCH_MIN_RUNS`); this never falls back to pooling. */
export function defaultEpoch(epochs: EpochInfo[], buildRevision: string): string {
  if (epochs.some((e) => e.rev === buildRevision)) return buildRevision;
  return epochs[0]?.rev ?? ALL_EPOCHS;
}

/** The data window and epoch a report reads, shared by the panel and the export's meta. */
export interface ReportScope {
  /** A content revision, `UNKNOWN_EPOCH`, or `ALL_EPOCHS` (every revision, the historical read). */
  epoch: string;
  /** ISO date bounds on `createdAt` (inclusive by calendar day), or null for open. */
  from: string | null;
  to: string | null;
}

export const inScope = (row: CohortRow, scope: ReportScope): boolean => {
  if (scope.epoch !== ALL_EPOCHS && epochOf(row) !== scope.epoch) return false;
  const day = (row.createdAt ?? '').slice(0, 10);
  if (scope.from && day && day < scope.from) return false;
  if (scope.to && day && day > scope.to) return false;
  return true;
};

// ── Per-run facts ──────────────────────────────────────────────────────────────────────────────────────────

/** One run's card facts, computed ONCE per run so the per-card loops below never re-walk the streams. */
export interface RunFacts {
  placement: number | null;
  key: string | null;
  /** The flat (upload-time) sets: every sighting and acquisition in the row, shop and Discover together. These
   *  can carry earlier runs of the session; they are what the raw table and the handoff's diagnostic read. */
  flatSeen: Set<string>;
  flatBought: Set<string>;
  /** The last-segment derived sets, or null when the row has no usable payload. Exposure is the shop only (the
   *  derived streams carry no Discover offers); acquisition is shop or Discover. */
  segSeen: Set<string> | null;
  segBought: Set<string> | null;
  seg: SegmentedRun | null;
  finalWave: number | null;
  /** Combat result per wave, for the next-combat read. */
  combatByWave: Map<number, 'win' | 'loss' | 'draw'>;
}

export function runFacts(row: CohortRow, keyOf: PlayerKeyOf = displayNameKey): RunFacts {
  const d = usableDerived(row);
  const seg = d ? segmentRun(d) : null;
  const combatByWave = new Map<number, 'win' | 'loss' | 'draw'>();
  if (d) for (const c of d.combats) combatByWave.set(c.wave, c.result);
  return {
    placement: validPlacement(row.placement) ? row.placement : null,
    key: keyOf(row),
    flatSeen: new Set([...row.offeredCards, ...(row.discoverOfferedCards ?? [])]),
    flatBought: new Set([...row.boughtCards, ...(row.discoverBoughtCards ?? [])]),
    segSeen: seg ? new Set(seg.offers.map((o) => o.cardId)) : null,
    segBought: seg ? new Set(seg.acquisitions.filter((a) => a.source === 'shop' || a.source === 'discover').map((a) => a.cardId)) : null,
    seg,
    finalWave: d ? d.finalWave : null,
    combatByWave,
  };
}

// ── The exposed-run diagnostic ─────────────────────────────────────────────────────────────────────────────

/** Buyers against exposed skippers, both sides restricted to runs that saw the card. `notExposedBuyers` = placed
 *  buyer runs with no recorded sighting (a coverage mismatch, reported rather than repaired). */
export interface ExposedStats {
  buyers: number;
  skippers: number;
  buyerAvg: number | null;
  skipperAvg: number | null;
  /** buyerAvg minus skipperAvg. Negative = buyers finished better than the runs that saw it and passed. */
  delta: number | null;
  /** Welch 95% on that delta; null under `WELCH_MIN_N` a side. */
  ci: Interval | null;
  notExposedBuyers: number;
  buyerPlayers: number | null;
  skipperPlayers: number | null;
}

const r4 = (n: number): number => Math.round(n * 10000) / 10000;

export function exposedStats(buyerPlaces: number[], skipperPlaces: number[], notExposedBuyers: number, buyerKeys: (string | null)[], skipperKeys: (string | null)[]): ExposedStats {
  const bAvg = buyerPlaces.length ? mean(buyerPlaces) : null;
  const sAvg = skipperPlaces.length ? mean(skipperPlaces) : null;
  return {
    buyers: buyerPlaces.length, skippers: skipperPlaces.length,
    buyerAvg: bAvg == null ? null : r4(bAvg), skipperAvg: sAvg == null ? null : r4(sAvg),
    delta: bAvg == null || sAvg == null ? null : r4(bAvg - sAvg),
    ci: welchInterval(buyerPlaces, skipperPlaces),
    notExposedBuyers,
    buyerPlayers: uniquePlayers(buyerKeys), skipperPlayers: uniquePlayers(skipperKeys),
  };
}

/** The diagnostic per card over `facts`. `basis` = `flat` reads the upload-time arrays (the handoff's section-2
 *  definition, reproducible against the audited export; a sighting or a buy in an EARLIER run of the same
 *  session counts, because those arrays stack); `segmented` reads the last-segment derived streams (this run
 *  only; rows without a usable payload are left out and counted in `excluded`). */
export function exposedDiagnostic(facts: RunFacts[], basis: 'flat' | 'segmented'): { byCard: Map<string, ExposedStats>; runs: number; excluded: number } {
  type Acc = { buyers: number[]; skippers: number[]; notExposed: number; bKeys: (string | null)[]; sKeys: (string | null)[] };
  const acc = new Map<string, Acc>();
  const get = (id: string): Acc => { let a = acc.get(id); if (!a) { a = { buyers: [], skippers: [], notExposed: 0, bKeys: [], sKeys: [] }; acc.set(id, a); } return a; };
  let runs = 0, excluded = 0;
  for (const f of facts) {
    const seen = basis === 'flat' ? f.flatSeen : f.segSeen;
    const bought = basis === 'flat' ? f.flatBought : f.segBought;
    if (!seen || !bought) { excluded++; continue; }
    runs++;
    if (f.placement == null) continue; // an unplaced run supports no placement finding on either side
    for (const id of seen) {
      const a = get(id);
      if (bought.has(id)) { a.buyers.push(f.placement); a.bKeys.push(f.key); } else { a.skippers.push(f.placement); a.sKeys.push(f.key); }
    }
    for (const id of bought) if (!seen.has(id)) get(id).notExposed++;
  }
  const byCard = new Map<string, ExposedStats>();
  for (const [id, a] of acc) byCard.set(id, exposedStats(a.buyers, a.skippers, a.notExposed, a.bKeys, a.sKeys));
  return { byCard, runs, excluded };
}

// ── Shop episodes: one primary observation per run per card ────────────────────────────────────────────────

export type RoundBand = 'early' | 'mid' | 'late';
/** Round bands: waves 1 to 4, 5 to 8, 9 and later. */
export const roundBandOf = (wave: number): RoundBand => (wave <= 4 ? 'early' : wave <= 8 ? 'mid' : 'late');

/** One run's primary observation for one card: the first Shop wave the card was on offer AND affordable, before
 *  any prior acquisition of it. `bought` = a copy was bought in that wave; `crossover` = a pass that was
 *  followed by an acquisition of the card in a later wave (reported, never relabelled). */
export interface Episode {
  wave: number;
  shopTier: number;
  bought: boolean;
  crossover: boolean;
  placement: number | null;
  key: string | null;
}

/** Why a run contributed no episode for a card it was offered. */
export interface EpisodeExclusions {
  /** The card was acquired (any source) in a wave before its first affordable offer. */
  priorAcquisition: number;
  /** A non-shop acquisition landed in the same wave as the offer, so buy and grant cannot be told apart. */
  sameWaveGrant: number;
  /** Offer waves skipped because no copy was affordable at sighting (an unaffordable offer is not a rejection). */
  unaffordable: number;
  /** Every offer wave was unaffordable: the run had no episode. */
  neverAffordable: number;
}

const emptyExclusions = (): EpisodeExclusions => ({ priorAcquisition: 0, sameWaveGrant: 0, unaffordable: 0, neverAffordable: 0 });

/**
 * The episode per card for one run. The unit is the WAVE: `OfferEvent` records an offer once, at first sighting,
 * and the derived streams carry no roll or expiry event, so an offer seen twice across a freeze (the `frozen`
 * flag is never set on a live row: a freeze happens after the offers are minted) cannot be told from a single
 * pass. `cost` is the card's base cost and `gold` is the Gold at first sighting (purchase-time on a buy), so
 * "affordable" is approximate both ways: a discount or a later sell can make an offer affordable that reads
 * unaffordable here, and the reverse. Documented in the export readme.
 */
export function shopEpisodesOf(seg: SegmentedRun, placement: number | null, key: string | null): { episodes: Map<string, Episode>; exclusions: Map<string, keyof EpisodeExclusions> ; unaffordableWaves: Map<string, number> } {
  const offersByCard = new Map<string, Map<number, OfferEvent[]>>();
  for (const o of seg.offers) {
    let byWave = offersByCard.get(o.cardId);
    if (!byWave) { byWave = new Map(); offersByCard.set(o.cardId, byWave); }
    (byWave.get(o.wave) ?? byWave.set(o.wave, []).get(o.wave)!).push(o);
  }
  const acqByCard = new Map<string, AcquisitionEvent[]>();
  for (const a of seg.acquisitions) (acqByCard.get(a.cardId) ?? acqByCard.set(a.cardId, []).get(a.cardId)!).push(a);
  const episodes = new Map<string, Episode>();
  const exclusions = new Map<string, keyof EpisodeExclusions>();
  const unaffordableWaves = new Map<string, number>();
  for (const [cardId, byWave] of offersByCard) {
    const acqs = acqByCard.get(cardId) ?? [];
    const waves = [...byWave.keys()].sort((a, b) => a - b);
    let skipped = 0;
    let done = false;
    for (const w of waves) {
      if (acqs.some((a) => a.wave < w)) { exclusions.set(cardId, 'priorAcquisition'); done = true; break; }
      const rows = byWave.get(w)!;
      const bought = rows.some((o) => o.bought) || acqs.some((a) => a.wave === w && a.source === 'shop');
      if (!bought && acqs.some((a) => a.wave === w && a.source !== 'shop')) { exclusions.set(cardId, 'sameWaveGrant'); done = true; break; }
      const affordable = bought || rows.some((o) => o.gold >= o.cost);
      if (!affordable) { skipped++; continue; }
      episodes.set(cardId, { wave: w, shopTier: rows[0]!.shopTier, bought, crossover: !bought && acqs.some((a) => a.wave > w), placement, key });
      done = true;
      break;
    }
    if (skipped > 0) unaffordableWaves.set(cardId, skipped);
    if (!done) exclusions.set(cardId, 'neverAffordable');
  }
  return { episodes, exclusions, unaffordableWaves };
}

// ── The adjusted association ───────────────────────────────────────────────────────────────────────────────

export interface StratumRow { key: string; buyers: number; skippers: number; buyerAvg: number; skipperAvg: number; delta: number }

export interface AdjustedStats {
  /** Placed observations on each side, all strata. */
  buyers: number;
  skippers: number;
  /** Strata seen, and strata that hold both a buyer and a skipper (the only ones that count). */
  strata: number;
  supportedStrata: number;
  buyersInSupport: number;
  skippersInSupport: number;
  /** Placed buyers outside common support as a whole percent of placed buyers (null when no buyers). */
  outsideSupportPct: number | null;
  /** Sum over supported strata of (buyer share of the stratum) x (mean buyer placement minus mean skipper
   *  placement). Negative = buying went with a better finish in the situations buyers were actually in. Null
   *  when no stratum is supported: insufficient comparable data, never zero. */
  association: number | null;
  /** A stratified Welch-type 95% interval on the association: the weighted per-stratum variances, Satterthwaite
   *  degrees of freedom. Null under `WELCH_MIN_N` on either side in support, or when any supported stratum has
   *  a single observation on a side (no variance to read). */
  ci: Interval | null;
  /** Passes followed by a later acquisition of the card (reported; the pass is never relabelled). */
  crossover: number;
  /** The unplaced observations, which support no placement finding. */
  unplaced: number;
  buyerPlayers: number | null;
  skipperPlayers: number | null;
  /** The supported strata, for the export. */
  supported: StratumRow[];
}

export const stratumKey = (e: Pick<Episode, 'wave' | 'shopTier'>): string => `${roundBandOf(e.wave)}:T${e.shopTier}`;

/** The buyer-weighted stratified difference over the supported strata (round band x Shop tier). */
export function adjustedAssociation(episodes: Episode[], keyOf: (e: Episode) => string = stratumKey): AdjustedStats {
  type S = { b: number[]; s: number[]; bKeys: (string | null)[]; sKeys: (string | null)[] };
  const strata = new Map<string, S>();
  let crossover = 0, unplaced = 0, buyers = 0, skippers = 0;
  for (const e of episodes) {
    if (e.crossover) crossover++;
    if (e.placement == null) { unplaced++; continue; }
    if (e.bought) buyers++; else skippers++;
    const k = keyOf(e);
    let s = strata.get(k);
    if (!s) { s = { b: [], s: [], bKeys: [], sKeys: [] }; strata.set(k, s); }
    if (e.bought) { s.b.push(e.placement); s.bKeys.push(e.key); } else { s.s.push(e.placement); s.sKeys.push(e.key); }
  }
  const supported: (StratumRow & { s: S })[] = [];
  for (const [key, s] of strata) {
    if (s.b.length === 0 || s.s.length === 0) continue;
    const bAvg = mean(s.b), sAvg = mean(s.s);
    supported.push({ key, buyers: s.b.length, skippers: s.s.length, buyerAvg: r4(bAvg), skipperAvg: r4(sAvg), delta: r4(bAvg - sAvg), s });
  }
  supported.sort((a, b) => a.key.localeCompare(b.key));
  const nb = supported.reduce((n, x) => n + x.buyers, 0);
  const ns = supported.reduce((n, x) => n + x.skippers, 0);
  let association: number | null = null, ci: Interval | null = null;
  const bKeys: (string | null)[] = [], sKeys: (string | null)[] = [];
  if (nb > 0) {
    let est = 0, se2 = 0, dfDen = 0;
    let intervalOk = nb >= WELCH_MIN_N && ns >= WELCH_MIN_N;
    for (const x of supported) {
      const w = x.buyers / nb;
      est += w * (mean(x.s.b) - mean(x.s.s));
      bKeys.push(...x.s.bKeys); sKeys.push(...x.s.sKeys);
      if (x.buyers < 2 || x.skippers < 2) { intervalOk = false; continue; }
      const vb = (w * w * variance(x.s.b, mean(x.s.b))) / x.buyers;
      const vs = (w * w * variance(x.s.s, mean(x.s.s))) / x.skippers;
      se2 += vb + vs;
      dfDen += (vb * vb) / (x.buyers - 1) + (vs * vs) / (x.skippers - 1);
    }
    association = r4(est);
    if (intervalOk) {
      if (se2 === 0) ci = { lo: r2(est), hi: r2(est) };
      else {
        const t = tQuantile975((se2 * se2) / dfDen);
        const se = Math.sqrt(se2);
        ci = { lo: r2(est - t * se), hi: r2(est + t * se) };
      }
    }
  }
  return {
    buyers, skippers, strata: strata.size, supportedStrata: supported.length,
    buyersInSupport: nb, skippersInSupport: ns,
    outsideSupportPct: buyers > 0 ? Math.round((100 * (buyers - nb)) / buyers) : null,
    association, ci, crossover, unplaced,
    buyerPlayers: uniquePlayers(bKeys), skipperPlayers: uniquePlayers(sKeys),
    supported: supported.map(({ s: _s, ...row }) => row),
  };
}

// ── Per-card cohorts, all at once ──────────────────────────────────────────────────────────────────────────

/** The role-and-timing read of a card from its last-segment acquisitions: descriptive, never causal. */
export interface RoleStats {
  /** Buyer runs (this run only) whose FIRST acquisition of the card fell in each round band. */
  earlyBuyers: number;
  midBuyers: number;
  lateBuyers: number;
  /** Of every acquisition of the card: percent played to the board, percent that survived to the final board,
   *  percent sold. An economy minion doing its job and being sold is not a failure; these are descriptions. */
  playedPct: number | null;
  finalBoardPct: number | null;
  soldPct: number | null;
  /** Percent of acquisitions whose NEXT combat (the same wave) was won, over acquisitions with a recorded one. */
  nextCombatWinPct: number | null;
  acquisitions: number;
}

export interface CardCohorts {
  /** Buyer runs by the last-segment derived acquisitions (shop or Discover), this run only. */
  segmentedBuyers: number;
  /** Distinct player keys among raw buyer runs and raw control runs (placed). */
  buyerPlayers: number | null;
  controlPlayers: number | null;
  /** Card tiers observed on the derived shop offers (a moved tier shows up here; the row's `tier` is current). */
  observedTiers: number[];
  exposed: ExposedStats;
  exposedFlat: ExposedStats;
  /** Episodes seen (placed or not) and the primary-observation exclusions. */
  episodes: number;
  episodeBuyers: number;
  episodeExclusions: EpisodeExclusions;
  adjusted: AdjustedStats;
  role: RoleStats;
  evidence: EvidenceLabel;
  evidenceBasis: 'adjusted' | 'exposed' | 'none';
}

export interface CohortCoverage {
  runs: number;
  placed: number;
  withDerived: number;
  excludedNoDerived: number;
  stacked: number;
  uniquePlayers: number | null;
}

const pctOf = (n: number, d: number): number | null => (d > 0 ? Math.round((100 * n) / d) : null);

/**
 * Every cohort read for every card, computed ONCE over the rows (the panel memoises the result per rows and
 * filter version). The raw table's own numbers stay in `cardImpact`; this adds the segmented counts, the exposed
 * diagnostic (both bases), the episodes and the adjusted association, the role read and the evidence label.
 */
export function cardCohorts(rows: CohortRow[], keyOf: PlayerKeyOf = displayNameKey): { byCard: Map<string, CardCohorts>; coverage: CohortCoverage } {
  const facts = rows.map((r) => runFacts(r, keyOf));
  const exposedSeg = exposedDiagnostic(facts, 'segmented');
  const exposedFlat = exposedDiagnostic(facts, 'flat');
  type Acc = {
    segBuyers: number; bKeys: (string | null)[]; cKeys: (string | null)[]; tiers: Set<number>;
    episodes: Episode[]; excl: EpisodeExclusions;
    early: number; mid: number; late: number; acqs: number; played: number; finalBoard: number; sold: number; nextN: number; nextWin: number;
  };
  const acc = new Map<string, Acc>();
  const get = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) { a = { segBuyers: 0, bKeys: [], cKeys: [], tiers: new Set(), episodes: [], excl: emptyExclusions(), early: 0, mid: 0, late: 0, acqs: 0, played: 0, finalBoard: 0, sold: 0, nextN: 0, nextWin: 0 }; acc.set(id, a); }
    return a;
  };
  const allKeys: (string | null)[] = [];
  let placed = 0, withDerived = 0, stacked = 0;
  for (const f of facts) {
    allKeys.push(f.key);
    if (f.placement != null) placed++;
    // Raw players: buyers by the flat sets (the raw table's definition), controls = every other placed run.
    if (f.placement != null) for (const id of f.flatBought) get(id).bKeys.push(f.key);
    if (!f.seg) continue;
    withDerived++;
    if (f.seg.stacked) stacked++;
    for (const o of f.seg.offers) get(o.cardId).tiers.add(o.cardTier);
    for (const id of f.segBought!) get(id).segBuyers++;
    const { episodes, exclusions, unaffordableWaves } = shopEpisodesOf(f.seg, f.placement, f.key);
    for (const [id, e] of episodes) get(id).episodes.push(e);
    for (const [id, why] of exclusions) get(id).excl[why]++;
    for (const [id, n] of unaffordableWaves) get(id).excl.unaffordable += n;
    // Role and timing, over this run's acquisitions.
    const firstWave = new Map<string, number>();
    for (const a of f.seg.acquisitions) {
      if (a.source !== 'shop' && a.source !== 'discover') continue;
      const x = get(a.cardId);
      x.acqs++;
      if (a.played) x.played++;
      if (a.finalBoard) x.finalBoard++;
      if (a.soldWave != null) x.sold++;
      const res = f.combatByWave.get(a.wave);
      if (res) { x.nextN++; if (res === 'win') x.nextWin++; }
      const fw = firstWave.get(a.cardId);
      if (fw == null || a.wave < fw) firstWave.set(a.cardId, a.wave);
    }
    for (const [id, w] of firstWave) { const x = get(id); const band = roundBandOf(w); if (band === 'early') x.early++; else if (band === 'mid') x.mid++; else x.late++; }
  }
  // Control players per card: every placed run that did not buy it (flat definition).
  const placedKeys = facts.filter((f) => f.placement != null).map((f) => ({ key: f.key, bought: f.flatBought }));
  const byCard = new Map<string, CardCohorts>();
  const empty = exposedStats([], [], 0, [], []);
  for (const [id, a] of acc) {
    const cKeys = placedKeys.filter((p) => !p.bought.has(id)).map((p) => p.key);
    const adjusted = adjustedAssociation(a.episodes);
    const exposed = exposedSeg.byCard.get(id) ?? empty;
    const basis: CardCohorts['evidenceBasis'] = adjusted.association != null ? 'adjusted' : exposed.delta != null ? 'exposed' : 'none';
    const evidence = basis === 'adjusted'
      ? evidenceLabel(adjusted.buyersInSupport, adjusted.skippersInSupport, minPlayers(adjusted.buyerPlayers, adjusted.skipperPlayers))
      : basis === 'exposed' ? evidenceLabel(exposed.buyers, exposed.skippers, minPlayers(exposed.buyerPlayers, exposed.skipperPlayers)) : 'insufficient';
    byCard.set(id, {
      segmentedBuyers: a.segBuyers,
      buyerPlayers: uniquePlayers(a.bKeys), controlPlayers: uniquePlayers(cKeys),
      observedTiers: [...a.tiers].sort((x, y) => x - y),
      exposed, exposedFlat: exposedFlat.byCard.get(id) ?? empty,
      episodes: a.episodes.length, episodeBuyers: a.episodes.filter((e) => e.bought).length, episodeExclusions: a.excl,
      adjusted,
      role: {
        earlyBuyers: a.early, midBuyers: a.mid, lateBuyers: a.late,
        playedPct: pctOf(a.played, a.acqs), finalBoardPct: pctOf(a.finalBoard, a.acqs), soldPct: pctOf(a.sold, a.acqs),
        nextCombatWinPct: pctOf(a.nextWin, a.nextN), acquisitions: a.acqs,
      },
      evidence, evidenceBasis: basis,
    });
  }
  return {
    byCard,
    coverage: { runs: rows.length, placed, withDerived, excludedNoDerived: exposedSeg.excluded, stacked, uniquePlayers: uniquePlayers(allKeys) },
  };
}

const minPlayers = (a: number | null, b: number | null): number | null => (a == null || b == null ? null : Math.min(a, b));

/** The key of the most prolific player in the rows (the sensitivity toggle excludes their runs), or null. */
export function mostProlificPlayer(rows: CohortRow[], keyOf: PlayerKeyOf = displayNameKey): { key: string; runs: number } | null {
  const counts = new Map<string, number>();
  for (const r of rows) { const k = keyOf(r); if (k != null) counts.set(k, (counts.get(k) ?? 0) + 1); }
  let best: { key: string; runs: number } | null = null;
  for (const [key, runs] of counts) if (!best || runs > best.runs) best = { key, runs };
  return best;
}

// ── Shop tier-ups as decisions ─────────────────────────────────────────────────────────────────────────────

export type GoldBand = 'tight' | 'spare' | 'rich';
/** Spare Gold after paying the tier-up: 0 or 1 = tight, 2 to 4 = spare, 5 and more = rich. */
export const goldBandOf = (spare: number): GoldBand => (spare <= 1 ? 'tight' : spare <= 4 ? 'spare' : 'rich');

export interface TierDecisionRow {
  tier: number;
  name: string;
  /** Runs with a primary decision for this tier (the first wave a tier-up to it was affordable), and how it went. */
  decisions: number;
  took: number;
  declined: number;
  /** Declines followed by a take in a later wave (reported; the decline is never relabelled). */
  crossover: number;
  /** Mean wave of the primary decision. */
  avgWave: number | null;
  /** Placed runs on each side and their mean placement. */
  tookPlaced: number;
  declinedPlaced: number;
  tookAvg: number | null;
  declinedAvg: number | null;
  /** tookAvg minus declinedAvg, unstratified: the raw read among runs that had the decision. */
  rawDelta: number | null;
  rawCi: Interval | null;
  /** The stratified read (round band x spare-Gold band), took weighted, supported strata only. */
  adjusted: AdjustedStats;
  evidence: EvidenceLabel;
}

/** One primary observation per run per tier from the last-segment `upgrades` rows (a row exists for every wave a
 *  tier-up was taken, and for every wave one was affordable and declined). Runs that never had the decision
 *  are not in any group: the comparison is took versus declined among runs that could afford it. */
export function tierDecisions(rows: CohortRow[], keyOf: PlayerKeyOf = displayNameKey): TierDecisionRow[] {
  const byTier = new Map<number, { episodes: Episode[]; goldBand: Map<Episode, GoldBand>; waves: number[] }>();
  for (const r of rows) {
    const d = usableDerived(r);
    if (!d) continue;
    const seg = segmentRun(d);
    const placement = validPlacement(r.placement) ? r.placement : null;
    const key = keyOf(r);
    const rowsByTier = new Map<number, UpgradeEvent[]>();
    for (const u of seg.upgrades) (rowsByTier.get(u.toTier) ?? rowsByTier.set(u.toTier, []).get(u.toTier)!).push(u);
    for (const [tier, us] of rowsByTier) {
      us.sort((a, b) => a.wave - b.wave);
      const first = us[0]!;
      let t = byTier.get(tier);
      if (!t) { t = { episodes: [], goldBand: new Map(), waves: [] }; byTier.set(tier, t); }
      const e: Episode = { wave: first.wave, shopTier: first.fromTier, bought: first.taken, crossover: !first.taken && us.some((u) => u.taken && u.wave > first.wave), placement, key };
      t.episodes.push(e);
      t.goldBand.set(e, goldBandOf(first.goldBefore - first.cost));
      t.waves.push(first.wave);
    }
  }
  const out: TierDecisionRow[] = [];
  for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
    const t = byTier.get(tier)!;
    const took = t.episodes.filter((e) => e.bought), declined = t.episodes.filter((e) => !e.bought);
    const tookPlaces = took.map((e) => e.placement).filter((p): p is number => p != null);
    const declinedPlaces = declined.map((e) => e.placement).filter((p): p is number => p != null);
    const adjusted = adjustedAssociation(t.episodes, (e) => `${roundBandOf(e.wave)}:${t.goldBand.get(e)}`);
    const tookAvg = tookPlaces.length ? mean(tookPlaces) : null, declinedAvg = declinedPlaces.length ? mean(declinedPlaces) : null;
    out.push({
      tier, name: `T${tier}`,
      decisions: t.episodes.length, took: took.length, declined: declined.length,
      crossover: t.episodes.filter((e) => e.crossover).length,
      avgWave: t.waves.length ? Math.round((mean(t.waves)) * 10) / 10 : null,
      tookPlaced: tookPlaces.length, declinedPlaced: declinedPlaces.length,
      tookAvg: tookAvg == null ? null : r2(tookAvg), declinedAvg: declinedAvg == null ? null : r2(declinedAvg),
      rawDelta: tookAvg == null || declinedAvg == null ? null : r2(tookAvg - declinedAvg),
      rawCi: welchInterval(tookPlaces, declinedPlaces),
      adjusted,
      evidence: adjusted.association != null
        ? evidenceLabel(adjusted.buyersInSupport, adjusted.skippersInSupport, minPlayers(adjusted.buyerPlayers, adjusted.skipperPlayers))
        : 'insufficient',
    });
  }
  return out;
}
