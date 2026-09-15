/**
 * BALANCE BOT — `balance:findings`: the OWNER-FACING outlier report over one job's records (typically a hero
 * matrix, `matrix.ts`). Owner's words (2026-09-15): "catch the outliers on both overpowered and underpowered
 * cards / runes / heroes … report all data and findings back to me."
 *
 * Order (the roadmap's): COVERAGE first (heroes × runs planned / complete / failed, lines played, the UNEXERCISED
 * list — content never offered / bought / played is unmeasured, NOT weak) → outliers: heroes, runes, minions +
 * spells → interactions (sparse-suppressed) → pacing + strategy concentration → "what to test next" (each flagged
 * entity turned into a bounded candidate patch for `balance:compare`).
 *
 * Statistics, in one place so the report can cite them:
 *  - every interval is a LOBBY-level bootstrap (eight seats in one lobby are not eight trials);
 *  - every outlier test is a two-sided bootstrap p-value (a hero's mean placement vs the population mean; a
 *    rune's / card's owner-vs-control difference vs 0, paired within lobbies where both sides sit);
 *  - SURVIVORSHIP is controlled, not ignored: a rune is bought at round 6+, a Tier-5 minion around round 10, so
 *    "owners" are by construction the seats that lived that long and any naive owner-vs-everyone lift is mostly
 *    survival (the first smoke flagged 33 of 40 runes at −3 placements). The control for each owner run is the
 *    seats of the SAME lobby that had the same EXPOSURE (reached a Runeforge / saw the card offered), were still
 *    alive at the round the owner acquired the entity, and never held it;
 *  - the scan over a FAMILY (all heroes; all runes; all minions; all spells) is false-discovery controlled with
 *    Benjamini–Hochberg at q (default 0.1) — an entity is flagged only when it survives BH AND its 95% CI clears
 *    the population by `margin` placements (default 0.25), so a "significant" 0.05-place edge is not a lead;
 *  - MINIMUM SUPPORT (default 20 placed runs) gates every test — a sparse row is printed, labelled, never ranked;
 *  - sparse card lifts are shrunk toward zero with k pseudo-runs (default 10) for the ranking column only.
 *
 * Evidence level of EVERYTHING here is 1 (descriptive): co-occurrence with placement is a lead, not causal power.
 * The "what to test next" list is where a lead becomes a level-3 `balance:compare` experiment.
 */
import { aggregate, fmt, perLobby, type Aggregate, type Pacing } from './aggregate';
import { CARD_INDEX, EPIC_RUNES, HEROES, poolFor, RUNE_INDEX, RUNES, type ExperimentIdentity, type ExperimentManifest, type LobbyRecord } from './deps';
import { benjaminiHochberg, bootstrapMeanTest, fnv1a, herfindahl, keyedRng, median, pairedDiffTest, shrink, type CI, type LobbyPartial, type TestedCI } from './stats';

export interface FindingsOptions {
  /** Placed runs below this are never tested or ranked. Default 20. */
  minSupport?: number;
  /** Offers below this keep a card out of the always- / never-bought lists. Default 20. */
  minOffers?: number;
  /** Interaction cells below this are suppressed. Default 8. */
  minPair?: number;
  bootstrapReps?: number;
  seed?: number;
  /** Benjamini–Hochberg false-discovery level. Default 0.1. */
  q?: number;
  /** Placements the 95% CI must clear the population mean by to flag. Default 0.25. */
  margin?: number;
  /** Shrinkage pseudo-runs for sparse card lifts. Default 10. */
  shrinkK?: number;
  /** The job's base manifest (the store's manifest.json) — supplies the matrix plan for planned counts. */
  baseManifest?: ExperimentManifest;
}

export type Verdict = 'overpowered' | 'underpowered' | 'none';

export interface HeroFinding {
  heroId: string;
  name: string;
  /** Matrix plan: lobbies planned with this hero pinned (undefined for a non-matrix job). */
  planned: number | undefined;
  /** Pinned lobbies complete (no failure) / failed. */
  complete: number;
  failed: number;
  /** Seat-0 (pinned, paired-seed) runs placed, and their placement. */
  pinnedRuns: number;
  pinnedPlacement: CI;
  /** ALL placed runs of this hero (pinned + rotated seats) — the tested sample. */
  placement: TestedCI;
  topHalf: CI;
  eliminationMedian: number | undefined;
  /** Distinct line primaries played (strategist pilots); empty when the pilot has no lines. */
  lines: string[];
  effect: number | undefined;
  fdrPass: boolean;
  verdict: Verdict;
  suppressed: boolean;
}

export interface RuneFinding {
  runeId: string;
  name: string;
  offered: number;
  picked: number;
  skipped: number;
  /** Picks the strategist marked FORCED (line rotation); undefined when no event in the job carries `forced`. */
  forced: number | undefined;
  pickRate: number | undefined;
  acquisitionRound: number | undefined;
  owners: number;
  ownersPlacement: CI;
  /** Mean placement of the matched controls: same lobby, reached a Runeforge, alive at the owner's acquisition round, never owned it. */
  controlPlacement: number | undefined;
  /** owners − matched controls (negative = owners place better), paired within lobbies holding both sides. */
  lift: TestedCI & { paired: number };
  fdrPass: boolean;
  verdict: Verdict;
  suppressed: boolean;
}

export interface CardFinding {
  cardId: string;
  name: string;
  kind: 'minion' | 'spell';
  tier: number;
  offered: number;
  bought: number;
  /** Minions: played; spells: cast (any route). */
  played: number;
  buyRate: number | undefined;
  playRate: number | undefined;
  tripleRate: number | undefined;
  /** Bought copies never played / cast, over bought. */
  heldNeverPlayedRate: number | undefined;
  runsHeld: number;
  /** Mean placement of the matched controls: same lobby, saw the card offered, alive at the holder's acquisition round, never held it. */
  controlPlacement: number | undefined;
  /** held − matched controls (negative = holders place better), paired within lobbies. */
  lift: TestedCI & { paired: number };
  /** `lift.est` shrunk toward 0 by `shrinkK` pseudo-runs — the ranking column. */
  shrunkLift: number | undefined;
  fdrPass: boolean;
  verdict: Verdict;
  suppressed: boolean;
}

export interface Suggestion {
  kind: 'hero' | 'rune' | 'minion' | 'spell';
  id: string;
  name: string;
  verdict: Exclude<Verdict, 'none'>;
  effect: number;
  n: number;
  /** Why it is on the list: the outlier scan, or the pick-rate lists. */
  source: 'scan' | 'alwaysBought' | 'neverBought';
  /** A bounded candidate patch: an `overlay` JSON snippet for a card; a named parameter for a rune / hero. */
  patch: string;
  compare: string;
}

