/**
 * THE AT-A-GLANCE READ of the Balance Report (owner ask 2026-11-19: "i want to immediately be able to recognize over or
 * underperforming cards/heroes/ancients, as well as options and cards that are simply never picked or purchased").
 *
 * Nothing here is a new statistic. Every category's existing honest comparison (`playerReport.ts`, `reportCohorts.ts`)
 * is folded into ONE row shape, `OutlierItem`, so a single view can rank minions, spells, heroes, runes, quests,
 * Ancients and hero x Ancient pairings side by side:
 *  · `gain` is the comparison FLIPPED to read "places better": positive = the runs that took it finished higher than
 *    the comparable runs that were offered it and passed. Always offered-conditioned, never "against everyone":
 *    cards use the adjusted association (first affordable Shop offer, stratified by round band x Shop tier, the epoch
 *    being the report's own filter) and fall back to the exposed diagnostic; heroes compare chosen with
 *    offered-not-chosen; runes and quests compare takers with the runs offered them that skipped; Ancients and
 *    pairings compare the pick with the offered-not-picked, stratified by the round band the offer opened in.
 *  · `evidence` is the existing label (`evidenceLabel`). The outlier lists GATE on it, so a 3-run row can never top
 *    the list; a thin row is listed apart as thin, never ranked.
 *  · Nothing is centred: a category where every option reads positive shows every option positive.
 *
 * The NEVER / RARELY PICKED lists read the same rows' offer and take counts; NEVER OFFERED compares them with the set's
 * pool (`reportUniverse`), which is how a pool bug shows up. Pure functions over the rows the panel already scoped.
 */
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, QUEST_INDEX, RUNE_INDEX, RUNES, SETS, poolFor, type SetId } from '@game/content';
import { ANCIENTS, ANCIENT_IDS, ancientOfferFor, type AncientId } from './ancients';
import { ancientsSetSupported } from './ancientsRelease';
import { HEROES, playableHeroes } from './heroes';
import type { CardImpactRow, HeroImpactRow, RuneImpactRow } from './playerReport';
import {
  accountKey, adjustedAssociation, evidenceLabel, roundBandOf, uniquePlayers, validPlacement,
  type AdjustedStats, type CohortRow, type Episode, type EvidenceLabel, type Interval, type PlayerKeyOf,
} from './reportCohorts';

export type OutlierKind = 'minion' | 'spell' | 'hero' | 'ancient' | 'pairing' | 'rune' | 'quest';
export const OUTLIER_KINDS: readonly OutlierKind[] = ['minion', 'spell', 'hero', 'ancient', 'pairing', 'rune', 'quest'];

/** Which comparison a row's `gain` comes from (the expanded row names it in plain words). */
export type OutlierBasis = 'adjusted' | 'exposed' | 'offered' | 'offeredStrat' | 'none';

