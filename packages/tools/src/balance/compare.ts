/**
 * BALANCE BOT B6 (report half) — compare a CANDIDATE job against a BASELINE job.
 *
 * Refuses to compare jobs whose identities differ in anything the caller did not declare (`allowDiff`) — a
 * comparison across an undeclared engine / content / pool / effect change is not an experiment. Pairs lobbies by
 * SEED where both jobs have the seed (the roadmap's seat-rotated paired schedule: the same seed's lobbies are
 * resampled together), treats the rest as unpaired, and reports candidate − baseline effect sizes with 95%
 * lobby-level bootstrap intervals for hero placement, entity funnels and pacing.
 *
 * The markdown answers the roadmap's questions in order: Did the target move? Rules or policy? Acquisition
 * consistency? Dominant combos? Pacing / diversity? Early cards? Unsupported?
 *
 * A/A: `compareJobs(x, x)` reports ZERO effect everywhere (every paired draw is identical) — `isZeroEffect`
 * checks that, and the test suite runs it.
 */
import { CARD_INDEX, HEROES, RUNE_INDEX, type ExperimentIdentity, type LobbyRecord } from './deps';
import { aggregate, fmt, type Aggregate, type Coverage } from './aggregate';
import { bootstrapDiff, keyedRng, stddev, type CI, type LobbyPartial } from './stats';
import { pct, signed } from './report';

export interface CompareOptions {
  /** Identity fields allowed to differ (the declared candidate diff), e.g. `['contentDigest', 'manifestDigest']`. */
  allowDiff?: readonly (keyof ExperimentIdentity)[];
  /** The entity the patch targeted, printed first under "Did the target move?". */
  target?: { kind: 'hero' | 'rune' | 'minion' | 'spell'; id: string };
  minSupport?: number;
  bootstrapReps?: number;
  seed?: number;
  /** Rows per entity table in the markdown. Default 25. */
  maxRows?: number;
}

export type DiffCI = CI & { paired: number };

export interface EntityDiff {
  kind: 'hero' | 'rune' | 'minion' | 'spell';
  id: string;
  name: string;
  /** Candidate − baseline. */
  diff: DiffCI;
  baseline: number | undefined;
  candidate: number | undefined;
  /** Support (runs) on each side. */
  nBase: number;
  nCand: number;
}

export interface Comparison {
  schemaVersion: 1;
  identity: {
    baseline: ExperimentIdentity | undefined;
    candidate: ExperimentIdentity | undefined;
    differing: string[];
    allowed: string[];
    rulesChanged: boolean;
    policyChanged: boolean;
    policy: { baseline: string; candidate: string };
  };
  pairing: { pairedSeeds: number; baselineOnly: number; candidateOnly: number };
  coverage: { baseline: Coverage; candidate: Coverage };
  aggregates: { baseline: Aggregate; candidate: Aggregate };
  heroPlacement: EntityDiff[];
  heroTopHalf: EntityDiff[];
  runePickRate: EntityDiff[];
  runeLift: EntityDiff[];
  minionBuyRate: EntityDiff[];
  minionFinalBoardRate: EntityDiff[];
  minionPlacementHeld: EntityDiff[];
  /** Acquisition consistency: mean acquisition round and its spread on each side. */
  acquisition: { id: string; name: string; kind: 'minion' | 'spell' | 'rune'; meanBase: number | undefined; meanCand: number | undefined; sdBase: number | undefined; sdCand: number | undefined; holdersBase: number; holdersCand: number; holderRateDiff: DiffCI }[];
  spellBuyRate: EntityDiff[];
  spellCastPerBuy: EntityDiff[];
  spellHeldRate: EntityDiff[];
  pacing: {
    tierByRound: DiffCI[];
    unspentByRound: DiffCI[];
    turnoverByRound: DiffCI[];
    winnerConcentration: { baseline: number | undefined; candidate: number | undefined };
    finalBoardDiversity: { baseline: number | undefined; candidate: number | undefined };
    earlyCardRetention: DiffCI;
    roundsPlayed: DiffCI;
  };
  /** hero × rune top-half rate, both sides, for combos with support on either side. */
  combos: { heroId: string; runeId: string; nBase: number; nCand: number; topHalfBase: number | undefined; topHalfCand: number | undefined; diff: DiffCI }[];
  earlyCards: EntityDiff[];
  unsupported: { baseline: string[]; candidate: string[] };
  options: Required<Pick<CompareOptions, 'minSupport' | 'bootstrapReps' | 'seed'>>;
}

const IDENTITY_FIELDS: (keyof ExperimentIdentity)[] = ['engineRevision', 'dirtyDigest', 'contentDigest', 'poolDigest', 'effectDigest', 'manifestDigest'];
const RULES_FIELDS = new Set<string>(['engineRevision', 'dirtyDigest', 'contentDigest', 'poolDigest', 'effectDigest']);

// ── per-lobby partials (one pass per record, keyed for pairing) ───────────────────────────────────────────────