export interface Findings {
  schemaVersion: 1;
  evidenceLevel: 1;
  options: Required<Omit<FindingsOptions, 'baseManifest'>>;
  coverage: {
    lobbies: Aggregate['coverage']['lobbies'];
    runs: Aggregate['coverage']['runs'];
    setId: string | undefined;
    mode: string | undefined;
    policy: string | undefined;
    matrix: { runsPerHero: number; heroes: number; explorationK: number | undefined } | undefined;
    /** The paired seed schedule (matrix) or the job's seeds. */
    seeds: { min: number; max: number; distinct: number; sharedByEveryHero: boolean };
    explorationCounts: Record<string, number>;
    linesKnown: boolean;
    forcedKnown: boolean;
    heroes: { heroId: string; name: string; planned: number | undefined; complete: number; failed: number; runs: number; lines: string[] }[];
  };
  unexercised: {
    heroesNeverSeated: string[];
    cardsNeverOffered: string[];
    cardsOfferedNeverBought: string[];
    cardsBoughtNeverPlayed: string[];
    runesNeverOffered: string[];
    runesOfferedNeverPicked: string[];
    poolSize: { minions: number; spells: number; runes: number; heroes: number };
  };
  populationPlacement: CI;
  popMean: number;
  heroes: HeroFinding[];
  runes: RuneFinding[];
  minions: CardFinding[];
  spells: CardFinding[];
  alwaysBought: CardFinding[];
  neverBought: CardFinding[];
  interactions: {
    heroRune: { heroId: string; runeId: string; n: number; placement: number; heroPlacement: number | undefined }[];
    runeLine: { runeId: string; line: string; n: number; placement: number }[];
    minionPairs: { a: string; b: string; count: number; expected: number; ratio: number }[];
    winningBoards: number;
  };
  pacing: Pacing & { roundsPlayed: Aggregate['coverage']['roundsPlayed']; strategy: { winnerHeroHerfindahl: number | undefined; winnerLineHerfindahl: number | undefined; linePrevalence: { line: string; runs: number; share: number; placement: number | undefined }[] } };
  fdr: { q: number; families: { family: string; tested: number; flagged: number }[] };
  next: { overpowered: Suggestion[]; underpowered: Suggestion[] };
  recordsDigest: string;
}

const runKey = (r: { lobbyId: string; seatId: string }): string => `${r.lobbyId}/${r.seatId}`;

