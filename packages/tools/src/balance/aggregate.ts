/**
 * BALANCE BOT B5 — aggregation over `LobbyRecord[]` (docs/balance-bot-roadmap.md, "Telemetry and analytics").
 *
 * Input: records only (from the store, or the synthetic fixture). Output: the coverage ledger FIRST, then the four
 * tables — Heroes, Runes, Minions, Spells — plus pacing. Every number carries its count; every interval is a
 * lobby-level bootstrap (`stats.ts`); rows below `minSupport` runs are kept but flagged `suppressed` so the report
 * can label rather than rank them. Deterministic: same records + same options → identical output.
 *
 * Evidence level of everything here is 1 (DESCRIPTIVE): co-occurrence of an entity with a placement is a lead, not
 * that entity's causal power. The compare (B6) is where a rules change becomes evidence.
 *
 * Censoring: a lobby with `failure`, or any seat with `termination === 'failed'`, is dropped from OUTCOME tables
 * (placement, top-half, lift) but still counted in coverage and in the funnels (what the pilots saw and did is
 * still real). A `capped` run has no placement and is excluded from placement statistics only.
 */
import { CARD_INDEX, HEROES, RUNE_INDEX, type LobbyRecord, type RoundRecord } from './deps';
import { bootstrapMean, keyedRng, shrink, type CI, type LobbyPartial, EMPTY_CI, mean, herfindahl, fnv1a } from './stats';

export interface AggregateOptions {
  /** Runs below this are labelled `suppressed` (kept, never ranked). Default 20. */
  minSupport?: number;
  /** Bootstrap replicates. Default 1000. */
  bootstrapReps?: number;
  /** Bootstrap seed. Default 1. */
  seed?: number;
  /** Shrinkage weight (pseudo-runs at the population mean) for sparse minion / spell placement rows. Default 10. */
  shrinkK?: number;
}

export interface Coverage {
  lobbies: { planned: number; started: number; complete: number; failed: number; censored: number; capped: number };
  runs: { started: number; placed: number; capped: number; failed: number };
  failureByHero: Record<string, { runs: number; failed: number; rate: number }>;
  failureByPolicy: Record<string, { runs: number; failed: number; rate: number }>;
  /** Distinct manifests / identities seen — a report over mixed identities is flagged. */
  manifestDigests: string[];
  identityDigests: string[];
  modes: string[];
  setIds: string[];
  policies: string[];
  roundsPlayed: { mean: number | undefined; min: number; max: number };
  /** Records whose manifest says something the report refuses to pool (legacy course, pinned lobby…). */
  refusedModes: string[];
}

export interface HeroRow {
  heroId: string;
  name: string;
  /** Runs where this hero was eligible (present in the run's set + tribes) — from the manifest roster or every seat's tribes. */
  eligible: number;
  assigned: number;
  placement: CI;
  topHalf: CI;
  eliminationRounds: Record<number, number>;
  heroPowerUses: number;
  powerUsesPerRun: number | undefined;
  suppressed: boolean;
}

export interface RuneRow {
  runeId: string;
  name: string;
  offered: number;
  picked: number;
  skipped: number;
  pickRate: number | undefined;
  acquisitionRound: number | undefined;
  owners: number;
  ownersPlacement: CI;
  nonOwnersPlacement: CI;
  /** owners − non-owners mean placement (negative = owners place better). Descriptive only. */
  lift: CI;
  suppressed: boolean;
}

export interface MinionRow {
  cardId: string;
  name: string;
  tier: number;
  offered: number;
  bought: number;
  played: number;
  sold: number;
  tripled: number;
  finalBoard: number;
  buyRate: number | undefined;
  playRate: number | undefined;
  acquisitionRound: number | undefined;
  acquisitionTier: number | undefined;
  heldRounds: number | undefined;
  runsHeld: number;
  placementHeld: CI;
  placementNotHeld: CI;
  /** `placementHeld.est` shrunk toward the population mean by `shrinkK` pseudo-runs. */
  shrunkPlacement: number | undefined;
  finalBoardRate: number | undefined;
  suppressed: boolean;
}