interface LobbyStats {
  seed: number;
  placementByHero: Map<string, LobbyPartial>;
  topHalfByHero: Map<string, LobbyPartial>;
  runePick: Map<string, LobbyPartial>;        // picked / offered
  runeOwnerPlacement: Map<string, LobbyPartial>;
  nonOwnerPlacement: Map<string, LobbyPartial>;
  cardBuy: Map<string, LobbyPartial>;         // bought / offered
  cardFinalBoard: Map<string, LobbyPartial>;  // on final board / runs
  cardHolders: Map<string, LobbyPartial>;     // runs holding / runs
  cardPlacementHeld: Map<string, LobbyPartial>;
  cardAcqRounds: Map<string, number[]>;
  spellCastPerBuy: Map<string, LobbyPartial>; // shop casts / bought
  spellHeld: Map<string, LobbyPartial>;       // held unused / bought
  tierByRound: Map<string, LobbyPartial>;     // keyed by String(round)
  unspentByRound: Map<string, LobbyPartial>;
  turnoverByRound: Map<string, LobbyPartial>;
  earlyRetention: LobbyPartial;
  roundsPlayed: LobbyPartial;
  comboTopHalf: Map<string, LobbyPartial>;    // `${hero}|${rune}` → top-half / runs
  censored: boolean;
}

const runKey = (r: { lobbyId: string; seatId: string }): string => `${r.lobbyId}/${r.seatId}`;
const part = (m: Map<string, LobbyPartial>, k: string): LobbyPartial => m.get(k) ?? m.set(k, { sum: 0, n: 0 }).get(k)!;
const addTo = (p: LobbyPartial, v: number): void => { p.sum += v; p.n++; };

function lobbyStats(L: LobbyRecord): LobbyStats {
  const s: LobbyStats = {
    seed: L.seed, placementByHero: new Map(), topHalfByHero: new Map(), runePick: new Map(), runeOwnerPlacement: new Map(), nonOwnerPlacement: new Map(),
    cardBuy: new Map(), cardFinalBoard: new Map(), cardHolders: new Map(), cardPlacementHeld: new Map(), cardAcqRounds: new Map(), spellCastPerBuy: new Map(), spellHeld: new Map(),
    tierByRound: new Map(), unspentByRound: new Map(), turnoverByRound: new Map(), earlyRetention: { sum: 0, n: 0 }, roundsPlayed: { sum: L.roundsPlayed, n: 1 }, comboTopHalf: new Map(),
    censored: L.failure !== undefined || L.seats.some((x) => x.termination === 'failed'),
  };
  const placed = s.censored ? [] : L.seats.filter((r) => r.placement !== undefined && r.termination === 'placed');
  const placementOf = new Map(placed.map((r) => [runKey(r), r.placement!]));
  for (const r of placed) {
    addTo(part(s.placementByHero, r.heroId), r.placement!);
    addTo(part(s.topHalfByHero, r.heroId), r.placement! <= 4 ? 1 : 0);
    for (const rune of r.runesOwned) addTo(part(s.comboTopHalf, `${r.heroId}|${rune}`), r.placement! <= 4 ? 1 : 0);
  }
  // Runes: offered / picked from runeforge actions; owners from RunRecord.
  for (const a of L.actions) {
    if (a.action.type !== 'buyRune' && a.action.type !== 'skipRuneforge' && a.action.type !== 'rerollRuneforge') continue;
    const pickedId = a.action.type === 'buyRune' ? a.offers[a.action.index] : undefined;
    for (const id of a.offers) addTo(part(s.runePick, id), id === pickedId ? 1 : 0);
  }
  const runeIds = new Set(L.seats.flatMap((r) => r.runesOwned));
  for (const id of runeIds) for (const r of placed) addTo(part(r.runesOwned.includes(id) ? s.runeOwnerPlacement : s.nonOwnerPlacement, id), r.placement!);
  // Cards: offers per (seat, round, id); buys / casts from effects; final boards + holders from runs.
  const seen = new Set<string>();
  const holders = new Map<string, Set<string>>();
  const boughtPerRun = new Map<string, number>(); const castShopPerRun = new Map<string, number>();
  for (const a of L.actions) {
    const t = a.action.type;
    if (t === 'buyRune' || t === 'skipRuneforge' || t === 'rerollRuneforge' || t === 'buyQuest') continue;
    for (const id of a.offers) { if (!CARD_INDEX[id]) continue; const k = `${runKey(a)}/${a.round}/${id}`; if (seen.has(k)) continue; seen.add(k); addTo(part(s.cardBuy, id), 0); }
  }
  for (const e of L.effects) {
    const id = e.sourceId; if (!id || !CARD_INDEX[id]) continue;
    const rk = runKey(e);
    if (e.kind === 'cardGained' && e.route !== 'triple') {
      (holders.get(id) ?? holders.set(id, new Set()).get(id)!).add(rk);
      (s.cardAcqRounds.get(id) ?? s.cardAcqRounds.set(id, []).get(id)!).push(e.round);
      if (e.route === 'shop') { part(s.cardBuy, id).sum++; boughtPerRun.set(`${rk}/${id}`, (boughtPerRun.get(`${rk}/${id}`) ?? 0) + 1); }
    } else if (e.kind === 'cardPlayed') {
      (holders.get(id) ?? holders.set(id, new Set()).get(id)!).add(rk);
    } else if (e.kind === 'spellCast') {
      (holders.get(id) ?? holders.set(id, new Set()).get(id)!).add(rk);
      if (e.route === 'shop' && e.detail !== 'repeat') castShopPerRun.set(`${rk}/${id}`, (castShopPerRun.get(`${rk}/${id}`) ?? 0) + 1);
    }
  }
  const runs = L.seats.length;
  for (const [id, hs] of holders) {
    const held = new Set(hs);
    for (const r of placed) { const rk = runKey(r); addTo(part(s.cardHolders, id), held.has(rk) ? 1 : 0); if (held.has(rk)) addTo(part(s.cardPlacementHeld, id), placementOf.get(rk)!); }
    if (!placed.length) for (let i = 0; i < runs; i++) addTo(part(s.cardHolders, id), 0);
  }
  for (const r of L.seats) for (const id of new Set(r.finalBoard)) if (CARD_INDEX[id]) part(s.cardFinalBoard, id).sum++;
  for (const id of holders.keys()) { const p = part(s.cardFinalBoard, id); p.n = runs; }
  for (const [k, b] of boughtPerRun) {
    const id = k.slice(k.lastIndexOf('/') + 1);
    if (!CARD_INDEX[id]?.spell) continue;
    const c = castShopPerRun.get(k) ?? 0;
    const cp = part(s.spellCastPerBuy, id); cp.sum += Math.min(c, b); cp.n += b;
    const hp = part(s.spellHeld, id); hp.sum += Math.max(0, b - c); hp.n += b;
  }
  // Pacing.
  const prevBoard = new Map<string, readonly string[]>();
  for (const rr of L.rounds) {
    addTo(part(s.tierByRound, String(rr.round)), rr.tier);
    addTo(part(s.unspentByRound, String(rr.round)), rr.goldUnspent);
    const prev = prevBoard.get(rr.seatId);
    if (prev && rr.board.length) addTo(part(s.turnoverByRound, String(rr.round)), 1 - rr.board.filter((id) => prev.includes(id)).length / rr.board.length);
    prevBoard.set(rr.seatId, rr.board);
  }
  for (const r of L.seats) for (const id of r.finalBoard) if (CARD_INDEX[id]) addTo(s.earlyRetention, Number(CARD_INDEX[id].tier) <= 2 ? 1 : 0);
  return s;
}