export function computeFindings(records: readonly LobbyRecord[], opts: FindingsOptions = {}): Findings {
  const options: Findings['options'] = {
    minSupport: opts.minSupport ?? 20, minOffers: opts.minOffers ?? 20, minPair: opts.minPair ?? 8,
    bootstrapReps: opts.bootstrapReps ?? 1000, seed: opts.seed ?? 1, q: opts.q ?? 0.1, margin: opts.margin ?? 0.25, shrinkK: opts.shrinkK ?? 10,
  };
  const rng = (key: string) => keyedRng(options.seed, key);
  const agg = aggregate(records, { minSupport: options.minSupport, bootstrapReps: options.bootstrapReps, seed: options.seed, shrinkK: options.shrinkK });
  const base = opts.baseManifest ?? records[0]?.manifest;
  const matrix = base?.matrix;
  const setId = base?.setId ?? records[0]?.manifest.setId;
  const popMean = agg.populationPlacement.est ?? 4.5;

  // ── the sample: outcome lobbies (no failure, no failed seat), placed runs ──────────────────────────────────
  const usable = records.filter((L) => L.manifest.mode === 'selfPlayLobby' || L.manifest.mode === 'pinnedLobby' || L.manifest.mode === 'scenario');
  const outcome = usable.filter((L) => !L.failure && !L.seats.some((s) => s.termination === 'failed'));
  const placed = outcome.flatMap((L) => L.seats.filter((s) => s.placement !== undefined && s.termination === 'placed'));
  const placementOf = new Map(placed.map((r) => [runKey(r), r.placement!]));
  const usableById = new Map(usable.map((L) => [L.lobbyId, L]));
  const allRuns = usable.flatMap((L) => L.seats);
  const linesKnown = allRuns.some((r) => r.line !== undefined);
  const forcedKnown = usable.some((L) => L.effects.some((e) => e.forced !== undefined));

  /**
   * Per-lobby {a: owners, b: survival-matched controls} placement partials. `acq` maps an owner run key to the
   * round it ACQUIRED the entity; its controls are the placed runs of the same lobby that never held it and were
   * still alive entering that round (eliminated at or after it). Overlapping controls of several owners in one
   * lobby are summed — a ratio-of-sums per lobby, resampled as a unit by the bootstrap.
   */
  const placedByLobby = new Map<string, typeof placed>();
  for (const r of placed) (placedByLobby.get(r.lobbyId) ?? placedByLobby.set(r.lobbyId, []).get(r.lobbyId)!).push(r);
  const matchedPartials = (acq: ReadonlyMap<string, number>, exposed: ReadonlySet<string>): { a: LobbyPartial; b: LobbyPartial }[] => {
    const m = new Map<string, { a: LobbyPartial; b: LobbyPartial }>();
    for (const [lobbyId, runs] of placedByLobby) {
      const owners = runs.filter((r) => acq.has(runKey(r)));
      if (!owners.length) continue;
      const cell = { a: { sum: 0, n: 0 }, b: { sum: 0, n: 0 } };
      for (const o of owners) {
        cell.a.sum += o.placement!; cell.a.n++;
        const round = acq.get(runKey(o))!;
        for (const c of runs) {
          if (acq.has(runKey(c))) continue;
          if (!exposed.has(runKey(c))) continue; // never had the chance (no forge / never saw the card offered)
          if (c.eliminatedRound !== undefined && c.eliminatedRound < round) continue; // dead before the owner had it
          cell.b.sum += c.placement!; cell.b.n++;
        }
      }
      m.set(lobbyId, cell);
    }
    return [...m.values()];
  };
  const controlMean = (parts: readonly { b: LobbyPartial }[]): number | undefined => { const t = parts.reduce((acc, x) => ({ sum: acc.sum + x.b.sum, n: acc.n + x.b.n }), { sum: 0, n: 0 }); return t.n ? t.sum / t.n : undefined; };
  /** EXPOSURE: runs that had the chance — a Runeforge action at all (runes), or the card in a visible offer (cards).
   *  Reaching a forge / a Tier-5 shop row is itself a sign of a run going well, so an unexposed seat is not a control. */
  const forgeSeen = new Set<string>(); const offerSeen = new Map<string, Set<string>>();
  for (const L of outcome) for (const a of L.actions) {
    if (a.action.type === 'buyRune' || a.action.type === 'skipRuneforge' || a.action.type === 'rerollRuneforge') { forgeSeen.add(runKey(a)); continue; }
    if (a.action.type === 'buyQuest' || a.action.type === 'discover') continue;
    for (const id of a.offers) if (CARD_INDEX[id]) (offerSeen.get(id) ?? offerSeen.set(id, new Set()).get(id)!).add(runKey(a));
  }
  /** First round each run ACQUIRED each entity (rune picks; card gains / plays / casts), from the effect stream. */
  const acqRune = new Map<string, Map<string, number>>(); const acqCard = new Map<string, Map<string, number>>();
  const firstRound = (m: Map<string, Map<string, number>>, id: string, key: string, round: number): void => {
    const inner = m.get(id) ?? m.set(id, new Map()).get(id)!;
    const prev = inner.get(key); if (prev === undefined || round < prev) inner.set(key, round);
  };
  for (const L of outcome) for (const e of L.effects) {
    if (!e.sourceId) continue;
    if (e.kind === 'runePicked') firstRound(acqRune, e.sourceId, runKey(e), e.round);
    else if ((e.kind === 'cardGained' && e.route !== 'triple') || e.kind === 'cardPlayed' || e.kind === 'spellCast') { if (CARD_INDEX[e.sourceId]) firstRound(acqCard, e.sourceId, runKey(e), e.round); }
  }
  // A rune on `runesOwned` with no pick event (a granted rune) counts from round 1 — every seat is its control.
  for (const L of outcome) for (const s of L.seats) for (const id of s.runesOwned) { const inner = acqRune.get(id) ?? acqRune.set(id, new Map()).get(id)!; if (!inner.has(runKey(s))) inner.set(runKey(s), 1); }
  const verdictOf = (ci: { lo: number | undefined; hi: number | undefined }, nullValue: number, pass: boolean): Verdict => {
    if (!pass || ci.lo === undefined || ci.hi === undefined) return 'none';
    if (ci.hi < nullValue - options.margin) return 'overpowered';
    if (ci.lo > nullValue + options.margin) return 'underpowered';
    return 'none';
  };

  // ── coverage ────────────────────────────────────────────────────────────────────────────────────────────────
  const heroIds = [...new Set([...(matrix?.heroes ?? []), ...allRuns.map((r) => r.heroId)])].sort();
  const pinnedOf = (L: LobbyRecord): string | undefined => L.manifest.pinnedHero;
  const heroCoverage = heroIds.map((id) => {
    const pinnedLobbies = usable.filter((L) => pinnedOf(L) === id);
    const runs = allRuns.filter((r) => r.heroId === id);
    return {
      heroId: id, name: HEROES.find((h) => h.id === id)?.name ?? id,
      planned: matrix && matrix.heroes.includes(id) ? matrix.runsPerHero : undefined,
      complete: pinnedLobbies.filter((L) => !L.failure && !L.seats.some((s) => s.termination === 'failed')).length,
      failed: pinnedLobbies.filter((L) => L.failure || L.seats.some((s) => s.termination === 'failed')).length,
      runs: runs.length,
      lines: [...new Set(runs.map((r) => r.line?.primary).filter((x): x is string => !!x))].sort(),
    };
  });
  const seedsAll = usable.map((L) => L.seed);
  const seedsByHero = new Map<string, Set<number>>();
  for (const L of usable) { const h = pinnedOf(L); if (h) (seedsByHero.get(h) ?? seedsByHero.set(h, new Set()).get(h)!).add(L.seed); }
  const seedSets = [...seedsByHero.values()].map((s) => [...s].sort((a, b) => a - b).join(','));
  const explorationCounts: Record<string, number> = {};
  for (const L of usable) { const k = String(L.manifest.exploration ?? 0); explorationCounts[k] = (explorationCounts[k] ?? 0) + 1; }
  const coverage: Findings['coverage'] = {
    lobbies: agg.coverage.lobbies, runs: agg.coverage.runs,
    setId, mode: base?.mode, policy: base?.policy.id,
    matrix: matrix ? { runsPerHero: matrix.runsPerHero, heroes: matrix.heroes.length, explorationK: matrix.explorationK } : undefined,
    seeds: { min: seedsAll.length ? Math.min(...seedsAll) : 0, max: seedsAll.length ? Math.max(...seedsAll) : 0, distinct: new Set(seedsAll).size, sharedByEveryHero: seedSets.length > 1 && seedSets.every((s) => s === seedSets[0]) },
    explorationCounts, linesKnown, forcedKnown, heroes: heroCoverage,
  };

  // ── unexercised ─────────────────────────────────────────────────────────────────────────────────────────────
  const pool = setId ? poolFor(setId as Parameters<typeof poolFor>[0]) : undefined;
  const minionRow = new Map(agg.minions.map((m) => [m.cardId, m]));
  const spellRow = new Map(agg.spells.map((s) => [s.cardId, s]));
  const poolMinions = (pool?.buyable ?? []).map((c) => c.id);
  const poolSpells = (pool?.spells ?? []).map((c) => c.id);
  const eligibleRunes = [...RUNES, ...EPIC_RUNES].filter((r) => !r.sets || (setId && r.sets.includes(setId as 'set1' | 'set2' | 'set3'))).map((r) => r.id);
  const runeRow = new Map(agg.runes.map((r) => [r.runeId, r]));
  const seated = new Set(allRuns.map((r) => r.heroId));
  const unexercised: Findings['unexercised'] = {
    heroesNeverSeated: heroIds.filter((id) => !seated.has(id)),
    cardsNeverOffered: [...poolMinions, ...poolSpells].filter((id) => !((minionRow.get(id)?.offered ?? spellRow.get(id)?.offered ?? 0) > 0)),
    cardsOfferedNeverBought: [...poolMinions, ...poolSpells].filter((id) => { const r = minionRow.get(id) ?? spellRow.get(id); return !!r && r.offered > 0 && r.bought === 0; }),
    cardsBoughtNeverPlayed: [...poolMinions.filter((id) => { const r = minionRow.get(id); return !!r && r.bought > 0 && r.played === 0; }), ...poolSpells.filter((id) => { const r = spellRow.get(id); return !!r && r.bought > 0 && r.cast === 0; })],
    runesNeverOffered: eligibleRunes.filter((id) => !((runeRow.get(id)?.offered ?? 0) > 0)),
    runesOfferedNeverPicked: eligibleRunes.filter((id) => { const r = runeRow.get(id); return !!r && r.offered > 0 && r.picked === 0; }),
    poolSize: { minions: poolMinions.length, spells: poolSpells.length, runes: eligibleRunes.length, heroes: heroIds.length },
  };

  // ── heroes ──────────────────────────────────────────────────────────────────────────────────────────────────
  const heroFindings: HeroFinding[] = heroCoverage.map((c) => {
    const runs = placed.filter((r) => r.heroId === c.heroId);
    const pinnedRuns = runs.filter((r) => { const L = usableById.get(r.lobbyId); return !!L && pinnedOf(L) === c.heroId && r.seatId === L.seats[0]?.seatId; });
    const test = bootstrapMeanTest(perLobby(runs, (r) => r.placement!), popMean, options.bootstrapReps, rng(`f:hero:${c.heroId}`));
    const elim = runs.map((r) => r.eliminatedRound).filter((x): x is number => x !== undefined);
    const suppressed = runs.length < options.minSupport;
    return {
      heroId: c.heroId, name: c.name, planned: c.planned, complete: c.complete, failed: c.failed,
      pinnedRuns: pinnedRuns.length, pinnedPlacement: bootstrapMeanTest(perLobby(pinnedRuns, (r) => r.placement!), popMean, options.bootstrapReps, rng(`f:hero:${c.heroId}:pin`)),
      placement: suppressed ? { ...test, p: undefined } : test,
      topHalf: bootstrapMeanTest(perLobby(runs, (r) => (r.placement! <= 4 ? 1 : 0)), 0.5, options.bootstrapReps, rng(`f:hero:${c.heroId}:top`)),
      eliminationMedian: median(elim), lines: c.lines,
      effect: test.est === undefined ? undefined : test.est - popMean,
      fdrPass: false, verdict: 'none', suppressed,
    };
  });
  const heroPass = benjaminiHochberg(heroFindings.map((h) => h.placement.p), options.q);
  heroFindings.forEach((h, i) => { h.fdrPass = heroPass[i]; h.verdict = verdictOf(h.placement, popMean, h.fdrPass); });

  // ── runes ───────────────────────────────────────────────────────────────────────────────────────────────────
  const forcedPicks = new Map<string, number>();
  for (const L of usable) for (const e of L.effects) if (e.kind === 'runePicked' && e.forced && e.sourceId) forcedPicks.set(e.sourceId, (forcedPicks.get(e.sourceId) ?? 0) + 1);
  const runeFindings: RuneFinding[] = agg.runes.map((r) => {
    const own = acqRune.get(r.runeId) ?? new Map<string, number>();
    const ownPlaced = [...own.keys()].filter((k) => placementOf.has(k)).length;
    const parts = matchedPartials(own, forgeSeen);
    const lift = pairedDiffTest(parts, options.bootstrapReps, rng(`f:rune:${r.runeId}`));
    const suppressed = ownPlaced < options.minSupport;
    return {
      runeId: r.runeId, name: r.name, offered: r.offered, picked: r.picked, skipped: r.skipped,
      forced: forcedKnown ? (forcedPicks.get(r.runeId) ?? 0) : undefined,
      pickRate: r.pickRate, acquisitionRound: r.acquisitionRound, owners: ownPlaced,
      ownersPlacement: r.ownersPlacement, controlPlacement: controlMean(parts),
      lift: suppressed ? { ...lift, p: undefined } : lift, fdrPass: false, verdict: 'none', suppressed,
    };
  });
  const runePass = benjaminiHochberg(runeFindings.map((r) => r.lift.p), options.q);
  runeFindings.forEach((r, i) => { r.fdrPass = runePass[i]; r.verdict = verdictOf(r.lift, 0, r.fdrPass); });

  // ── minions + spells ────────────────────────────────────────────────────────────────────────────────────────
  const cardFinding = (id: string, kind: 'minion' | 'spell'): CardFinding => {
    const m = minionRow.get(id); const s = spellRow.get(id);
    const held = acqCard.get(id) ?? new Map<string, number>();
    const runsHeld = [...held.keys()].filter((k) => placementOf.has(k)).length;
    const parts = matchedPartials(held, offerSeen.get(id) ?? new Set());
    const lift = pairedDiffTest(parts, options.bootstrapReps, rng(`f:card:${id}`));
    const suppressed = runsHeld < options.minSupport;
    const bought = m?.bought ?? s?.bought ?? 0;
    const played = kind === 'minion' ? (m?.played ?? 0) : (s?.cast ?? 0);
    const offered = m?.offered ?? s?.offered ?? 0;
    return {
      cardId: id, name: CARD_INDEX[id]?.name ?? id, kind, tier: Number(CARD_INDEX[id]?.tier ?? 0),
      offered, bought, played,
      buyRate: offered ? bought / offered : undefined, playRate: bought ? Math.min(1, played / bought) : undefined,
      tripleRate: kind === 'minion' && bought ? (m?.tripled ?? 0) / bought : undefined,
      heldNeverPlayedRate: kind === 'minion' ? (bought ? Math.max(0, bought - played) / bought : undefined) : s?.heldRate,
      runsHeld, controlPlacement: controlMean(parts), lift: suppressed ? { ...lift, p: undefined } : lift,
      shrunkLift: lift.est === undefined ? undefined : shrink(lift.est, runsHeld, 0, options.shrinkK),
      fdrPass: false, verdict: 'none', suppressed,
    };
  };
  const minions = [...minionRow.keys()].sort().map((id) => cardFinding(id, 'minion'));
  const spells = [...spellRow.keys()].sort().map((id) => cardFinding(id, 'spell'));
  for (const fam of [minions, spells]) {
    const pass = benjaminiHochberg(fam.map((c) => c.lift.p), options.q);
    fam.forEach((c, i) => { c.fdrPass = pass[i]; c.verdict = verdictOf(c.lift, 0, c.fdrPass); });
  }
  const bySupport = (a: CardFinding, b: CardFinding) => b.offered - a.offered || a.cardId.localeCompare(b.cardId);
  const alwaysBought = [...minions, ...spells].filter((c) => c.offered >= options.minOffers && c.buyRate !== undefined && c.buyRate >= 0.9).sort(bySupport);
  const neverBought = [...minions, ...spells].filter((c) => c.offered >= options.minOffers && c.buyRate !== undefined && c.buyRate <= 0.05).sort(bySupport);

  // ── interactions (sparse-suppressed) ────────────────────────────────────────────────────────────────────────
  const heroMean = new Map(heroFindings.map((h) => [h.heroId, h.placement.est]));
  const cell = new Map<string, { sum: number; n: number }>();
  const bump = (k: string, v: number) => { const c = cell.get(k) ?? cell.set(k, { sum: 0, n: 0 }).get(k)!; c.sum += v; c.n++; };
  for (const r of placed) for (const id of r.runesOwned) bump(`hr|${r.heroId}|${id}`, r.placement!);
  for (const r of placed) if (r.line) for (const id of r.runesOwned) bump(`rl|${id}|${r.line.primary}`, r.placement!);
  const heroRune: Findings['interactions']['heroRune'] = []; const runeLine: Findings['interactions']['runeLine'] = [];
  for (const [k, c] of cell) {
    if (c.n < options.minPair) continue;
    const [kind, x, y] = k.split('|');
    if (kind === 'hr') heroRune.push({ heroId: x, runeId: y, n: c.n, placement: c.sum / c.n, heroPlacement: heroMean.get(x) });
    else runeLine.push({ runeId: x, line: y, n: c.n, placement: c.sum / c.n });
  }
  heroRune.sort((a, b) => a.placement - b.placement || b.n - a.n);
  runeLine.sort((a, b) => a.placement - b.placement || b.n - a.n);
  const winners = placed.filter((r) => r.placement === 1);
  const cardFreq = new Map<string, number>(); const pairCount = new Map<string, number>();
  for (const w of winners) {
    const ids = [...new Set(w.finalBoard.filter((id) => CARD_INDEX[id]))].sort();
    for (const id of ids) cardFreq.set(id, (cardFreq.get(id) ?? 0) + 1);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = `${ids[i]}|${ids[j]}`; pairCount.set(k, (pairCount.get(k) ?? 0) + 1); }
  }
  const W = winners.length;
  const minionPairs = [...pairCount.entries()].filter(([, n]) => n >= Math.max(3, Math.ceil(options.minPair / 2))).map(([k, count]) => {
    const [a, b] = k.split('|');
    const expected = W ? (cardFreq.get(a)! * cardFreq.get(b)!) / W : 0;
    return { a, b, count, expected, ratio: expected ? count / expected : 0 };
  }).sort((x, y) => y.count - x.count || y.ratio - x.ratio).slice(0, 40);

  // ── pacing + strategy concentration ─────────────────────────────────────────────────────────────────────────
  const lineRuns = new Map<string, { n: number; sum: number; placed: number }>();
  for (const r of allRuns) if (r.line) { const c = lineRuns.get(r.line.primary) ?? lineRuns.set(r.line.primary, { n: 0, sum: 0, placed: 0 }).get(r.line.primary)!; c.n++; if (r.placement !== undefined && placementOf.has(runKey(r))) { c.sum += r.placement; c.placed++; } }
  const totalLineRuns = [...lineRuns.values()].reduce((a, c) => a + c.n, 0);
  const winnerLines = new Map<string, number>(); for (const w of winners) if (w.line) winnerLines.set(w.line.primary, (winnerLines.get(w.line.primary) ?? 0) + 1);
  const pacing: Findings['pacing'] = {
    ...agg.pacing, roundsPlayed: agg.coverage.roundsPlayed,
    strategy: {
      winnerHeroHerfindahl: agg.pacing.winnerHeroConcentration,
      winnerLineHerfindahl: winnerLines.size ? herfindahl([...winnerLines.values()]) : undefined,
      linePrevalence: [...lineRuns.entries()].map(([line, c]) => ({ line, runs: c.n, share: totalLineRuns ? c.n / totalLineRuns : 0, placement: c.placed ? c.sum / c.placed : undefined })).sort((a, b) => b.runs - a.runs),
    },
  };

  // ── what to test next ───────────────────────────────────────────────────────────────────────────────────────
  const suggestions: Suggestion[] = [];
  for (const h of heroFindings) if (h.verdict !== 'none') suggestions.push(suggest('hero', h.heroId, h.name, h.verdict, h.effect!, h.placement.n, 'scan'));
  for (const r of runeFindings) if (r.verdict !== 'none') suggestions.push(suggest('rune', r.runeId, r.name, r.verdict, r.lift.est!, r.owners, 'scan'));
  for (const c of [...minions, ...spells]) if (c.verdict !== 'none') suggestions.push(suggest(c.kind, c.cardId, c.name, c.verdict, c.lift.est!, c.runsHeld, 'scan'));
  const byEffect = (a: Suggestion, b: Suggestion) => Math.abs(b.effect) - Math.abs(a.effect) || a.id.localeCompare(b.id);
  const op = suggestions.filter((s) => s.verdict === 'overpowered').sort(byEffect);
  const up = suggestions.filter((s) => s.verdict === 'underpowered').sort(byEffect);
  // Pick-rate leads fill the list when the scan flags fewer than five (labelled by source — a buy rate is not a lift).
  for (const c of alwaysBought) if (op.length < 5 && !op.some((s) => s.id === c.cardId)) op.push(suggest(c.kind, c.cardId, c.name, 'overpowered', c.shrunkLift ?? 0, c.runsHeld, 'alwaysBought'));
  for (const c of neverBought) if (up.length < 5 && !up.some((s) => s.id === c.cardId)) up.push(suggest(c.kind, c.cardId, c.name, 'underpowered', c.shrunkLift ?? 0, c.runsHeld, 'neverBought'));

  return {
    schemaVersion: 1, evidenceLevel: 1, options, coverage, unexercised,
    populationPlacement: agg.populationPlacement, popMean,
    heroes: heroFindings, runes: runeFindings, minions, spells, alwaysBought, neverBought,
    interactions: { heroRune, runeLine, minionPairs, winningBoards: W },
    pacing,
    fdr: { q: options.q, families: [
      { family: 'heroes', tested: heroFindings.filter((h) => h.placement.p !== undefined).length, flagged: heroFindings.filter((h) => h.verdict !== 'none').length },
      { family: 'runes', tested: runeFindings.filter((r) => r.lift.p !== undefined).length, flagged: runeFindings.filter((r) => r.verdict !== 'none').length },
      { family: 'minions', tested: minions.filter((c) => c.lift.p !== undefined).length, flagged: minions.filter((c) => c.verdict !== 'none').length },
      { family: 'spells', tested: spells.filter((c) => c.lift.p !== undefined).length, flagged: spells.filter((c) => c.verdict !== 'none').length },
    ] },
    next: { overpowered: op.slice(0, 5), underpowered: up.slice(0, 5) },
    recordsDigest: fnv1a(records.map((L) => `${L.lobbyId}#${L.seed}#${L.roundsPlayed}#${L.failure ?? ''}`).sort().join('|')),
  };

  function suggest(kind: Suggestion['kind'], id: string, name: string, verdict: Exclude<Verdict, 'none'>, effect: number, n: number, source: Suggestion['source']): Suggestion {
    const dir = verdict === 'overpowered' ? -1 : 1;
    let patch: string;
    if (kind === 'minion') {
      const d = CARD_INDEX[id];
      patch = `overlay: ${JSON.stringify({ [id]: { attack: Math.max(0, (d?.attack ?? 0) + dir), health: Math.max(1, (d?.health ?? 1) + dir) } })}  (${d?.attack ?? '?'}/${d?.health ?? '?'} → ${Math.max(0, (d?.attack ?? 0) + dir)}/${Math.max(1, (d?.health ?? 1) + dir)}; or a params patch on its effect)`;
    } else if (kind === 'spell') {
      const d = CARD_INDEX[id];
      const cost = d?.cost ?? 3;
      patch = `overlay: ${JSON.stringify({ [id]: { cost: Math.max(0, cost - dir) } })}  (cost ${cost} → ${Math.max(0, cost - dir)}; or a params patch on its effect)`;
    } else if (kind === 'rune') {
      const r = RUNE_INDEX[id];
      patch = `RuneDef.cost ${r?.cost ?? '?'} → ${Math.max(0, (r?.cost ?? 0) - dir)} (or its reward magnitude) — runes are not overlay-able today: a code build`;
    } else {
      const h = HEROES.find((x) => x.id === id);
      patch = `HeroDef.armor ${h?.armor ?? '?'} → ${Math.max(0, (h?.armor ?? 0) + 2 * dir)} (or the power's activation price / magnitude) — a code build`;
    }
    return { kind, id, name, verdict, effect, n, source, patch, compare: `balance:compare --baseline <this job> --candidate <patched job> --allow-diff contentDigest,manifestDigest --target ${kind}:${id}` };
  }
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface RenderFindingsOptions { format: 'md' | 'json'; jobId?: string; identity?: ExperimentIdentity; maxRows?: number }