export interface OutlierItem {
  kind: OutlierKind;
  /** Unique within its kind (a pairing is `hero|ancient`). */
  id: string;
  name: string;
  /** Pairings: the two halves. */
  heroId?: string;
  ancientId?: string;
  /** Cards: the current tier and tribe (a reading aid only). */
  tier?: number;
  tribe?: string;
  /** Runs it was offered in (once per run) and runs that took it (bought / picked). */
  offered: number;
  taken: number;
  /** taken / offered, whole percent; null with no offers. */
  takeRate: number | null;
  /** PLACES BETTER: the offered-conditioned comparison flipped so positive = takers finished higher. Null = no
   *  comparison (no passers, no placed takers, or no comparable stratum). */
  gain: number | null;
  /** The 95% interval on `gain` (same flip), or null when suppressed for size. */
  ci: Interval | null;
  /** Placed runs on each side of the comparison, and the players on the smaller side. */
  takers: number;
  passers: number;
  players: number | null;
  /** Mean placement of each side, when the comparison is a plain two-group one (null for a stratified read). */
  takerAvg: number | null;
  passerAvg: number | null;
  evidence: EvidenceLabel;
  basis: OutlierBasis;
  /** A data caveat for this row (reconstructed offers, picks without an offer record), or null. */
  note: string | null;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r1 = (n: number): number => Math.round(n * 10) / 10;
const pctOf = (n: number, d: number): number | null => (d > 0 ? Math.round((100 * Math.min(n, d)) / d) : null);
const flipCi = (ci: Interval | null | undefined): Interval | null => (ci ? { lo: r2(-ci.hi), hi: r2(-ci.lo) } : null);
const flip = (d: number | null | undefined): number | null => (d == null ? null : r2(-d) + 0); // + 0 turns -0 into 0
const minPlayers = (a: number | null, b: number | null): number | null => (a == null || b == null ? null : Math.min(a, b));
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// ── Folding the existing category rows ─────────────────────────────────────────────────────────────────────

/** Minions and spells: the adjusted association when the card's evidence rests on it, else the exposed diagnostic. */
export function outliersFromCards(rows: readonly CardImpactRow[]): OutlierItem[] {
  return rows.map((r): OutlierItem => {
    const adj = r.adjusted.association != null && r.evidenceBasis !== 'exposed';
    const exp = !adj && r.exposed.delta != null;
    return {
      kind: r.spell ? 'spell' : 'minion', id: r.id, name: r.name, tier: r.tier, tribe: r.tribe2 ? `${r.tribe}/${r.tribe2}` : r.tribe,
      offered: r.runsSeen, taken: Math.min(r.runsBought, r.runsSeen || r.runsBought), takeRate: pctOf(r.runsBought, r.runsSeen),
      gain: adj ? flip(r.adjusted.association) : exp ? flip(r.exposed.delta) : null,
      ci: adj ? flipCi(r.adjusted.ci) : exp ? flipCi(r.exposed.ci) : null,
      takers: adj ? r.adjusted.buyersInSupport : r.exposed.buyers,
      passers: adj ? r.adjusted.skippersInSupport : r.exposed.skippers,
      players: adj ? minPlayers(r.adjusted.buyerPlayers, r.adjusted.skipperPlayers) : minPlayers(r.exposed.buyerPlayers, r.exposed.skipperPlayers),
      takerAvg: exp ? r.exposed.buyerAvg : null, passerAvg: exp ? r.exposed.skipperAvg : null,
      evidence: r.evidence, basis: adj ? 'adjusted' : exp ? 'exposed' : 'none',
      note: null,
    };
  });
}

/** Heroes: chosen against offered-not-chosen. */
export function outliersFromHeroes(rows: readonly HeroImpactRow[]): OutlierItem[] {
  return rows.map((r): OutlierItem => ({
    kind: 'hero', id: r.id, name: r.name,
    offered: r.offered, taken: r.runs, takeRate: r.pickRate,
    gain: flip(r.offeredDelta), ci: flipCi(r.offeredCi),
    takers: r.placedN, passers: r.offeredSkippers, players: minPlayers(r.players, r.skipperPlayers),
    takerAvg: r.avgPlace, passerAvg: r.offeredSkipperAvg,
    evidence: r.evidence, basis: r.offeredDelta == null ? 'none' : 'offered', note: null,
  }));
}

/** Runes: takers against the runs offered them that skipped. */
export function outliersFromRunes(rows: readonly RuneImpactRow[]): OutlierItem[] {
  return rows.map((r): OutlierItem => ({
    kind: 'rune', id: r.id, name: r.name,
    offered: r.offered, taken: r.picked, takeRate: r.pickRate,
    gain: flip(r.delta), ci: flipCi(r.deltaWelch),
    takers: r.placedN, passers: r.baselineN, players: minPlayers(r.players, r.skipperPlayers),
    takerAvg: r.avgPlace, passerAvg: r.baselineAvgPlace,
    evidence: r.evidence, basis: r.delta == null ? 'none' : 'offered', note: null,
  }));
}

// ── Quests: an offered choice, the runes' shape ────────────────────────────────────────────────────────────

/** Quests: takers against the runs offered them that skipped (one per run). Offers are live on rows from
 *  2026-10-03 and replay-derived before, exactly as runes are. */
export function questOutliers(rows: readonly CohortRow[], keyOf: PlayerKeyOf = accountKey): OutlierItem[] {
  const acc = new Map<string, { offered: number; picked: number; tp: number[]; sp: number[]; tk: (string | null)[]; sk: (string | null)[] }>();
  for (const r of rows) {
    const placed = validPlacement(r.placement) ? r.placement : null;
    const key = keyOf(r);
    const picked = new Set(r.pickedQuests ?? []);
    for (const id of new Set([...(r.offeredQuests ?? []), ...picked])) {
      let a = acc.get(id);
      if (!a) { a = { offered: 0, picked: 0, tp: [], sp: [], tk: [], sk: [] }; acc.set(id, a); }
      a.offered++;
      if (picked.has(id)) a.picked++;
      if (placed == null) continue;
      if (picked.has(id)) { a.tp.push(placed); a.tk.push(key); } else { a.sp.push(placed); a.sk.push(key); }
    }
  }
  const out: OutlierItem[] = [];
  for (const [id, a] of acc) {
    out.push(twoGroupItem('quest', id, QUEST_INDEX[id]?.name ?? id, a.offered, a.picked, a.tp, a.sp, a.tk, a.sk));
  }
  return out;
}

/** A plain two-group comparison (takers vs passers) as an `OutlierItem`. */
function twoGroupItem(kind: OutlierKind, id: string, name: string, offered: number, taken: number, tp: number[], sp: number[], tk: (string | null)[], sk: (string | null)[]): OutlierItem {
  const ta = mean(tp), sa = mean(sp);
  // One stratum holding every run: `adjustedAssociation` then IS the plain difference with its Welch interval.
  const adj = adjustedAssociation([
    ...tp.map((p, i): Episode => ({ wave: 1, shopTier: 0, bought: true, crossover: false, placement: p, key: tk[i] ?? null })),
    ...sp.map((p, i): Episode => ({ wave: 1, shopTier: 0, bought: false, crossover: false, placement: p, key: sk[i] ?? null })),
  ], () => 'all');
  const players = minPlayers(uniquePlayers(tk), uniquePlayers(sk));
  return {
    kind, id, name, offered, taken, takeRate: pctOf(taken, offered),
    gain: ta != null && sa != null ? flip(ta - sa) : null, ci: flipCi(adj.ci),
    takers: tp.length, passers: sp.length, players,
    takerAvg: ta == null ? null : r1(ta), passerAvg: sa == null ? null : r1(sa),
    evidence: evidenceLabel(tp.length, sp.length, players), basis: ta != null && sa != null ? 'offered' : 'none', note: null,
  };
}

// ── Ancients ───────────────────────────────────────────────────────────────────────────────────────────────

/** Where a row's Ancient offer came from: the live capture (2026-11-19), rebuilt from the seed + pick wave (the
 *  offer is seeded: `ancientOfferFor`), or nothing to go on. */
export type AncientOfferSource = 'live' | 'rebuilt' | 'none';

/** One row's Ancient facts. `enabled` false = Ancients off on that run (every row before 2026-11-16): no data. */
export interface AncientFacts {
  enabled: boolean;
  offer: AncientId[] | null;
  offerSource: AncientOfferSource;
  offerWave: number | null;
  picked: AncientId | null;
  /** The hero whose pairing the pick was (the power held at the pick); the run's hero when nothing was picked. */
  pairingHero: string;
}

const isAncientId = (x: unknown): x is AncientId => typeof x === 'string' && (ANCIENT_IDS as readonly string[]).includes(x);

/** The Ancient facts of one row, from its flat scalars or its derived payload, whichever carries them. */
export function ancientFactsOf(row: CohortRow): AncientFacts {
  const d = row.derived;
  const enabled = !!(row.ancients ?? d?.ancients);
  const pick = row.ancient ?? d?.ancient;
  const picked = isAncientId(pick?.id) ? pick!.id as AncientId : null;
  const pairingHero = (picked && pick?.heroId) || row.heroId;
  if (!enabled) return { enabled: false, offer: null, offerSource: 'none', offerWave: null, picked: null, pairingHero };
  const live = row.ancientOffer ?? d?.ancientOffer;
  const liveWave = row.ancientOfferWave ?? d?.ancientOfferWave ?? pick?.wave ?? null;
  if (Array.isArray(live) && live.length > 0 && live.every(isAncientId)) {
    return { enabled, offer: [...live] as AncientId[], offerSource: 'live', offerWave: liveWave, picked, pairingHero };
  }
  const seed = row.seed ?? d?.seed;
  if (picked && pick?.wave && typeof seed === 'number') {
    const offer = ancientOfferFor(seed, pick.wave);
    // A rebuilt offer that does not hold the recorded pick is a mismatch (the offer rule changed): report no offer.
    if (offer.includes(picked)) return { enabled, offer, offerSource: 'rebuilt', offerWave: pick.wave, picked, pairingHero };
  }
  return { enabled, offer: null, offerSource: 'none', offerWave: picked ? pick?.wave ?? null : null, picked, pairingHero };
}

/** How far runs got with Ancients: the meter-fill funnel the outlier rows cannot show. */
export interface AncientReach {
  /** Rows with Ancients on. */
  enabledRuns: number;
  /** Rows with an offer (live or rebuilt) or a pick: they reached the awakening. */
  reached: number;
  picked: number;
  /** Rows with Ancients on that never reached it (no offer, no pick). Before live offer capture an offer left open
   *  at elimination also lands here: the offer was never answered, so nothing was recorded. */
  neverReached: number;
  offerLive: number;
  offerRebuilt: number;
  /** Picks with no offer to compare against (no seed or wave recorded): counted as picks, outside every comparison. */
  pickNoOffer: number;
  /** Mean wave the offer opened, and the count per wave (index = wave). */
  avgOfferWave: number | null;
  offerWaves: number[];
  /** Per hero: Ancients-on runs, runs that reached it, and the mean offer wave. */
  byHero: { heroId: string; runs: number; reached: number; avgOfferWave: number | null }[];
}

export function ancientReach(rows: readonly CohortRow[]): AncientReach {
  let enabledRuns = 0, reached = 0, picked = 0, offerLive = 0, offerRebuilt = 0, pickNoOffer = 0;
  const waves: number[] = [];
  const offerWaves: number[] = [];
  const hero = new Map<string, { runs: number; reached: number; waves: number[] }>();
  for (const r of rows) {
    const f = ancientFactsOf(r);
    if (!f.enabled) continue;
    enabledRuns++;
    const h = hero.get(r.heroId) ?? hero.set(r.heroId, { runs: 0, reached: 0, waves: [] }).get(r.heroId)!;
    h.runs++;
    if (f.offerSource === 'live') offerLive++;
    if (f.offerSource === 'rebuilt') offerRebuilt++;
    if (f.picked) picked++;
    if (f.picked && !f.offer) pickNoOffer++;
    if (f.offer || f.picked) {
      reached++;
      h.reached++;
      if (f.offerWave) { waves.push(f.offerWave); h.waves.push(f.offerWave); offerWaves[f.offerWave] = (offerWaves[f.offerWave] ?? 0) + 1; }
    }
  }
  const avg = (xs: number[]): number | null => { const m = mean(xs); return m == null ? null : r1(m); };
  return {
    enabledRuns, reached, picked, neverReached: enabledRuns - reached, offerLive, offerRebuilt, pickNoOffer,
    avgOfferWave: avg(waves), offerWaves: Array.from({ length: offerWaves.length }, (_, i) => offerWaves[i] ?? 0),
    byHero: [...hero.entries()].map(([heroId, h]) => ({ heroId, runs: h.runs, reached: h.reached, avgOfferWave: avg(h.waves) }))
      .sort((a, b) => b.runs - a.runs || a.heroId.localeCompare(b.heroId)),
  };
}

const heroName = (id: string): string => HEROES.find((h) => h.id === id)?.name ?? id;
const ancientShort = (id: AncientId): string => ANCIENTS[id]?.name.replace(/^Ancient of /, '') ?? id;
/** The display name of a hero x Ancient pairing. */
export const pairingName = (heroId: string, ancientId: AncientId): string => `${heroName(heroId)} × ${ancientShort(ancientId)}`;
/** Ancient comparisons are stratified by the ROUND BAND the offer opened in (an early awakening is a different run). */
const offerBand = (e: Episode): string => roundBandOf(e.wave);

/** Build `OutlierItem`s from per-key offer episodes (one per run per offered option). */
function episodeItems(kind: OutlierKind, eps: Map<string, { offered: number; taken: number; episodes: Episode[]; rebuilt: number }>, nameOf: (key: string) => string, extra: (key: string) => Partial<OutlierItem>): OutlierItem[] {
  const out: OutlierItem[] = [];
  for (const [key, a] of eps) {
    const adj: AdjustedStats = adjustedAssociation(a.episodes, offerBand);
    const players = minPlayers(adj.buyerPlayers, adj.skipperPlayers);
    out.push({
      kind, id: key, name: nameOf(key), ...extra(key),
      offered: a.offered, taken: a.taken, takeRate: pctOf(a.taken, a.offered),
      gain: flip(adj.association), ci: flipCi(adj.ci),
      takers: adj.buyersInSupport, passers: adj.skippersInSupport, players,
      takerAvg: null, passerAvg: null,
      evidence: evidenceLabel(adj.buyersInSupport, adj.skippersInSupport, players),
      basis: adj.association == null ? 'none' : 'offeredStrat',
      note: a.rebuilt > 0 ? `${a.rebuilt} of ${a.offered} offers rebuilt from the run seed (uploaded before live offer capture)` : null,
    });
  }
  return out;
}

/** Ancients and hero x Ancient pairings: the pick against the offered-not-picked, by offer round band. A pick with
 *  no offer record counts toward `taken` only (its `offered` is raised to match, and the row's note says so). */
export function ancientOutliers(rows: readonly CohortRow[], keyOf: PlayerKeyOf = accountKey): { ancients: OutlierItem[]; pairings: OutlierItem[] } {
  type Acc = { offered: number; taken: number; episodes: Episode[]; rebuilt: number; noOffer: number };
  const anc = new Map<string, Acc>(), pair = new Map<string, Acc>();
  const get = (m: Map<string, Acc>, k: string): Acc => m.get(k) ?? m.set(k, { offered: 0, taken: 0, episodes: [], rebuilt: 0, noOffer: 0 }).get(k)!;
  for (const r of rows) {
    const f = ancientFactsOf(r);
    if (!f.enabled) continue;
    const placement = validPlacement(r.placement) ? r.placement : null;
    const key = keyOf(r);
    if (!f.offer) {
      if (f.picked) {
        for (const a of [get(anc, f.picked), get(pair, `${f.pairingHero}|${f.picked}`)]) { a.offered++; a.taken++; a.noOffer++; }
      }
      continue;
    }
    for (const id of new Set(f.offer)) {
      const took = f.picked === id;
      const ep: Episode = { wave: f.offerWave ?? 1, shopTier: 0, bought: took, crossover: false, placement, key };
      for (const a of [get(anc, id), get(pair, `${f.pairingHero}|${id}`)]) {
        a.offered++;
        if (took) a.taken++;
        if (f.offerSource === 'rebuilt') a.rebuilt++;
        a.episodes.push(ep);
      }
    }
  }
  const withNoOffer = (items: OutlierItem[], m: Map<string, Acc>): OutlierItem[] => items.map((it) => {
    const n = m.get(it.id)?.noOffer ?? 0;
    return n > 0 ? { ...it, note: [it.note, `${n} picks have no offer record and sit outside the comparison`].filter(Boolean).join('. ') } : it;
  });
  const ancients = withNoOffer(episodeItems('ancient', anc, (k) => ANCIENTS[k as AncientId]?.name ?? k, (k) => ({ ancientId: k })), anc);
  const pairings = withNoOffer(episodeItems('pairing', pair, (k) => { const [h, a] = k.split('|'); return pairingName(h!, a as AncientId); },
    (k) => { const [h, a] = k.split('|'); return { heroId: h!, ancientId: a! }; }), pair);
  return { ancients, pairings };
}

// ── Ranking, never picked, never offered ───────────────────────────────────────────────────────────────────

const EVIDENCE_ORDER: Record<EvidenceLabel, number> = { supported: 2, candidate: 1, insufficient: 0 };
/** True when the row's evidence meets `min`. */
export const meetsEvidence = (it: Pick<OutlierItem, 'evidence'>, min: EvidenceLabel): boolean => EVIDENCE_ORDER[it.evidence] >= EVIDENCE_ORDER[min];
/** The interval clears zero: the direction is not just noise at this sample. */
export const clearOfZero = (it: Pick<OutlierItem, 'ci'>): boolean => !!it.ci && (it.ci.lo > 0 || it.ci.hi < 0);

export interface RankedOutliers {
  /** Evidence at or above the gate, positive gain, best first. */
  over: OutlierItem[];
  /** Evidence at or above the gate, negative gain, worst first. */
  under: OutlierItem[];
  /** Evidence at or above the gate, gain exactly zero. */
  even: OutlierItem[];
  /** Below the gate or with no comparison: listed apart, biggest sample first, never ranked. */
  thin: OutlierItem[];
}

/**
 * Rank a category. GATING FIRST: only rows meeting `min` evidence are ranked at all, so no 3-run row can top a list.
 * Within the ranked rows: by the size of the gain (the whisker on each row shows whether its interval crosses zero).
 */
export function rankOutliers(items: readonly OutlierItem[], min: EvidenceLabel = 'candidate'): RankedOutliers {
  const ranked = items.filter((it) => it.gain != null && meetsEvidence(it, min) && it.evidence !== 'insufficient');
  const byName = (a: OutlierItem, b: OutlierItem): number => a.name.localeCompare(b.name);
  return {
    over: ranked.filter((it) => it.gain! > 0).sort((a, b) => b.gain! - a.gain! || byName(a, b)),
    under: ranked.filter((it) => it.gain! < 0).sort((a, b) => a.gain! - b.gain! || byName(a, b)),
    even: ranked.filter((it) => it.gain === 0).sort(byName),
    thin: items.filter((it) => !ranked.includes(it)).sort((a, b) => Math.min(b.takers, b.passers) - Math.min(a.takers, a.passers) || b.offered - a.offered || byName(a, b)),
  };
}

/** The never / rarely picked gates: offered at least `NEVER_MIN_OFFERED` times and taken never; or offered at least
 *  `RARE_MIN_OFFERED` times and taken in at most `RARE_MAX_RATE` percent of them. */
export const NEVER_MIN_OFFERED = 3;
export const RARE_MIN_OFFERED = 10;
export const RARE_MAX_RATE = 8;

export interface PickGaps {
  never: OutlierItem[];
  rarely: OutlierItem[];
  /** Taken zero times but offered under the gate: too few offers to call. */
  neverThin: number;
}

export function pickGaps(items: readonly OutlierItem[]): PickGaps {
  const never = items.filter((it) => it.taken === 0 && it.offered >= NEVER_MIN_OFFERED).sort((a, b) => b.offered - a.offered || a.name.localeCompare(b.name));
  const rarely = items.filter((it) => it.taken > 0 && it.offered >= RARE_MIN_OFFERED && (it.takeRate ?? 100) <= RARE_MAX_RATE)
    .sort((a, b) => (a.takeRate ?? 0) - (b.takeRate ?? 0) || b.offered - a.offered || a.name.localeCompare(b.name));
  const neverThin = items.filter((it) => it.taken === 0 && it.offered > 0 && it.offered < NEVER_MIN_OFFERED).length;
  return { never, rarely, neverThin };
}

/** One entry of the set's offerable content. */
export interface UniverseEntry { kind: OutlierKind; id: string; name: string; tier?: number; tribe?: string; heroId?: string; ancientId?: string }

/**
 * What the active set CAN offer, per category: the drawable minions and Tavern spells, the solo heroes allowed by the
 * set's tribes, the runes and universal quests whose set and tribe gates the set can meet, and (on an Ancients set)
 * the six Ancients and every playable hero's six pairings. An approximation of each run's real gates (a run rolls a
 * subset of the tribes; some runes need a doubleable power), so an entry here was OFFERABLE in some run, not in every
 * run. Hero quests are left out: they belong to one hero's turn-1 Discover.
 */
export function reportUniverse(setId: SetId): UniverseEntry[] {
  const set = SETS[setId] ?? SETS.set1;
  const tribes = new Set<string>([...set.tribes, 'neutral']);
  const pool = poolFor(setId);
  const out: UniverseEntry[] = [];
  for (const c of pool.buyable) out.push({ kind: 'minion', id: c.id, name: c.name, tier: c.tier, tribe: c.tribe });
  for (const c of pool.spells) out.push({ kind: 'spell', id: c.id, name: c.name, tier: c.tier, tribe: c.tribe });
  const heroes = playableHeroes(set.tribes);
  for (const h of heroes) out.push({ kind: 'hero', id: h.id, name: h.name });
  for (const rn of [...RUNES, ...EPIC_RUNES]) {
    if (rn.sets && !rn.sets.includes(setId)) continue;
    if (rn.duos) continue;
    if (rn.tribes && !rn.tribes.some((t) => tribes.has(t))) continue;
    out.push({ kind: 'rune', id: rn.id, name: rn.name });
  }
  for (const q of QUEST_DEFS) {
    if (q.heroQuest || (q.sets && !q.sets.includes(setId)) || !tribes.has(q.tribe)) continue;
    out.push({ kind: 'quest', id: q.id, name: q.name });
  }
  if (ancientsSetSupported(setId)) {
    for (const a of ANCIENT_IDS) out.push({ kind: 'ancient', id: a, name: ANCIENTS[a].name, ancientId: a });
    for (const h of heroes) for (const a of ANCIENT_IDS) out.push({ kind: 'pairing', id: `${h.id}|${a}`, name: pairingName(h.id, a), heroId: h.id, ancientId: a });
  }
  return out;
}

/** The set's content that the rows never offered, per the universe above. Content the rows saw that the universe does
 *  not list (an archived card still in old rows) is not this list's business. */
export function neverOffered(universe: readonly UniverseEntry[], items: readonly OutlierItem[]): UniverseEntry[] {
  const seen = new Set(items.filter((it) => it.offered > 0).map((it) => `${it.kind}:${it.id}`));
  return universe.filter((u) => !seen.has(`${u.kind}:${u.id}`)).sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || a.name.localeCompare(b.name));
}