// ── the compare ───────────────────────────────────────────────────────────────────────────────────────────────

export function compareJobs(baseline: readonly LobbyRecord[], candidate: readonly LobbyRecord[], opts: CompareOptions = {}): Comparison {
  const options = { minSupport: opts.minSupport ?? 20, bootstrapReps: opts.bootstrapReps ?? 1000, seed: opts.seed ?? 1 };
  const allowed = new Set<string>(opts.allowDiff ?? []);

  // Identity gate. Each job must be internally consistent; across jobs only the declared diff may differ.
  const idB = baseline[0]?.identity; const idC = candidate[0]?.identity;
  for (const [name, job] of [['baseline', baseline], ['candidate', candidate]] as const) {
    const first = job[0]?.identity;
    for (const L of job) for (const f of IDENTITY_FIELDS) if (first && L.identity[f] !== first[f]) throw new Error(`compareJobs: ${name} job is not one identity — lobby ${L.lobbyId} differs in ${f}`);
  }
  const differing = idB && idC ? IDENTITY_FIELDS.filter((f) => idB[f] !== idC[f]) : [];
  const undeclared = differing.filter((f) => !allowed.has(f));
  if (undeclared.length) {
    throw new Error(`compareJobs: identities differ in ${undeclared.map((f) => `${f} (${idB?.[f]} → ${idC?.[f]})`).join(', ')} — not declared in allowDiff. A comparison across an undeclared rules/content change is not an experiment.`);
  }
  const policyB = baseline[0]?.manifest.policy; const policyC = candidate[0]?.manifest.policy;
  const policyChanged = JSON.stringify(policyB) !== JSON.stringify(policyC);
  const rulesChanged = differing.some((f) => RULES_FIELDS.has(f));

  const sB = baseline.map(lobbyStats); const sC = candidate.map(lobbyStats);
  const bySeedB = new Map(sB.map((s) => [s.seed, s])); const bySeedC = new Map(sC.map((s) => [s.seed, s]));
  const pairedSeeds = [...bySeedB.keys()].filter((s) => bySeedC.has(s)).sort((a, b) => a - b);
  const onlyB = sB.filter((s) => !bySeedC.has(s.seed)); const onlyC = sC.filter((s) => !bySeedB.has(s.seed));
  const rng = (key: string) => keyedRng(options.seed, key);

  /** candidate − baseline of a ratio-of-sums statistic, paired by seed where possible. */
  const diff = (pick: (s: LobbyStats) => LobbyPartial | undefined, key: string): DiffCI => {
    const zero = { sum: 0, n: 0 };
    const paired = pairedSeeds.map((seed) => ({ base: pick(bySeedB.get(seed)!) ?? zero, cand: pick(bySeedC.get(seed)!) ?? zero }));
    const unpaired = { base: onlyB.map((s) => pick(s) ?? zero), cand: onlyC.map((s) => pick(s) ?? zero) };
    return bootstrapDiff(paired, unpaired, options.bootstrapReps, rng(key));
  };
  const total = (all: LobbyStats[], pick: (s: LobbyStats) => LobbyPartial | undefined): LobbyPartial => all.reduce((a, s) => { const p = pick(s); return p ? { sum: a.sum + p.sum, n: a.n + p.n } : a; }, { sum: 0, n: 0 });
  const est = (p: LobbyPartial): number | undefined => (p.n ? p.sum / p.n : undefined);
  const entity = (kind: EntityDiff['kind'], id: string, name: string, pick: (s: LobbyStats) => LobbyPartial | undefined, key: string): EntityDiff => {
    const b = total(sB, pick), c = total(sC, pick);
    return { kind, id, name, diff: diff(pick, key), baseline: est(b), candidate: est(c), nBase: b.n, nCand: c.n };
  };
  const keys = (pick: (s: LobbyStats) => Map<string, LobbyPartial>): string[] => [...new Set([...sB, ...sC].flatMap((s) => [...pick(s).keys()]))].sort();
  const bySupport = (rows: EntityDiff[]): EntityDiff[] => rows.sort((a, b) => Math.abs(b.diff.est ?? 0) - Math.abs(a.diff.est ?? 0) || a.id.localeCompare(b.id));

  const heroName = (id: string) => HEROES.find((h) => h.id === id)?.name ?? id;
  const runeName = (id: string) => RUNE_INDEX[id]?.name ?? id;
  const cardName = (id: string) => CARD_INDEX[id]?.name ?? id;

  const heroPlacement = bySupport(keys((s) => s.placementByHero).map((id) => entity('hero', id, heroName(id), (s) => s.placementByHero.get(id), `hero:${id}`)));
  const heroTopHalf = bySupport(keys((s) => s.topHalfByHero).map((id) => entity('hero', id, heroName(id), (s) => s.topHalfByHero.get(id), `hero:${id}:top`)));
  const runePickRate = bySupport(keys((s) => s.runePick).map((id) => entity('rune', id, runeName(id), (s) => s.runePick.get(id), `rune:${id}:pick`)));
  const runeLift = bySupport(keys((s) => s.runeOwnerPlacement).map((id) => {
    const own = (st: LobbyStats) => st.runeOwnerPlacement.get(id) ?? { sum: 0, n: 0 };
    const non = (st: LobbyStats) => st.nonOwnerPlacement.get(id) ?? { sum: 0, n: 0 };
    const lift = (all: LobbyStats[]): number | undefined => { const o = total(all, own), nn = total(all, non); return o.n && nn.n ? o.sum / o.n - nn.sum / nn.n : undefined; };
    const liftB = lift(sB), liftC = lift(sC);
    // Joint lobby-level bootstrap of (liftC − liftB): a resampled lobby contributes its owner AND non-owner partials.
    const r = rng(`rune:${id}:lift`);
    const draws: number[] = [];
    const lobbiesN = pairedSeeds.length + onlyB.length + onlyC.length;
    if (liftB !== undefined && liftC !== undefined && lobbiesN >= 2) {
      for (let rep = 0; rep < options.bootstrapReps; rep++) {
        const acc = { bo: { sum: 0, n: 0 }, bn: { sum: 0, n: 0 }, co: { sum: 0, n: 0 }, cn: { sum: 0, n: 0 } };
        const take = (side: 'b' | 'c', st: LobbyStats) => { const o = own(st), nn = non(st); const ko = side === 'b' ? acc.bo : acc.co, kn = side === 'b' ? acc.bn : acc.cn; ko.sum += o.sum; ko.n += o.n; kn.sum += nn.sum; kn.n += nn.n; };
        for (let i = 0; i < pairedSeeds.length; i++) { const seed = pairedSeeds[r.int(pairedSeeds.length)]; take('b', bySeedB.get(seed)!); take('c', bySeedC.get(seed)!); }
        for (let i = 0; i < onlyB.length; i++) take('b', onlyB[r.int(onlyB.length)]);
        for (let i = 0; i < onlyC.length; i++) take('c', onlyC[r.int(onlyC.length)]);
        if (acc.bo.n && acc.bn.n && acc.co.n && acc.cn.n) draws.push((acc.co.sum / acc.co.n - acc.cn.sum / acc.cn.n) - (acc.bo.sum / acc.bo.n - acc.bn.sum / acc.bn.n));
      }
    }
    draws.sort((a, b) => a - b);
    const q = (p: number) => draws[Math.min(draws.length - 1, Math.max(0, Math.round(p * (draws.length - 1))))];
    const estL = liftB !== undefined && liftC !== undefined ? liftC - liftB : undefined;
    const ownB = total(sB, own), ownC = total(sC, own);
    const diffL: DiffCI = { est: estL, lo: draws.length ? q(0.025) : estL, hi: draws.length ? q(0.975) : estL, n: ownB.n + ownC.n, lobbies: lobbiesN, paired: pairedSeeds.length };
    return { kind: 'rune' as const, id, name: runeName(id), diff: diffL, baseline: liftB, candidate: liftC, nBase: ownB.n, nCand: ownC.n };
  }));
  const minionIds = keys((s) => s.cardBuy).filter((id) => !CARD_INDEX[id]?.spell);
  const spellIds = keys((s) => s.cardBuy).filter((id) => CARD_INDEX[id]?.spell);
  const minionBuyRate = bySupport(minionIds.map((id) => entity('minion', id, cardName(id), (s) => s.cardBuy.get(id), `minion:${id}:buy`)));
  const minionFinalBoardRate = bySupport(minionIds.map((id) => entity('minion', id, cardName(id), (s) => s.cardFinalBoard.get(id), `minion:${id}:final`)));
  const minionPlacementHeld = bySupport(minionIds.map((id) => entity('minion', id, cardName(id), (s) => s.cardPlacementHeld.get(id), `minion:${id}:held`)));
  const spellBuyRate = bySupport(spellIds.map((id) => entity('spell', id, cardName(id), (s) => s.cardBuy.get(id), `spell:${id}:buy`)));
  const spellCastPerBuy = bySupport(spellIds.map((id) => entity('spell', id, cardName(id), (s) => s.spellCastPerBuy.get(id), `spell:${id}:cast`)));
  const spellHeldRate = bySupport(spellIds.map((id) => entity('spell', id, cardName(id), (s) => s.spellHeld.get(id), `spell:${id}:held`)));

  const acquisition = keys((s) => s.cardHolders).map((id) => {
    const rb = sB.flatMap((s) => s.cardAcqRounds.get(id) ?? []); const rc = sC.flatMap((s) => s.cardAcqRounds.get(id) ?? []);
    const hb = total(sB, (s) => s.cardHolders.get(id)); const hc = total(sC, (s) => s.cardHolders.get(id));
    return { id, name: cardName(id), kind: (CARD_INDEX[id]?.spell ? 'spell' : 'minion') as 'spell' | 'minion', meanBase: rb.length ? rb.reduce((a, b) => a + b, 0) / rb.length : undefined, meanCand: rc.length ? rc.reduce((a, b) => a + b, 0) / rc.length : undefined, sdBase: stddev(rb), sdCand: stddev(rc), holdersBase: hb.sum, holdersCand: hc.sum, holderRateDiff: diff((s) => s.cardHolders.get(id), `acq:${id}`) };
  }).sort((a, b) => (b.holdersBase + b.holdersCand) - (a.holdersBase + a.holdersCand) || a.id.localeCompare(b.id));

  const maxRound = Math.max(0, ...[...sB, ...sC].flatMap((s) => [...s.tierByRound.keys()].map(Number)));
  const roundSeries = (pick: (s: LobbyStats) => Map<string, LobbyPartial>, key: string): DiffCI[] =>
    Array.from({ length: maxRound }, (_, i) => diff((s) => pick(s).get(String(i + 1)), `${key}:${i + 1}`));
  const aggB = aggregate(baseline, { minSupport: options.minSupport, bootstrapReps: options.bootstrapReps, seed: options.seed });
  const aggC = aggregate(candidate, { minSupport: options.minSupport, bootstrapReps: options.bootstrapReps, seed: options.seed });

  const comboKeys = keys((s) => s.comboTopHalf);
  const combos = comboKeys.map((k) => {
    const [heroId, runeId] = k.split('|');
    const b = total(sB, (s) => s.comboTopHalf.get(k)); const c = total(sC, (s) => s.comboTopHalf.get(k));
    return { heroId, runeId, nBase: b.n, nCand: c.n, topHalfBase: est(b), topHalfCand: est(c), diff: diff((s) => s.comboTopHalf.get(k), `combo:${k}`) };
  }).filter((x) => x.nBase + x.nCand >= Math.max(5, Math.floor(options.minSupport / 4))).sort((a, b) => (b.topHalfCand ?? 0) - (a.topHalfCand ?? 0) || (b.nCand - a.nCand));

  const earlyCards = minionFinalBoardRate.filter((m) => Number(CARD_INDEX[m.id]?.tier ?? 9) <= 2);
  const unsupported = {
    baseline: [...aggB.heroes.filter((h) => h.suppressed).map((h) => `hero:${h.heroId}`), ...aggB.minions.filter((m) => m.suppressed).map((m) => `minion:${m.cardId}`), ...aggB.spells.filter((s) => s.suppressed).map((s) => `spell:${s.cardId}`), ...aggB.runes.filter((r) => r.suppressed).map((r) => `rune:${r.runeId}`)],
    candidate: [...aggC.heroes.filter((h) => h.suppressed).map((h) => `hero:${h.heroId}`), ...aggC.minions.filter((m) => m.suppressed).map((m) => `minion:${m.cardId}`), ...aggC.spells.filter((s) => s.suppressed).map((s) => `spell:${s.cardId}`), ...aggC.runes.filter((r) => r.suppressed).map((r) => `rune:${r.runeId}`)],
  };

  return {
    schemaVersion: 1,
    identity: { baseline: idB, candidate: idC, differing, allowed: [...allowed].sort(), rulesChanged, policyChanged, policy: { baseline: policyB?.id ?? '—', candidate: policyC?.id ?? '—' } },
    pairing: { pairedSeeds: pairedSeeds.length, baselineOnly: onlyB.length, candidateOnly: onlyC.length },
    coverage: { baseline: aggB.coverage, candidate: aggC.coverage },
    aggregates: { baseline: aggB, candidate: aggC },
    heroPlacement, heroTopHalf, runePickRate, runeLift, minionBuyRate, minionFinalBoardRate, minionPlacementHeld, acquisition, spellBuyRate, spellCastPerBuy, spellHeldRate,
    pacing: {
      tierByRound: roundSeries((s) => s.tierByRound, 'tier'), unspentByRound: roundSeries((s) => s.unspentByRound, 'unspent'), turnoverByRound: roundSeries((s) => s.turnoverByRound, 'turnover'),
      winnerConcentration: { baseline: aggB.pacing.winnerHeroConcentration, candidate: aggC.pacing.winnerHeroConcentration },
      finalBoardDiversity: { baseline: aggB.pacing.finalBoardDiversity, candidate: aggC.pacing.finalBoardDiversity },
      earlyCardRetention: diff((s) => s.earlyRetention, 'early'), roundsPlayed: diff((s) => s.roundsPlayed, 'rounds'),
    },
    combos, earlyCards, unsupported, options,
  };
}