const pct = (x: number | undefined): string => (x === undefined ? '—' : `${(100 * x).toFixed(0)}%`);
const signed = (x: number | undefined, dp = 2): string => (x === undefined ? '—' : (x >= 0 ? '+' : '') + x.toFixed(dp));
const ciText = (ci: CI): string => (ci.est === undefined ? '—' : `${fmt(ci.est)} [${fmt(ci.lo)}, ${fmt(ci.hi)}]`);
const pText = (p: number | undefined): string => (p === undefined ? '—' : p < 0.001 ? '<0.001' : p.toFixed(3));
const verdictText = (v: Verdict, fdr: boolean, suppressed: boolean): string => (suppressed ? 'sparse' : v === 'overpowered' ? '**OVERPOWERED**' : v === 'underpowered' ? '**UNDERPOWERED**' : fdr ? 'sig., inside margin' : '');

export function renderFindings(f: Findings, opts: RenderFindingsOptions): string {
  if (opts.format === 'json') return JSON.stringify({ jobId: opts.jobId, identity: opts.identity, findings: f }, null, 2);
  const maxRows = opts.maxRows ?? 25;
  const o: string[] = [];
  const c = f.coverage;
  const L1 = '_Evidence level 1 — descriptive. Co-occurrence with placement is a lead, not causal power; a level-3 `balance:compare` experiment is the basis for a change._';

  o.push(`# Balance findings${opts.jobId ? ` — job \`${opts.jobId}\`` : ''}`);
  o.push('');
  o.push(`Set **${c.setId ?? '—'}**, mode \`${c.mode ?? '—'}\`, policy \`${c.policy ?? '—'}\`${c.matrix ? ` — hero matrix: ${c.matrix.heroes} heroes × ${c.matrix.runsPerHero} runs/hero${c.matrix.explorationK ? `, exploration rotating mod ${c.matrix.explorationK}` : ', no exploration rotation'}` : ''}.`);
  if (opts.identity) o.push(`Identity: engine \`${opts.identity.engineRevision.slice(0, 12)}\`${opts.identity.dirtyDigest ? ' (DIRTY)' : ''}, content \`${opts.identity.contentDigest}\`, effects \`${opts.identity.effectDigest}\`, manifest \`${opts.identity.manifestDigest}\`. Records \`${f.recordsDigest}\`.`);
  o.push(`Statistics: lobby-level bootstrap (${f.options.bootstrapReps} reps, seed ${f.options.seed}); outliers = Benjamini–Hochberg at q = ${f.options.q} per family (heroes / runes / minions / spells) AND the 95% CI clears the population by ≥ ${f.options.margin} placements; minimum support ${f.options.minSupport} placed runs; sparse card lifts shrunk with k = ${f.options.shrinkK}.`);
  o.push('');

  // ── coverage ────────────────────────────────────────────────────────────────────────────────────────────────
  o.push('## 1. Coverage (read this first)');
  o.push('');
  o.push(`| Lobbies | planned | started | complete | failed | censored | capped |`);
  o.push(`|---|---|---|---|---|---|---|`);
  o.push(`| | ${c.lobbies.planned} | ${c.lobbies.started} | ${c.lobbies.complete} | ${c.lobbies.failed} | ${c.lobbies.censored} | ${c.lobbies.capped} |`);
  o.push('');
  o.push(`Runs: ${c.runs.started} started, ${c.runs.placed} placed, ${c.runs.capped} capped, ${c.runs.failed} failed. Rounds per lobby: mean ${fmt(f.pacing.roundsPlayed.mean, 1)} (${f.pacing.roundsPlayed.min}–${f.pacing.roundsPlayed.max}).`);
  o.push(`Seeds ${c.seeds.min}…${c.seeds.max} (${c.seeds.distinct} distinct)${c.matrix ? c.seeds.sharedByEveryHero ? ' — **paired: every hero played the same seed set**' : ' — NOT the same seed set for every hero (partial job?)' : ''}. Exploration indices: ${Object.entries(c.explorationCounts).map(([k, n]) => `${k}: ${n}`).join(', ')}.`);
  o.push(`Lines: ${c.linesKnown ? 'recorded (strategist pilot)' : '**not recorded** — this pilot has no lines; "lines played" is empty and rune × line is unavailable'}. Forced picks: ${c.forcedKnown ? 'recorded' : '**forced exposure unknown** (no event carries `forced`)'}.`);
  o.push('');
  o.push(`| hero | planned | complete | failed | runs (all seats) | lines played |`);
  o.push(`|---|---|---|---|---|---|`);
  for (const h of c.heroes) o.push(`| ${h.name} (\`${h.heroId}\`) | ${h.planned ?? '—'} | ${h.complete} | ${h.failed} | ${h.runs} | ${h.lines.length ? h.lines.join(', ') : '—'} |`);
  o.push('');
  o.push('### Unexercised — unmeasured, NOT weak');
  o.push('');
  const u = f.unexercised;
  o.push(`Pool: ${u.poolSize.minions} minions, ${u.poolSize.spells} spells, ${u.poolSize.runes} runes eligible for the set, ${u.poolSize.heroes} heroes.`);
  o.push('');
  const LIST_CAP = 40;
  const list = (label: string, ids: string[], nameOf: (id: string) => string) => o.push(`- **${label}** (${ids.length}): ${ids.length ? ids.slice(0, LIST_CAP).map((id) => `${nameOf(id)} (\`${id}\`)`).join(', ') + (ids.length > LIST_CAP ? ` … +${ids.length - LIST_CAP} more (full list in \`--format json\`)` : '') : 'none'}`);
  const cardName = (id: string) => CARD_INDEX[id]?.name ?? id; const runeName = (id: string) => RUNE_INDEX[id]?.name ?? id; const heroName = (id: string) => HEROES.find((h) => h.id === id)?.name ?? id;
  list('Heroes never seated', u.heroesNeverSeated, heroName);
  list('Cards never offered', u.cardsNeverOffered, cardName);
  list('Cards offered but never bought', u.cardsOfferedNeverBought, cardName);
  list('Cards bought but never played / cast', u.cardsBoughtNeverPlayed, cardName);
  list('Runes never offered', u.runesNeverOffered, runeName);
  list('Runes offered but never picked', u.runesOfferedNeverPicked, runeName);
  o.push('');

  // ── heroes ──────────────────────────────────────────────────────────────────────────────────────────────────
  o.push('## 2. Outliers — heroes');
  o.push('');
  o.push(L1);
  o.push(`Population mean placement ${ciText(f.populationPlacement)} (symmetric self-play is mechanically ~4.5). "placement" pools EVERY seat the hero sat in (pinned + rotated); "pinned" is seat 0 on the paired seeds. Flagged: BH q = ${f.options.q} over ${f.fdr.families[0].tested} tested heroes → ${f.fdr.families[0].flagged} flagged.`);
  o.push('');
  o.push(`| hero | placement (all seats) [95% CI] | n | lobbies | pinned mean (n) | top-half | elim. round (median) | effect | p | verdict |`);
  o.push(`|---|---|---|---|---|---|---|---|---|---|`);
  const heroesRanked = [...f.heroes].filter((h) => h.placement.n > 0).sort((a, b) => (a.placement.est ?? 9) - (b.placement.est ?? 9));
  for (const h of heroesRanked) o.push(`| ${h.name} (\`${h.heroId}\`) | ${ciText(h.placement)} | ${h.placement.n} | ${h.placement.lobbies} | ${fmt(h.pinnedPlacement.est)} (${h.pinnedRuns}) | ${pct(h.topHalf.est)} | ${h.eliminationMedian ?? '—'} | ${signed(h.effect)} | ${pText(h.placement.p)} | ${verdictText(h.verdict, h.fdrPass, h.suppressed)} |`);
  o.push('');

  // ── runes ───────────────────────────────────────────────────────────────────────────────────────────────────
  o.push('## 3. Outliers — runes');
  o.push('');
  o.push(L1);
  o.push(`Lift = owners' mean placement − their MATCHED controls' (seats of the same lobby that also reached a Runeforge, were still alive at the round the owner bought the rune, and never owned it; negative = owners place better), paired within lobbies that hold both. A naive owners-vs-everyone lift is mostly survivorship + reaching the forge at all. Pick rate is WHEN OFFERED. ${c.forcedKnown ? 'Forced picks (a line rotation choosing the rune, not the pilot) are listed separately — do not read them as natural pick rate.' : '**Forced exposure unknown**: this pilot does not mark forced picks, so pick rates are natural for this policy only.'} BH over ${f.fdr.families[1].tested} tested → ${f.fdr.families[1].flagged} flagged.`);
  o.push('');
  o.push(`| rune | offered | picked | forced | pick rate | acq. round | owners | owners' placement | controls' placement | lift [95% CI] | paired lobbies | p | verdict |`);
  o.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
  const runesRanked = [...f.runes].sort((a, b) => Number(a.suppressed) - Number(b.suppressed) || (a.lift.est ?? 9) - (b.lift.est ?? 9)).slice(0, maxRows * 2);
  for (const r of runesRanked) o.push(`| ${r.name} (\`${r.runeId}\`) | ${r.offered} | ${r.picked} | ${r.forced ?? '?'} | ${pct(r.pickRate)} | ${fmt(r.acquisitionRound, 1)} | ${r.owners} | ${fmt(r.ownersPlacement.est)} | ${fmt(r.controlPlacement)} | ${r.lift.est === undefined ? '—' : `${signed(r.lift.est)} [${signed(r.lift.lo)}, ${signed(r.lift.hi)}]`} | ${r.lift.paired} | ${pText(r.lift.p)} | ${verdictText(r.verdict, r.fdrPass, r.suppressed)} |`);
  if (f.runes.length > runesRanked.length) o.push(`| … ${f.runes.length - runesRanked.length} more | | | | | | | | | | | | |`);
  o.push('');

  // ── cards ───────────────────────────────────────────────────────────────────────────────────────────────────
  const cardTable = (title: string, rows: CardFinding[], family: number) => {
    o.push(`## ${title}`);
    o.push('');
    o.push(L1);
    o.push(`Funnel: offered → bought → ${rows[0]?.kind === 'spell' ? 'cast' : 'played'}. Lift = placement of runs that held it − their MATCHED controls (seats of the same lobby that also saw it offered, were alive at the round the holder acquired it, and never held it; negative = better), paired within lobbies; "shrunk" pulls sparse lifts toward 0 with k = ${f.options.shrinkK} and is the ranking column. BH over ${f.fdr.families[family].tested} tested → ${f.fdr.families[family].flagged} flagged.`);
    o.push('');
    o.push(`| card | tier | offered | bought | ${rows[0]?.kind === 'spell' ? 'cast' : 'played'} | buy rate | play rate | triple rate | held-never-played | runs held | controls' placement | lift [95% CI] | shrunk | p | verdict |`);
    o.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    const ranked = [...rows].sort((a, b) => Number(a.suppressed) - Number(b.suppressed) || (a.shrunkLift ?? 0) - (b.shrunkLift ?? 0));
    const shown = ranked.length > maxRows * 2 ? [...ranked.slice(0, maxRows), ...ranked.slice(-maxRows)] : ranked;
    let cut = false;
    for (const r of shown) {
      if (!cut && ranked.length > maxRows * 2 && r === ranked[ranked.length - maxRows]) { o.push(`| … ${ranked.length - 2 * maxRows} middle rows omitted (see \`--format json\`) | | | | | | | | | | | | | | |`); cut = true; }
      o.push(`| ${r.name} (\`${r.cardId}\`) | ${r.tier} | ${r.offered} | ${r.bought} | ${r.played} | ${pct(r.buyRate)} | ${pct(r.playRate)} | ${r.tripleRate === undefined ? '—' : pct(r.tripleRate)} | ${pct(r.heldNeverPlayedRate)} | ${r.runsHeld} | ${fmt(r.controlPlacement)} | ${r.lift.est === undefined ? '—' : `${signed(r.lift.est)} [${signed(r.lift.lo)}, ${signed(r.lift.hi)}]`} | ${signed(r.shrunkLift)} | ${pText(r.lift.p)} | ${verdictText(r.verdict, r.fdrPass, r.suppressed)} |`);
    }
    o.push('');
  };
  cardTable('4. Outliers — minions', f.minions, 2);
  cardTable('5. Outliers — spells', f.spells, 3);
  o.push('### Pick-rate leads (the strongest OP / UP leads from the buy decision)');
  o.push('');
  o.push(`Cards with ≥ ${f.options.minOffers} offers. A buy rate is this pilot's preference, not a lift — but a card bought every time it is seen, or never, is where a human would look first.`);
  o.push('');
  o.push(`- **Always bought when offered (buy rate ≥ 90%)** (${f.alwaysBought.length}): ${f.alwaysBought.length ? f.alwaysBought.map((r) => `${r.name} (\`${r.cardId}\`, ${pct(r.buyRate)} of ${r.offered}, lift ${signed(r.shrunkLift)})`).join(', ') : 'none'}`);
  o.push(`- **Never bought when offered (buy rate ≤ 5%)** (${f.neverBought.length}): ${f.neverBought.length ? f.neverBought.map((r) => `${r.name} (\`${r.cardId}\`, ${pct(r.buyRate)} of ${r.offered})`).join(', ') : 'none'}`);
  o.push('');

  // ── interactions ────────────────────────────────────────────────────────────────────────────────────────────
  o.push('## 6. Interactions (sparse-suppressed: cells under ' + f.options.minPair + ' runs are not shown)');
  o.push('');
  o.push(L1);
  o.push('');
  const hr = f.interactions.heroRune;
  o.push(`**Hero × rune** (${hr.length} cells with support): best and worst by owners' placement.`);
  o.push('');
  if (!hr.length) o.push('_none with support_');
  else {
    o.push('| hero | rune | n | placement | hero mean | delta |');
    o.push('|---|---|---|---|---|---|');
    for (const x of [...hr.slice(0, 10), ...(hr.length > 20 ? hr.slice(-10) : hr.slice(10))]) o.push(`| ${heroName(x.heroId)} | ${runeName(x.runeId)} | ${x.n} | ${fmt(x.placement)} | ${fmt(x.heroPlacement)} | ${signed(x.heroPlacement === undefined ? undefined : x.placement - x.heroPlacement)} |`);
  }
  o.push('');
  const rl = f.interactions.runeLine;
  o.push(`**Rune × line** (${rl.length} cells with support).`);
  o.push('');
  if (!c.linesKnown) o.push('_unavailable — no lines recorded for this pilot_');
  else if (!rl.length) o.push('_none with support_');
  else { o.push('| rune | line | n | placement |'); o.push('|---|---|---|---|'); for (const x of rl.slice(0, 20)) o.push(`| ${runeName(x.runeId)} | ${x.line} | ${x.n} | ${fmt(x.placement)} |`); }
  o.push('');
  const mp = f.interactions.minionPairs;
  o.push(`**Minion × minion on winning final boards** (${f.interactions.winningBoards} winning boards; pairs seen ≥ ${Math.max(3, Math.ceil(f.options.minPair / 2))} times; ratio = observed / expected under independence).`);
  o.push('');
  if (!mp.length) o.push('_none with support_');
  else { o.push('| card | card | count | expected | ratio |'); o.push('|---|---|---|---|---|'); for (const x of mp.slice(0, 20)) o.push(`| ${cardName(x.a)} | ${cardName(x.b)} | ${x.count} | ${fmt(x.expected, 1)} | ${fmt(x.ratio, 1)}× |`); }
  o.push('');

  // ── pacing ──────────────────────────────────────────────────────────────────────────────────────────────────
  o.push('## 7. Pacing and strategy concentration');
  o.push('');
  o.push(L1);
  o.push('');
  const p = f.pacing;
  const at = (round: number) => { const t = p.tierByRound[round - 1]; const g = p.unspentByRound[round - 1]; const v = p.turnoverByRound[round - 1]; return t ? `| ${round} | ${fmt(t.mean)} | ${fmt(g?.mean)} | ${pct(v?.mean)} | ${t.n} |` : undefined; };
  o.push('| round | mean tier | unspent Gold | board turnover | seats |');
  o.push('|---|---|---|---|---|');
  for (const r of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 21, 25, 30]) { const row = at(r); if (row) o.push(row); }
  o.push('');
  o.push(`Actions per recruit turn ${fmt(p.actionsPerTurn, 1)}. Fight results: ${p.results.win} W / ${p.results.loss} L / ${p.results.tie} T / ${p.results.bye} byes. Final-board diversity ${pct(p.finalBoardDiversity)}; early-card (T1–2) retention ${pct(p.earlyCardRetention)}.`);
  o.push('');
  o.push(`**Winner concentration** — Herfindahl of winners' heroes ${fmt(p.strategy.winnerHeroHerfindahl, 3)} (1/${f.heroes.filter((h) => h.placement.n > 0).length || 1} = ${fmt(1 / Math.max(1, f.heroes.filter((h) => h.placement.n > 0).length), 3)} would be perfectly even)${p.strategy.winnerLineHerfindahl !== undefined ? `; of winners' lines ${fmt(p.strategy.winnerLineHerfindahl, 3)}` : ''}.`);
  if (p.strategy.linePrevalence.length) {
    o.push('');
    o.push('| line | runs | share | placement |');
    o.push('|---|---|---|---|');
    for (const l of p.strategy.linePrevalence) o.push(`| ${l.line} | ${l.runs} | ${pct(l.share)} | ${fmt(l.placement)} |`);
  } else o.push('Line prevalence: _no lines recorded_.');
  o.push('');

  // ── what to test next ───────────────────────────────────────────────────────────────────────────────────────
  o.push('## 8. What to test next');
  o.push('');
  o.push(`FDR summary: ${f.fdr.families.map((x) => `${x.family} ${x.flagged}/${x.tested}`).join(', ')} flagged at q = ${f.fdr.q}. Each suggestion is a BOUNDED candidate patch — run it as a paired-seed candidate job and read \`balance:compare\`; the source column says whether it comes from the outlier scan or from a pick-rate list (a buy rate is a lead, not a lift).`);
  o.push('');
  const sug = (title: string, xs: Suggestion[]) => {
    o.push(`### ${title}`);
    o.push('');
    if (!xs.length) { o.push('_none survived support + FDR + margin. An inconclusive interval means inconclusive, not balanced._'); o.push(''); return; }
    xs.forEach((s, i) => {
      o.push(`${i + 1}. **${s.name}** (\`${s.kind}:${s.id}\`) — ${s.source === 'scan' ? `effect ${signed(s.effect)} placements over ${s.n} runs` : s.source === 'alwaysBought' ? 'always bought when offered' : 'never bought when offered'}`);
      o.push(`   - patch: ${s.patch}`);
      o.push(`   - then: \`${s.compare}\``);
    });
    o.push('');
  };
  sug('Top overpowered leads', f.next.overpowered);
  sug('Top underpowered leads', f.next.underpowered);
  return o.join('\n');
}