export interface SpellRow {
  cardId: string;
  name: string;
  tier: number;
  offered: number;
  bought: number;
  cast: number;
  castShop: number;
  castGenerated: number;
  castOther: number;
  repeats: number;
  /** Bought copies never cast (per run, clipped at 0) over bought. */
  heldUnused: number;
  heldRate: number | undefined;
  buyRate: number | undefined;
  runsCast: number;
  placementCast: CI;
  placementNotCast: CI;
  shrunkPlacement: number | undefined;
  suppressed: boolean;
}

export interface Pacing {
  tierByRound: { round: number; mean: number | undefined; n: number }[];
  unspentByRound: { round: number; mean: number | undefined; n: number }[];
  /** Board turnover: share of a seat's board that is new since the previous round. */
  turnoverByRound: { round: number; mean: number | undefined; n: number }[];
  actionsPerTurn: number | undefined;
  results: Record<RoundRecord['result'], number>;
  /** Herfindahl concentration of winners' heroes (placement 1) — 1 = one hero wins everything. */
  winnerHeroConcentration: number | undefined;
  /** Distinct card ids on final boards over all final-board slots. */
  finalBoardDiversity: number | undefined;
  /** Share of final-board slots holding a Tier 1–2 card. */
  earlyCardRetention: number | undefined;
}

export interface Problem {
  kind: 'hero' | 'rune' | 'minion' | 'spell';
  id: string;
  name: string;
  /** Effect size in placement units (negative = better than the population). */
  effect: number;
  ci: CI;
  evidenceLevel: 1;
  note: string;
}

export interface Aggregate {
  schemaVersion: 1;
  options: Required<AggregateOptions>;
  coverage: Coverage;
  populationPlacement: CI;
  heroes: HeroRow[];
  runes: RuneRow[];
  minions: MinionRow[];
  spells: SpellRow[];
  pacing: Pacing;
  problems: Problem[];
  /** Digest of the records that produced this aggregate (lobby ids + seeds) — the header prints it. */
  recordsDigest: string;
}

const POOLABLE_MODES = new Set(['selfPlayLobby', 'pinnedLobby', 'scenario']);
const runKey = (r: { lobbyId: string; seatId: string }): string => `${r.lobbyId}/${r.seatId}`;