/** A/A self-check: every effect estimate is exactly zero with a zero-width interval. */
export function isZeroEffect(c: Comparison): { ok: boolean; offenders: string[] } {
  const offenders: string[] = [];
  const check = (label: string, d: DiffCI | undefined): void => {
    if (!d || d.est === undefined) return;
    if (d.est !== 0 || (d.lo ?? 0) !== 0 || (d.hi ?? 0) !== 0) offenders.push(`${label}: ${d.est} [${d.lo}, ${d.hi}]`);
  };
  for (const [name, rows] of Object.entries({ heroPlacement: c.heroPlacement, heroTopHalf: c.heroTopHalf, runePickRate: c.runePickRate, minionBuyRate: c.minionBuyRate, minionFinalBoardRate: c.minionFinalBoardRate, minionPlacementHeld: c.minionPlacementHeld, spellBuyRate: c.spellBuyRate, spellCastPerBuy: c.spellCastPerBuy, spellHeldRate: c.spellHeldRate, earlyCards: c.earlyCards })) {
    for (const r of rows) check(`${name}/${r.id}`, r.diff);
  }
  for (const r of c.runeLift) check(`runeLift/${r.id}`, r.diff);
  for (const a of c.acquisition) check(`acquisition/${a.id}`, a.holderRateDiff);
  for (const k of c.combos) check(`combo/${k.heroId}|${k.runeId}`, k.diff);
  c.pacing.tierByRound.forEach((d, i) => check(`tier/r${i + 1}`, d));
  c.pacing.unspentByRound.forEach((d, i) => check(`unspent/r${i + 1}`, d));
  c.pacing.turnoverByRound.forEach((d, i) => check(`turnover/r${i + 1}`, d));
  check('earlyCardRetention', c.pacing.earlyCardRetention); check('roundsPlayed', c.pacing.roundsPlayed);
  return { ok: offenders.length === 0, offenders };
}