/** A card id the report can name (the panel's art lookup and tests use it). */
export const isKnownCard = (id: string): boolean => !!CARD_INDEX[id];
export const isKnownRune = (id: string): boolean => !!RUNE_INDEX[id];

// ── The plain-words read ───────────────────────────────────────────────────────────────────────────────────

const VERB: Record<OutlierKind, [took: string, tookPast: string, passed: string]> = {
  minion: ['bought in', 'bought', 'were offered it and passed'],
  spell: ['bought in', 'bought', 'were offered it and passed'],
  hero: ['chosen in', 'chose', 'were offered it and chose another hero'],
  rune: ['taken in', 'took', 'were offered it and skipped it'],
  quest: ['taken in', 'took', 'were offered it and skipped it'],
  ancient: ['picked in', 'picked', 'were offered it and picked another Ancient'],
  pairing: ['picked in', 'picked', 'were offered it and picked another Ancient'],
};
const BASIS_WORDS: Record<OutlierBasis, string> = {
  adjusted: 'compared inside the first affordable Shop offer, among runs in the same round band and Shop tier',
  exposed: 'compared with every run whose Shop showed it at any time (the exposed diagnostic: no affordable-offer data for enough runs)',
  offered: 'compared with the runs that had the same choice',
  offeredStrat: 'compared within the same round band the offer opened in',
  none: '',
};
const EVIDENCE_WORDS: Record<EvidenceLabel, string> = { insufficient: 'Insufficient evidence', candidate: 'Candidate', supported: 'Supported' };
const sgn = (n: number): string => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