export function aggregate(records: readonly LobbyRecord[], opts: AggregateOptions = {}): Aggregate {
  const options: Required<AggregateOptions> = { minSupport: opts.minSupport ?? 20, bootstrapReps: opts.bootstrapReps ?? 1000, seed: opts.seed ?? 1, shrinkK: opts.shrinkK ?? 10 };
  const rngFor = (key: string) => keyedRng(options.seed, key);
  const ci = (partials: readonly LobbyPartial[], key: string): CI => bootstrapMean(partials, options.bootstrapReps, rngFor(key));

  // ── coverage ────────────────────────────────────────────────────────────────────────────────────────────────
  const manifests = new Map<string, LobbyRecord['manifest']>();
  const identities = new Set<string>();
  const refused = new Set<string>();
  for (const L of records) {
    manifests.set(L.identity.manifestDigest, L.manifest);
    identities.add(identityDigest(L.identity));
    if (!POOLABLE_MODES.has(L.manifest.mode)) refused.add(L.manifest.mode);
  }
  const usable = records.filter((L) => POOLABLE_MODES.has(L.manifest.mode));
  const planned = [...manifests.values()].reduce((a, m) => a + m.seeds.count, 0);
  const lobbyFailed = (L: LobbyRecord): boolean => L.failure !== undefined;
  const lobbyCensored = (L: LobbyRecord): boolean => lobbyFailed(L) || L.seats.some((s) => s.termination === 'failed');
  const outcomeLobbies = usable.filter((L) => !lobbyCensored(L));
  const allRuns = usable.flatMap((L) => L.seats);
  const byHero: Coverage['failureByHero'] = {};
  const byPolicy: Coverage['failureByPolicy'] = {};
  for (const r of allRuns) {
    const h = (byHero[r.heroId] ??= { runs: 0, failed: 0, rate: 0 }); h.runs++; if (r.termination === 'failed') h.failed++;
    const p = (byPolicy[r.policyId] ??= { runs: 0, failed: 0, rate: 0 }); p.runs++; if (r.termination === 'failed') p.failed++;
  }
  for (const v of Object.values(byHero)) v.rate = v.runs ? v.failed / v.runs : 0;
  for (const v of Object.values(byPolicy)) v.rate = v.runs ? v.failed / v.runs : 0;
  const coverage: Coverage = {
    lobbies: {
      planned, started: records.length, complete: usable.filter((L) => !lobbyCensored(L)).length,
      failed: usable.filter(lobbyFailed).length, censored: usable.filter(lobbyCensored).length,
      capped: outcomeLobbies.filter((L) => L.seats.some((s) => s.termination === 'capped')).length,
    },
    runs: {
      started: allRuns.length, placed: allRuns.filter((r) => r.placement !== undefined && r.termination === 'placed').length,
      capped: allRuns.filter((r) => r.termination === 'capped').length, failed: allRuns.filter((r) => r.termination === 'failed').length,
    },
    failureByHero: sortedRecord(byHero), failureByPolicy: sortedRecord(byPolicy),
    manifestDigests: [...manifests.keys()].sort(), identityDigests: [...identities].sort(),
    modes: [...new Set(records.map((L) => L.manifest.mode))].sort(),
    setIds: [...new Set(records.map((L) => L.manifest.setId))].sort(),
    policies: [...new Set(allRuns.map((r) => r.policyId))].sort(),
    roundsPlayed: { mean: mean(usable.map((L) => L.roundsPlayed)), min: Math.min(...usable.map((L) => L.roundsPlayed), Infinity), max: Math.max(...usable.map((L) => L.roundsPlayed), -Infinity) },
    refusedModes: [...refused].sort(),
  };
  if (!usable.length) { coverage.roundsPlayed = { mean: undefined, min: 0, max: 0 }; }

  // ── indices over outcome lobbies ────────────────────────────────────────────────────────────────────────────
  const placedRuns = outcomeLobbies.flatMap((L) => L.seats.filter((s) => s.placement !== undefined && s.termination === 'placed'));
  const placementOf = new Map(placedRuns.map((r) => [runKey(r), r.placement!]));
  const lobbyOfRun = new Map(placedRuns.map((r) => [runKey(r), r.lobbyId]));
  const populationPlacement = ci(perLobby(placedRuns, (r) => r.placement!), 'population');
  const popMean = populationPlacement.est ?? 4.5;

  /** Placement CI over a SET of run keys (lobby-level partials), and over its complement. */
  const placementSplit = (keys: ReadonlySet<string>, key: string): { inside: CI; outside: CI } => {
    const ins: Map<string, LobbyPartial> = new Map(); const outs: Map<string, LobbyPartial> = new Map();
    for (const r of placedRuns) {
      const k = runKey(r); const m = keys.has(k) ? ins : outs;
      const p = m.get(r.lobbyId) ?? { sum: 0, n: 0 }; p.sum += r.placement!; p.n++; m.set(r.lobbyId, p);
    }
    return { inside: ci([...ins.values()], key + ':in'), outside: ci([...outs.values()], key + ':out') };
  };

  // ── heroes ──────────────────────────────────────────────────────────────────────────────────────────────────
  const heroRows: HeroRow[] = [];
  const heroIds = new Set<string>(allRuns.map((r) => r.heroId));
  const powerUses = new Map<string, number>();
  for (const L of usable) for (const e of L.effects) if (e.kind === 'heroPower') powerUses.set(runKey(e), (powerUses.get(runKey(e)) ?? 0) + 1);
  // Eligibility: the manifest roster when given, else the production rule (every enabled hero whose tribe gate meets the run's tribes).
  const eligibleCount = new Map<string, number>();
  for (const L of usable) {
    const roster = L.manifest.heroes?.length ? L.manifest.heroes : eligibleHeroes(L.seats[0]?.tribes ?? []);
    for (const id of roster) eligibleCount.set(id, (eligibleCount.get(id) ?? 0) + L.seats.length);
  }
  for (const id of [...heroIds, ...eligibleCount.keys()].filter((v, i, a) => a.indexOf(v) === i).sort()) {
    const runs = allRuns.filter((r) => r.heroId === id);
    const placed = placedRuns.filter((r) => r.heroId === id);
    const elim: Record<number, number> = {};
    for (const r of placed) if (r.eliminatedRound !== undefined) elim[r.eliminatedRound] = (elim[r.eliminatedRound] ?? 0) + 1;
    const uses = runs.reduce((a, r) => a + (powerUses.get(runKey(r)) ?? 0), 0);
    heroRows.push({
      heroId: id, name: HEROES.find((h) => h.id === id)?.name ?? id,
      eligible: eligibleCount.get(id) ?? 0, assigned: runs.length,
      placement: ci(perLobby(placed, (r) => r.placement!), `hero:${id}`),
      topHalf: ci(perLobby(placed, (r) => (r.placement! <= 4 ? 1 : 0)), `hero:${id}:top`),
      eliminationRounds: elim, heroPowerUses: uses, powerUsesPerRun: runs.length ? uses / runs.length : undefined,
      suppressed: placed.length < options.minSupport,
    });
  }

  // ── runes ───────────────────────────────────────────────────────────────────────────────────────────────────
  const runeOffered = new Map<string, number>(); const runePicked = new Map<string, number>(); const runeSkipped = new Map<string, number>();
  const runeRounds = new Map<string, number[]>(); const runeOwners = new Map<string, Set<string>>();
  for (const L of usable) {
    for (const a of L.actions) {
      if (a.action.type !== 'buyRune' && a.action.type !== 'skipRuneforge' && a.action.type !== 'rerollRuneforge') continue;
      const pickedId = a.action.type === 'buyRune' ? a.offers[a.action.index] : undefined;
      for (const id of a.offers) {
        runeOffered.set(id, (runeOffered.get(id) ?? 0) + 1);
        if (id !== pickedId && a.action.type !== 'rerollRuneforge') runeSkipped.set(id, (runeSkipped.get(id) ?? 0) + 1);
      }
    }
    for (const e of L.effects) {
      if (e.kind !== 'runePicked' || !e.sourceId) continue;
      runePicked.set(e.sourceId, (runePicked.get(e.sourceId) ?? 0) + 1);
      (runeRounds.get(e.sourceId) ?? runeRounds.set(e.sourceId, []).get(e.sourceId)!).push(e.round);
    }
    for (const s of L.seats) for (const id of s.runesOwned) (runeOwners.get(id) ?? runeOwners.set(id, new Set()).get(id)!).add(runKey(s));
  }
  const runeRows: RuneRow[] = [];
  for (const id of [...new Set([...runeOffered.keys(), ...runeOwners.keys()])].sort()) {
    const owners = runeOwners.get(id) ?? new Set<string>();
    const ownersPlaced = [...owners].filter((k) => placementOf.has(k));
    const split = placementSplit(owners, `rune:${id}`);
    const lift = diffCI(ownersPlaced.map((k) => ({ lobby: lobbyOfRun.get(k)!, v: placementOf.get(k)! })), placedRuns.filter((r) => !owners.has(runKey(r))).map((r) => ({ lobby: r.lobbyId, v: r.placement! })), options.bootstrapReps, rngFor(`rune:${id}:lift`));
    const offered = runeOffered.get(id) ?? 0; const picked = runePicked.get(id) ?? 0;
    runeRows.push({
      runeId: id, name: RUNE_INDEX[id]?.name ?? id, offered, picked, skipped: runeSkipped.get(id) ?? 0,
      pickRate: offered ? picked / offered : undefined, acquisitionRound: mean(runeRounds.get(id) ?? []),
      owners: ownersPlaced.length, ownersPlacement: split.inside, nonOwnersPlacement: split.outside, lift,
      suppressed: ownersPlaced.length < options.minSupport,
    });
  }

  // ── minions + spells (shared funnel scan) ───────────────────────────────────────────────────────────────────
  interface Funnel { offered: number; bought: number; played: number; sold: number; tripled: number; finalBoard: number; cast: number; castShop: number; castGenerated: number; castOther: number; repeats: number; acqRounds: number[]; acqTiers: number[]; held: Map<string, number>; runs: Set<string>; runsCast: Set<string>; boughtPerRun: Map<string, number>; castShopPerRun: Map<string, number> }
  const funnels = new Map<string, Funnel>();
  const F = (id: string): Funnel => funnels.get(id) ?? funnels.set(id, { offered: 0, bought: 0, played: 0, sold: 0, tripled: 0, finalBoard: 0, cast: 0, castShop: 0, castGenerated: 0, castOther: 0, repeats: 0, acqRounds: [], acqTiers: [], held: new Map(), runs: new Set(), runsCast: new Set(), boughtPerRun: new Map(), castShopPerRun: new Map() }).get(id)!;
  const bump = (m: Map<string, number>, k: string, by = 1): void => { m.set(k, (m.get(k) ?? 0) + by); };
  let actionsCounted = 0; const turnsSeen = new Set<string>();
  for (const L of usable) {
    const tierAt = new Map<string, number>();
    for (const r of L.rounds) tierAt.set(`${r.seatId}/${r.round}`, r.tier);
    // Offers: one sighting per (seat, round, card id) — a card lingering through five actions is one offer.
    const seen = new Set<string>();
    for (const a of L.actions) {
      const rk = runKey(a);
      turnsSeen.add(`${rk}/${a.round}`);
      const t = a.action.type;
      if (t !== 'faceOmen' && t !== 'settleCombat' && t !== 'resolveCombat') actionsCounted++;
      if (t === 'buyRune' || t === 'skipRuneforge' || t === 'rerollRuneforge' || t === 'buyQuest') continue;
      for (const id of a.offers) {
        if (!CARD_INDEX[id]) continue;
        const k = `${rk}/${a.round}/${id}`;
        if (seen.has(k)) continue;
        seen.add(k); F(id).offered++;
      }
    }
    for (const e of L.effects) {
      const id = e.sourceId; if (!id || !CARD_INDEX[id]) continue;
      const rk = runKey(e); const f = F(id);
      switch (e.kind) {
        case 'cardGained':
          if (e.route === 'triple') { f.tripled++; break; }
          f.runs.add(rk); f.acqRounds.push(e.round); f.acqTiers.push(tierAt.get(`${e.seatId}/${e.round}`) ?? 1);
          if (e.route === 'shop') { f.bought++; bump(f.boughtPerRun, rk); }
          break;
        case 'cardPlayed': f.played++; f.runs.add(rk); break;
        case 'cardSold': f.sold++; break;
        case 'spellCast':
          f.cast++; f.runsCast.add(rk); f.runs.add(rk);
          if (e.detail === 'repeat') f.repeats++;
          else if (e.route === 'shop') { f.castShop++; bump(f.castShopPerRun, rk); }
          else if (e.route === 'generated') f.castGenerated++;
          else f.castOther++;
          break;
        default: break;
      }
    }
    for (const r of L.rounds) for (const id of new Set([...r.board, ...r.hand])) if (CARD_INDEX[id]) bump(F(id).held, runKey(r));
    for (const s of L.seats) for (const id of s.finalBoard) if (CARD_INDEX[id]) F(id).finalBoard++;
  }
  const minionRows: MinionRow[] = []; const spellRows: SpellRow[] = [];
  for (const id of [...funnels.keys()].sort()) {
    const f = funnels.get(id)!; const def = CARD_INDEX[id];
    const runsPlaced = [...f.runs].filter((k) => placementOf.has(k));
    const split = placementSplit(f.runs, `card:${id}`);
    const shrunk = split.inside.est === undefined ? undefined : shrink(split.inside.est, runsPlaced.length, popMean, options.shrinkK);
    if (def.spell) {
      let heldUnused = 0;
      for (const [rk, b] of f.boughtPerRun) heldUnused += Math.max(0, b - (f.castShopPerRun.get(rk) ?? 0));
      const castSplit = placementSplit(f.runsCast, `spell:${id}`);
      const castPlaced = [...f.runsCast].filter((k) => placementOf.has(k));
      spellRows.push({
        cardId: id, name: def.name, tier: Number(def.tier), offered: f.offered, bought: f.bought, cast: f.cast, castShop: f.castShop, castGenerated: f.castGenerated, castOther: f.castOther, repeats: f.repeats,
        heldUnused, heldRate: f.bought ? heldUnused / f.bought : undefined, buyRate: f.offered ? f.bought / f.offered : undefined,
        runsCast: castPlaced.length, placementCast: castSplit.inside, placementNotCast: castSplit.outside,
        shrunkPlacement: castSplit.inside.est === undefined ? undefined : shrink(castSplit.inside.est, castPlaced.length, popMean, options.shrinkK),
        suppressed: castPlaced.length < options.minSupport,
      });
    } else {
      const heldRounds = mean([...f.held.values()]);
      minionRows.push({
        cardId: id, name: def.name, tier: Number(def.tier), offered: f.offered, bought: f.bought, played: f.played, sold: f.sold, tripled: f.tripled, finalBoard: f.finalBoard,
        buyRate: f.offered ? f.bought / f.offered : undefined, playRate: f.bought ? f.played / f.bought : undefined,
        acquisitionRound: mean(f.acqRounds), acquisitionTier: mean(f.acqTiers), heldRounds,
        runsHeld: runsPlaced.length, placementHeld: split.inside, placementNotHeld: split.outside, shrunkPlacement: shrunk,
        finalBoardRate: f.runs.size ? f.finalBoard / f.runs.size : undefined,
        suppressed: runsPlaced.length < options.minSupport,
      });
    }
  }

  // ── pacing ──────────────────────────────────────────────────────────────────────────────────────────────────
  const maxRound = usable.reduce((m, L) => Math.max(m, L.roundsPlayed), 0);
  const tierBy: LobbyPartial[][] = []; const unspentBy: LobbyPartial[][] = []; const turnBy: LobbyPartial[][] = [];
  const results: Pacing['results'] = { win: 0, loss: 0, tie: 0, bye: 0 };
  for (const L of usable) {
    const prevBoard = new Map<string, readonly string[]>();
    for (let r = 1; r <= L.roundsPlayed; r++) { for (const arr of [tierBy, unspentBy, turnBy]) (arr[r] ??= []); }
    const tp = new Map<number, LobbyPartial>(); const up = new Map<number, LobbyPartial>(); const tu = new Map<number, LobbyPartial>();
    for (const rr of L.rounds) {
      results[rr.result]++;
      add(tp, rr.round, rr.tier); add(up, rr.round, rr.goldUnspent);
      const prev = prevBoard.get(rr.seatId);
      if (prev && rr.board.length) { const stay = rr.board.filter((id) => prev.includes(id)).length; add(tu, rr.round, 1 - stay / rr.board.length); }
      prevBoard.set(rr.seatId, rr.board);
    }
    for (const [r, p] of tp) tierBy[r].push(p); for (const [r, p] of up) unspentBy[r].push(p); for (const [r, p] of tu) turnBy[r].push(p);
  }
  const series = (arr: LobbyPartial[][], key: string) => Array.from({ length: maxRound }, (_, i) => { const r = i + 1; const c = ci(arr[r] ?? [], `${key}:${r}`); return { round: r, mean: c.est, n: c.n }; });
  const winners = placedRuns.filter((r) => r.placement === 1);
  const winnerCounts = new Map<string, number>(); for (const w of winners) bump(winnerCounts, w.heroId);
  const finalSlots = allRuns.flatMap((r) => r.finalBoard).filter((id) => CARD_INDEX[id]);
  const pacing: Pacing = {
    tierByRound: series(tierBy, 'tier'), unspentByRound: series(unspentBy, 'unspent'), turnoverByRound: series(turnBy, 'turnover'),
    actionsPerTurn: turnsSeen.size ? actionsCounted / turnsSeen.size : undefined, results,
    winnerHeroConcentration: herfindahl([...winnerCounts.values()]),
    finalBoardDiversity: finalSlots.length ? new Set(finalSlots).size / finalSlots.length : undefined,
    earlyCardRetention: finalSlots.length ? finalSlots.filter((id) => Number(CARD_INDEX[id].tier) <= 2).length / finalSlots.length : undefined,
  };

  // ── likely problems: CI excludes the population mean, ranked by effect size ─────────────────────────────────
  const problems: Problem[] = [];
  for (const h of heroRows) if (!h.suppressed && h.placement.est !== undefined && h.placement.lobbies >= 2 && (h.placement.lo! > popMean || h.placement.hi! < popMean)) {
    problems.push({ kind: 'hero', id: h.heroId, name: h.name, effect: h.placement.est - popMean, ci: h.placement, evidenceLevel: 1, note: `mean placement ${fmt(h.placement.est)} vs population ${fmt(popMean)} over ${h.placement.n} placed runs` });
  }
  for (const r of runeRows) if (!r.suppressed && r.lift.est !== undefined && r.lift.lobbies >= 2 && (r.lift.lo! > 0 || r.lift.hi! < 0)) {
    problems.push({ kind: 'rune', id: r.runeId, name: r.name, effect: r.lift.est, ci: r.lift, evidenceLevel: 1, note: `owners ${fmt(r.ownersPlacement.est)} vs non-owners ${fmt(r.nonOwnersPlacement.est)} (${r.owners} owner runs; co-occurrence, not causation)` });
  }
  for (const m of minionRows) if (!m.suppressed && m.placementHeld.est !== undefined && m.placementHeld.lobbies >= 2 && (m.placementHeld.lo! > popMean || m.placementHeld.hi! < popMean)) {
    problems.push({ kind: 'minion', id: m.cardId, name: m.name, effect: m.placementHeld.est - popMean, ci: m.placementHeld, evidenceLevel: 1, note: `runs that held it ${fmt(m.placementHeld.est)} vs population ${fmt(popMean)} (${m.runsHeld} runs; shrunk ${fmt(m.shrunkPlacement)})` });
  }
  for (const s of spellRows) if (!s.suppressed && s.placementCast.est !== undefined && s.placementCast.lobbies >= 2 && (s.placementCast.lo! > popMean || s.placementCast.hi! < popMean)) {
    problems.push({ kind: 'spell', id: s.cardId, name: s.name, effect: s.placementCast.est - popMean, ci: s.placementCast, evidenceLevel: 1, note: `runs that cast it ${fmt(s.placementCast.est)} vs population ${fmt(popMean)} (${s.runsCast} runs; shrunk ${fmt(s.shrunkPlacement)})` });
  }
  problems.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect) || a.id.localeCompare(b.id));

  return {
    schemaVersion: 1, options, coverage, populationPlacement, heroes: heroRows, runes: runeRows, minions: minionRows, spells: spellRows, pacing, problems,
    recordsDigest: fnv1a(records.map((L) => `${L.lobbyId}#${L.seed}#${L.roundsPlayed}#${L.failure ?? ''}`).sort().join('|')),
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

export const identityDigest = (id: LobbyRecord['identity']): string =>
  fnv1a([id.engineRevision, id.dirtyDigest, id.contentDigest, id.poolDigest, id.effectDigest, id.manifestDigest].join('|'));

function eligibleHeroes(tribes: readonly string[]): string[] {
  return HEROES.filter((h) => !h.wip && !h.practiceOnly && (!h.tribes || !tribes.length || h.tribes.some((t) => tribes.includes(t)))).map((h) => h.id);
}

/** Group runs into per-lobby partial sums of `f`. */
export function perLobby<T extends { lobbyId: string }>(runs: readonly T[], f: (r: T) => number): LobbyPartial[] {
  const m = new Map<string, LobbyPartial>();
  for (const r of runs) { const p = m.get(r.lobbyId) ?? { sum: 0, n: 0 }; p.sum += f(r); p.n++; m.set(r.lobbyId, p); }
  return [...m.values()];
}

function add(m: Map<number, LobbyPartial>, k: number, v: number): void { const p = m.get(k) ?? { sum: 0, n: 0 }; p.sum += v; p.n++; m.set(k, p); }

/** Difference of two means (a − b) with a lobby-level bootstrap; the two groups may share lobbies (resampled together). */
function diffCI(a: readonly { lobby: string; v: number }[], b: readonly { lobby: string; v: number }[], reps: number, rng: ReturnType<typeof keyedRng>): CI {
  const lobbies = new Map<string, { a: LobbyPartial; b: LobbyPartial }>();
  const at = (l: string) => lobbies.get(l) ?? lobbies.set(l, { a: { sum: 0, n: 0 }, b: { sum: 0, n: 0 } }).get(l)!;
  for (const x of a) { const p = at(x.lobby).a; p.sum += x.v; p.n++; }
  for (const x of b) { const p = at(x.lobby).b; p.sum += x.v; p.n++; }
  const L = [...lobbies.values()];
  const tot = (sel: (x: typeof L[number]) => LobbyPartial): LobbyPartial => L.reduce((acc, x) => ({ sum: acc.sum + sel(x).sum, n: acc.n + sel(x).n }), { sum: 0, n: 0 });
  const A = tot((x) => x.a), B = tot((x) => x.b);
  if (!A.n || !B.n) return EMPTY_CI;
  const est = A.sum / A.n - B.sum / B.n;
  if (L.length < 2) return { est, lo: est, hi: est, n: A.n + B.n, lobbies: L.length };
  const draws: number[] = [];
  for (let r = 0; r < reps; r++) {
    let as = 0, an = 0, bs = 0, bn = 0;
    for (let i = 0; i < L.length; i++) { const x = L[rng.int(L.length)]; as += x.a.sum; an += x.a.n; bs += x.b.sum; bn += x.b.n; }
    if (an && bn) draws.push(as / an - bs / bn);
  }
  draws.sort((x, y) => x - y);
  const q = (p: number) => draws[Math.min(draws.length - 1, Math.max(0, Math.round(p * (draws.length - 1))))];
  return { est, lo: draws.length ? q(0.025) : est, hi: draws.length ? q(0.975) : est, n: A.n + B.n, lobbies: L.length };
}

function sortedRecord<T>(r: Record<string, T>): Record<string, T> { return Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))); }

export const fmt = (x: number | undefined, dp = 2): string => (x === undefined || Number.isNaN(x) ? '—' : x.toFixed(dp));