/** Self-check helper: compare a job against itself. */
export const selfCompare = (records: readonly LobbyRecord[], opts: CompareOptions = {}): Comparison => compareJobs(records, records, opts);

// ── markdown ──────────────────────────────────────────────────────────────────────────────────────────────────

export function renderComparison(c: Comparison, opts: { baselineId?: string; candidateId?: string; target?: CompareOptions['target']; maxRows?: number } = {}): string {
  const maxRows = opts.maxRows ?? 25;
  const o: string[] = [];
  const d = (x: DiffCI, dp = 2): string => (x.est === undefined ? '—' : `${signed(x.est, dp)} [${fmt(x.lo, dp)}, ${fmt(x.hi, dp)}] (n=${x.n}, ${x.lobbies} lobbies, ${x.paired} paired)`);
  const dp = (x: DiffCI): string => (x.est === undefined ? '—' : `${signed(x.est * 100, 0)}pp [${signed((x.lo ?? 0) * 100, 0)}, ${signed((x.hi ?? 0) * 100, 0)}] (n=${x.n}, ${x.paired} paired)`);
  const moved = (x: DiffCI): string => (x.est === undefined || x.lobbies < 2 ? 'inconclusive' : x.est === 0 && x.lo === 0 && x.hi === 0 ? 'identical' : (x.lo! > 0 || x.hi! < 0) ? '**moved**' : 'inconclusive');
  const sig = (rows: EntityDiff[]) => rows.filter((r) => r.diff.est !== undefined && r.diff.lobbies >= 2 && (r.diff.lo! > 0 || r.diff.hi! < 0));
  const minSupport = c.options.minSupport;

  o.push(`# Balance comparison — baseline \`${opts.baselineId ?? '?'}\` → candidate \`${opts.candidateId ?? '?'}\``);
  o.push('');
  o.push(`Effects are **candidate − baseline** with 95% lobby-level bootstrap intervals (${c.options.bootstrapReps} reps, seed ${c.options.seed}); placement effects are in places (negative = better). Pairing: ${c.pairing.pairedSeeds} seeds paired, ${c.pairing.baselineOnly} baseline-only, ${c.pairing.candidateOnly} candidate-only.`);
  o.push('');
  o.push('## Coverage');
  o.push('');
  o.push('| | lobbies planned/started/complete/failed/censored | runs placed/capped/failed | identity |');
  o.push('|---|---|---|---|');
  for (const [name, cov, id] of [['baseline', c.coverage.baseline, c.identity.baseline], ['candidate', c.coverage.candidate, c.identity.candidate]] as const) {
    o.push(`| ${name} | ${cov.lobbies.planned}/${cov.lobbies.started}/${cov.lobbies.complete}/${cov.lobbies.failed}/${cov.lobbies.censored} | ${cov.runs.placed}/${cov.runs.capped}/${cov.runs.failed} | engine \`${id?.engineRevision ?? '—'}\` content \`${id?.contentDigest ?? '—'}\` pool \`${id?.poolDigest ?? '—'}\` effects \`${id?.effectDigest ?? '—'}\` manifest \`${id?.manifestDigest ?? '—'}\` |`);
  }
  o.push('');

  // 1. Did the target move?
  o.push('## 1. Did the target move?');
  o.push('');
  const target = opts.target;
  if (target) {
    const rows = target.kind === 'hero' ? c.heroPlacement : target.kind === 'rune' ? c.runeLift : target.kind === 'minion' ? c.minionPlacementHeld : c.spellCastPerBuy;
    const row = rows.find((r) => r.id === target.id);
    if (!row) o.push(`Target \`${target.kind}:${target.id}\` has no support in either job — **unmeasured**.`);
    else o.push(`Target **${row.name}** (\`${target.kind}:${target.id}\`): ${fmt(row.baseline)} → ${fmt(row.candidate)}, effect ${d(row.diff)} — ${moved(row.diff)}${row.nBase < minSupport || row.nCand < minSupport ? ' _(below minSupport on at least one side)_' : ''}.`);
    o.push('');
  }
  const heroMoved = sig(c.heroPlacement);
  o.push(`Hero placement: ${heroMoved.length} of ${c.heroPlacement.length} heroes moved with an interval excluding zero.`);
  o.push('');
  o.push('| hero | baseline | candidate | effect (places) | verdict |');
  o.push('|---|---|---|---|---|');
  for (const r of c.heroPlacement.slice(0, maxRows)) o.push(`| ${r.name} (\`${r.id}\`) | ${fmt(r.baseline)} (n=${r.nBase}) | ${fmt(r.candidate)} (n=${r.nCand}) | ${d(r.diff)} | ${moved(r.diff)} |`);
  o.push('');

  // 2. Rules or policy?
  o.push('## 2. Did it move because of rules or policy behaviour?');
  o.push('');
  o.push(`Identity fields that differ: ${c.identity.differing.length ? c.identity.differing.map((f) => `\`${f}\``).join(', ') : 'none'} (declared: ${c.identity.allowed.length ? c.identity.allowed.map((f) => `\`${f}\``).join(', ') : 'none'}). Policy: \`${c.identity.policy.baseline}\` → \`${c.identity.policy.candidate}\`${c.identity.policyChanged ? ' (**changed**)' : ' (frozen)'}.`);
  o.push('');
  if (c.identity.rulesChanged && !c.identity.policyChanged) o.push('Policy frozen, rules changed → the movement above is attributable to the rules change under this pilot population (level 3, immediate impact; adapt/retrain separately for the new meta).');
  else if (!c.identity.rulesChanged && c.identity.policyChanged) o.push('Rules identical, policy changed → the movement measures the PILOT, not the game.');
  else if (c.identity.rulesChanged && c.identity.policyChanged) o.push('**Confounded:** both rules and policy changed. Re-run with the policy frozen before attributing anything to the rules.');
  else o.push('Neither rules nor policy changed — this is an A/A (or a seed-schedule) comparison; any movement is noise or schedule.');
  o.push('');

  // 3. Acquisition consistency
  o.push('## 3. Did acquisition become less consistent?');
  o.push('');
  o.push('| card | holders base → cand | holder-rate effect | acq. round mean base → cand | acq. round sd base → cand |');
  o.push('|---|---|---|---|---|');
  for (const a of c.acquisition.slice(0, maxRows)) o.push(`| ${a.name} (\`${a.id}\`) | ${a.holdersBase} → ${a.holdersCand} | ${dp(a.holderRateDiff)} | ${fmt(a.meanBase, 1)} → ${fmt(a.meanCand, 1)} | ${fmt(a.sdBase, 2)} → ${fmt(a.sdCand, 2)} |`);
  o.push('');
  o.push('Rune pick rates:');
  o.push('');
  o.push('| rune | base | cand | effect |');
  o.push('|---|---|---|---|');
  for (const r of c.runePickRate.slice(0, maxRows)) o.push(`| ${r.name} (\`${r.id}\`) | ${pct(r.baseline)} (${r.nBase}) | ${pct(r.candidate)} (${r.nCand}) | ${dp(r.diff)} |`);
  o.push('');

  // 4. Dominant combos
  o.push('## 4. Did a hero / rune combination become dominant?');
  o.push('');
  o.push(`Winner-hero concentration (Herfindahl): ${fmt(c.pacing.winnerConcentration.baseline, 3)} → ${fmt(c.pacing.winnerConcentration.candidate, 3)}.`);
  o.push('');
  if (!c.combos.length) o.push('_No hero × rune combination reaches the support floor on either side._');
  else {
    o.push('| hero | rune | top-half base (n) | top-half cand (n) | effect |');
    o.push('|---|---|---|---|---|');
    for (const k of c.combos.slice(0, maxRows)) o.push(`| ${k.heroId} | ${RUNE_INDEX[k.runeId]?.name ?? k.runeId} | ${pct(k.topHalfBase)} (${k.nBase}) | ${pct(k.topHalfCand)} (${k.nCand}) | ${dp(k.diff)} |`);
  }
  o.push('');
  o.push('Rune lift (owners − non-owners placement), base → cand:');
  o.push('');
  o.push('| rune | lift base | lift cand | Δ lift |');
  o.push('|---|---|---|---|');
  for (const r of c.runeLift.slice(0, maxRows)) o.push(`| ${r.name} (\`${r.id}\`) | ${signed(r.baseline)} | ${signed(r.candidate)} | ${d(r.diff)} |`);
  o.push('');

  // 5. Pacing / diversity
  o.push('## 5. Did pacing or strategy diversity deteriorate?');
  o.push('');
  o.push(`Rounds played: ${d(c.pacing.roundsPlayed, 1)}. Final-board diversity: ${fmt(c.pacing.finalBoardDiversity.baseline, 3)} → ${fmt(c.pacing.finalBoardDiversity.candidate, 3)}.`);
  o.push('');
  o.push('| round | Δ mean tier | Δ unspent Gold | Δ board turnover |');
  o.push('|---|---|---|---|');
  for (let i = 0; i < c.pacing.tierByRound.length; i++) o.push(`| ${i + 1} | ${d(c.pacing.tierByRound[i])} | ${d(c.pacing.unspentByRound[i])} | ${dp(c.pacing.turnoverByRound[i])} |`);
  o.push('');
  o.push('Minion buy-rate movers:');
  o.push('');
  o.push('| minion | buy% base | buy% cand | effect |');
  o.push('|---|---|---|---|');
  for (const r of c.minionBuyRate.slice(0, maxRows)) o.push(`| ${r.name} (\`${r.id}\`) | ${pct(r.baseline)} (${r.nBase}) | ${pct(r.candidate)} (${r.nCand}) | ${dp(r.diff)} |`);
  o.push('');
  o.push('Spell cast-per-buy / held-unused movers:');
  o.push('');
  o.push('| spell | cast/buy base → cand | effect | held-unused base → cand | effect |');
  o.push('|---|---|---|---|---|');
  for (const r of c.spellCastPerBuy.slice(0, maxRows)) { const h = c.spellHeldRate.find((x) => x.id === r.id); o.push(`| ${r.name} (\`${r.id}\`) | ${pct(r.baseline)} → ${pct(r.candidate)} | ${dp(r.diff)} | ${pct(h?.baseline)} → ${pct(h?.candidate)} | ${h ? dp(h.diff) : '—'} |`); }
  o.push('');

  // 6. Early cards
  o.push('## 6. Did early cards lose their role?');
  o.push('');
  o.push(`Tier 1–2 share of final-board slots: ${dp(c.pacing.earlyCardRetention)}.`);
  o.push('');
  o.push('| card (T1–2) | final-board rate base | cand | effect |');
  o.push('|---|---|---|---|');
  for (const r of c.earlyCards.slice(0, maxRows)) o.push(`| ${r.name} (\`${r.id}\`) | ${pct(r.baseline)} (${r.nBase}) | ${pct(r.candidate)} (${r.nCand}) | ${dp(r.diff)} |`);
  o.push('');

  // 7. Unsupported
  o.push('## 7. What remains unsupported?');
  o.push('');
  o.push(`Below minSupport (${minSupport} runs) — labelled, never ranked: baseline ${c.unsupported.baseline.length} entities, candidate ${c.unsupported.candidate.length} entities.`);
  const both = c.unsupported.candidate.filter((x) => c.unsupported.baseline.includes(x));
  if (both.length) o.push(`\nUnsupported on BOTH sides (${both.length}): ${both.slice(0, 40).map((x) => `\`${x}\``).join(', ')}${both.length > 40 ? ', …' : ''}.`);
  o.push('');
  o.push('_An inconclusive interval means inconclusive, not balanced. Level-3 evidence requires a frozen policy and a declared single change._');
  return o.join('\n');
}