/** The one-paragraph plain-words read of a row, e.g. "Offered in 412 runs, bought in 96 (23%). Runs that bought it
 *  placed 0.6 higher on average than runs that were offered it and passed (Supported, 95% interval 0.2 to 1.0)." */
export function outlierSentence(it: OutlierItem): string {
  const [t, took, p] = VERB[it.kind];
  const runs = (n: number): string => `${n} ${n === 1 ? 'run' : 'runs'}`;
  const head = `Offered in ${runs(it.offered)}, ${t} ${it.taken}${it.takeRate == null ? '' : ` (${it.takeRate}%)`}.`;
  if (it.gain == null) {
    const why = it.taken === 0 ? 'No run took it, so there is nothing to compare.'
      : it.takers === 0 && it.passers === 0 ? 'No placed runs on either side yet.'
        : it.passers === 0 ? 'Every placed run offered it took it: no passers to compare with.'
          : it.takers === 0 ? 'No placed run that took it is in a comparable situation yet.' : 'No comparable stratum holds both sides yet.';
    return `${head} ${why}${it.note ? ` ${it.note}.` : ''}`;
  }
  const dir = it.gain > 0 ? 'higher' : it.gain < 0 ? 'lower' : 'the same';
  const size = it.gain === 0 ? '' : `${Math.abs(it.gain).toFixed(1)} `;
  const ci = it.ci ? `, 95% interval ${sgn(it.ci.lo)} to ${sgn(it.ci.hi)}` : ', interval not shown under 5 runs a side';
  const avgs = it.takerAvg != null && it.passerAvg != null ? ` Average place ${it.takerAvg.toFixed(1)} against ${it.passerAvg.toFixed(1)}.` : '';
  const players = it.players == null ? '' : ` ${it.players} players on the smaller side.`;
  return `${head} Runs that ${took} it placed ${size}${dir} on average than the ${it.passers} placed runs that ${p} (${it.takers} placed runs took it; ${BASIS_WORDS[it.basis]}). ${EVIDENCE_WORDS[it.evidence]}${ci}.${avgs}${players}${it.note ? ` ${it.note}.` : ''}`;
}
