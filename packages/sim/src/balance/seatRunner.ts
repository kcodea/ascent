/**
 * BALANCE BOT — B1: the AUTHORITATIVE seat runner (docs/balance-bot-roadmap.md, "Faithful turns and fights").
 *
 * Two jobs, both through the real engine and nothing else:
 *
 *  1. `playRecruitTurn` drives ONE seat's recruit turn: the pilot proposes, `reduce` validates + executes, the
 *     recorder sees ACCEPTED transitions only. `null` from the pilot ends the turn through the real end-turn
 *     action (`faceOmen`, deferred — the fight belongs to the lobby). A pilot that stalls (rejected actions, an
 *     unanswered modal, the action budget) FAILS the seat. It is never quietly ended for it (roadmap defect #2).
 *
 *  2. `prepareAndFight` resolves ONE pair: both runs have already ended their turns and parked a fully
 *     prepared side (`pendingCombatSide`, built by the reducer's `preparePlayerCombatSide` — the same builder
 *     the shipped player fight uses), ONE `simulate()` runs, and BOTH runs settle that single result through
 *     the real `resolveCombat` path (armor before Resolve, carry-backs, quest ticks, turn resets).
 *
 * PRODUCTION DISCREPANCIES this runner is explicit about — see `FightRules` and `mirrorForEnemySeat`. None is
 * "fixed" silently: `rules: 'corrected'` (default) prepares BOTH seats through the player's full builder;
 * `rules: 'shipped'` reproduces the served-board path a seat takes against the live player today.
 */
import { CARD_INDEX } from '@game/content';
import { makeRng, simulate, type BoardMinion, type CombatResult, type CombatSideState } from '@game/core';
import { sideFromSnapshot } from '../boardSide';
import { poolOf } from '../cardPool';
import { opponentBoard } from '../opponents';
import { lossDamageCap, reduce } from '../reducer';
import { modalOpen } from '../recruit';
import { snapshotBoard } from '../snapshot';
import { mixSeed, TAG, type Action, type RunState } from '../state';
import { stateHash } from './hash';
import { effectEventsOf, type CardLineage } from './effectsFromTransition';
import type { BalanceRecorder, SeatContext, SeatPilot } from './types';

// ───────────────────────────────────────────── the recruit turn ─────────────────────────────────────────────

export interface RecruitTurnOptions {
  /** Accepted recruit actions allowed before the seat is FAILED (the end-turn action counts). */
  maxActionsPerTurn: number;
  lobbyId: string;
  /** Consecutive REJECTED proposals tolerated before the seat is failed. Default 3: a pilot that re-proposes
   *  the same illegal move is stuck, and a stuck pilot is a measurement defect, not a quiet end turn. */
  maxConsecutiveRejections?: number;
  /** How the turn ENDS. `true` (default) parks the prepared side on `pendingCombatSide` for the lobby to fight
   *  (self-play: both seats are live). `false` ends the turn through the SHIPPED `faceOmen`, which resolves the
   *  fight right there against the run's own opponent — the lobby seat it is paired with (`lobbyOpponentBoard`)
   *  or the served pool board — exactly as the live player's End Turn does (the pinned lobby, `pinnedLobby.ts`). */
  deferFight?: boolean;
  /** The seat's card LINEAGE (uid → acquisition route), kept by the caller ACROSS turns so a play / sell / cast
   *  can say how the card came to be. Effects are ALWAYS derived by the recorder's attributer
   *  (`effectsFromTransition.ts` — `sourceId` on every card event, routes by lineage, casts by route, triples);
   *  a caller that omits the map gets a per-turn throwaway one (cross-turn routes then read `other`). Both lobby
   *  runners pass one map per seat. The runner's former lean diff (`targetId`-keyed) was retired 2026-09-15: the
   *  pinned lobby omitted `lineage`, fell through to it, and every real pinned report read "bought 0". */
  lineage?: CardLineage;
}

export interface RecruitTurnOutcome {
  run: RunState;
  /** Set when the seat could not complete its turn legally. The run is left where it stalled. */
  failure?: string;
  /** Accepted actions this turn, the end-turn included. */
  accepted: number;
}

/** The modal a pilot left open, named for the failure message. */
function openModalName(s: RunState): string {
  if (s.discover) return 'discover';
  if (s.chooseOne) return 'chooseOne';
  if (s.pendingTarget) return 'pendingTarget';
  if (s.questOffer) return 'questOffer';
  if (s.powerOffer) return 'powerOffer';
  if (s.runeforgeOffer) return 'runeforgeOffer';
  if (s.scoutedNextOpponent?.length) return 'scout';
  return 'unknown';
}

/** Visible shop offers (card ids) at decision time — the minion row plus the right-hand spell slot. */
/**
 * The offers the action CHOSE FROM — the surface, not always the tavern (integration fix 2026-09-15: the runner
 * recorded the shop row for every action, so a `skipRuneforge` carried minion ids and the report's Runes table
 * listed Starforms as "runes offered"). The Runeforge's rune ids for a runeforge action, the quest shop for
 * `buyQuest`, the open Discover's options for `discover`, otherwise the tavern row + the spell slot. ONE helper —
 * the recorder's `observeTransition` reads the same one.
 */
export function visibleOffersFor(s: RunState, action?: Action): string[] {
  if (action?.type === 'buyRune' || action?.type === 'skipRuneforge' || action?.type === 'rerollRuneforge') return [...(s.runeforgeOffer ?? [])];
  if (action?.type === 'buyQuest') return [...(s.questOffer ?? [])];
  if (action?.type === 'discover') return [...(s.discover ?? [])];
  const out = s.shop.map((o) => o.cardId);
  if (s.spell) out.push(s.spell.cardId);
  return out;
}

const COMBAT_FLOW = new Set<Action['type']>(['faceOmen', 'settleCombat', 'resolveCombat']);

/**
 * Drive one seat's recruit turn. The pilot never touches the run — every proposal goes through `reduce`, and
 * acceptance is what the engine says it is (a rejected action returns the SAME state reference; the hash is
 * recorded alongside so a reconciliation can prove it).
 */
export function playRecruitTurn(
  run: RunState,
  pilot: SeatPilot,
  ctx: SeatContext,
  recorder: BalanceRecorder,
  opts: RecruitTurnOptions,
): RecruitTurnOutcome {
  const maxRejections = opts.maxConsecutiveRejections ?? 3;
  const where = `seat ${ctx.seatId} round ${ctx.round}`;
  const lineage: CardLineage = opts.lineage ?? new Map();
  let s = run;
  let accepted = 0;
  let consecutiveRejections = 0;
  const record = (before: RunState, after: RunState, action: Action, preHash: string): void => {
    recorder.onAction({
      lobbyId: opts.lobbyId,
      seatId: ctx.seatId,
      round: ctx.round,
      index: accepted,
      action,
      goldBefore: before.embers,
      goldAfter: after.embers,
      offers: visibleOffersFor(before, action),
      preHash,
      postHash: stateHash(after),
    });
    const evs = effectEventsOf(before, after, action, { lobbyId: opts.lobbyId, seatId: ctx.seatId, round: ctx.round }, lineage);
    for (const ev of evs) recorder.onEffect(ev);
    accepted += 1;
  };

  if (s.phase !== 'recruit') return { run: s, accepted, failure: `${where}: not in the recruit phase (${s.phase})` };

  for (;;) {
    if (accepted >= opts.maxActionsPerTurn) {
      return { run: s, accepted, failure: `${where}: ${opts.maxActionsPerTurn} accepted actions without ending the turn (pilot ${pilot.id})` };
    }
    let proposal: Action | null;
    try {
      proposal = pilot.decide(s, ctx);
    } catch (e) {
      return { run: s, accepted, failure: `${where}: pilot ${pilot.id} threw: ${(e as Error).message}` };
    }
    // `null` — or an explicit `faceOmen` — ends the turn. Strictly: an open modal is the pilot's to answer.
    // (The reducer lets End Turn escape a stranded `pendingTarget` for a human under the clock; a pilot has no
    // clock and an unanswered aim is a decision it failed to make.)
    if (proposal === null || proposal.type === 'faceOmen') {
      if (modalOpen(s)) return { run: s, accepted, failure: `${where}: pilot ${pilot.id} ended the turn with a modal open (${openModalName(s)})` };
      const endTurn: Action = opts.deferFight === false ? { type: 'faceOmen' } : { type: 'faceOmen', deferFight: true };
      const pre = stateHash(s);
      const next = reduce(s, endTurn);
      if (next === s) return { run: s, accepted, failure: `${where}: the engine refused End Turn` };
      record(s, next, endTurn, pre);
      return { run: next, accepted };
    }
    if (COMBAT_FLOW.has(proposal.type)) {
      return { run: s, accepted, failure: `${where}: pilot ${pilot.id} proposed a combat-flow action (${proposal.type}) during recruit` };
    }
    const pre = stateHash(s);
    const next = reduce(s, proposal);
    if (next === s) {
      consecutiveRejections += 1;
      if (consecutiveRejections >= maxRejections) {
        return { run: s, accepted, failure: `${where}: ${consecutiveRejections} consecutive rejected actions (last: ${describe(proposal)}) from pilot ${pilot.id}` };
      }
      continue;
    }
    consecutiveRejections = 0;
    record(s, next, proposal, pre);
    s = next;
  }
}

function describe(a: Action): string {
  const parts = Object.entries(a).filter(([k]) => k !== 'type').map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return parts.length ? `${a.type} ${parts.join(' ')}` : a.type;
}

// ───────────────────────────────────────────── the fight ─────────────────────────────────────────────

/**
 * Which rules a fight is resolved under. NEVER a silent correction (roadmap: "Never silently correct a
 * production discrepancy inside only the simulator") — the label rides on the manifest and every record.
 *
 *  - `corrected` (default): BOTH seats enter combat through the reducer's `preparePlayerCombatSide` — the full
 *    ~45-scaler `CombatSideState`, alignment locked, the pending Start-of-Combat banks (Fleeting Vigor, banked
 *    keywords, Open the Gates' Imps) spent into the board, Marked Target applied by whichever seat armed it.
 *    This is what the rules INTEND for every seat and what the live player already gets.
 *
 *  - `shipped`: the `enemy` seat enters the way a seat enters against the live player today — its board
 *    re-read through `snapshotBoard` → `opponentBoard` and its side through `sideFromSnapshot`. That drops
 *    (measured against the player builder, reducer.ts `preparePlayerCombatSide`): `firstSpellThisTurnId`,
 *    `spellhide` (Rune of Spellhide's Start-of-Combat recasts), `pendingQuests` (mid-combat quest completion),
 *    every pending Start-of-Combat bank, `align` on every Celestial (an unstamped side fails `alignAllows`, so
 *    alignment-gated halves are INERT), and the one-fight `CombatConfig` flags. Seat-vs-seat fights in the
 *    shipped table are weaker still (a bare `combatSide({ tier })`, runLobby.ts `settleRunLobbyRound`) — that
 *    tier-only path is deliberately NOT offered here: it is a bot-table artefact, not a rule.
 */
export type FightRules = 'corrected' | 'shipped';

export interface FightOptions {
  /** The lobby round — the loss cap (`lossDamageCap`) keys on it exactly as the shipped table's does. */
  round: number;
  rules?: FightRules;
  /** Multiplier on the damage each side takes (the shipped table's practice-bot dial). Default 1. */
  damageMult?: number;
}

export interface FightOutcome {
  /** The authoritative result, from `a`'s perspective (`a` fought as `player`, `b` as `enemy`). */
  result: CombatResult;
  aAfter: RunState;
  bAfter: RunState;
  /** Round-capped damage the lobby charged each side (armor absorbs first inside the run). */
  damageToA: number;
  damageToB: number;
}

/**
 * Both seats' turns have ended (`faceOmen { deferFight }`), each has parked its prepared side. Fight ONCE, land
 * the result on both. Throws when either run is not waiting on a deferred fight — that is a sequencing bug in
 * the caller, never something to paper over with a second preparation (which would re-fire End of Turn).
 */
export function prepareAndFight(a: RunState, b: RunState, seed: number, opts: FightOptions): FightOutcome {
  const rules = opts.rules ?? 'corrected';
  const prepA = a.pendingCombatSide;
  const prepB = b.pendingCombatSide;
  if (a.phase !== 'combat' || !prepA) throw new Error('prepareAndFight: side A has no deferred fight pending (end its turn with faceOmen { deferFight } first)');
  if (b.phase !== 'combat' || !prepB) throw new Error('prepareAndFight: side B has no deferred fight pending (end its turn with faceOmen { deferFight } first)');

  // Private copies: `simulate` and Marked Target touch the boards, and the parked sides belong to the runs.
  const boardA: BoardMinion[] = structuredClone(prepA.board);
  const poolIds = poolOf(a).all.map((c) => c.id);
  let boardB: BoardMinion[];
  let sideB: CombatSideState;
  if (rules === 'corrected') {
    boardB = structuredClone(prepB.board);
    sideB = prepB.state;
  } else {
    const snap = snapshotBoard(b);
    boardB = opponentBoard(snap);
    sideB = sideFromSnapshot(snap, b.tier, poolIds);
  }
  // Marked Target: the ARMING seat's foe enters with Taunt on its right-most body. Under `shipped` only the
  // `player` seat's mark is honoured (the shipped enemy side has no such channel); `corrected` honours both.
  markRightmost(a, boardB);
  if (rules === 'corrected') markRightmost(b, boardA);
  // NOTE (production limitation carried faithfully): `CombatConfig` is player-only — `b`'s one-fight
  // overrides (attack-first-next, Rallying Offensive) have no enemy-side expression and are spent unused.
  const rng = makeRng(mixSeed(seed, opts.round, TAG.COMBAT));
  const result = simulate(boardA, boardB, rng, CARD_INDEX, prepA.state, sideB, prepA.config);

  const mult = opts.damageMult ?? 1;
  const cap = lossDamageCap(opts.round);
  const damageToA = Math.min(cap, Math.round(result.playerDamage * mult));
  const damageToB = Math.min(cap, Math.round((result.enemyDamage ?? 0) * mult));

  const aAfter = reduce(a, { type: 'resolveCombat', fight: { result, damageTaken: damageToA } });
  if (aAfter === a) throw new Error('prepareAndFight: side A refused the deferred result');
  const bAfter = reduce(b, { type: 'resolveCombat', fight: { result: mirrorForEnemySeat(result), damageTaken: damageToB } });
  if (bAfter === b) throw new Error('prepareAndFight: side B refused the deferred result');
  return { result, aAfter, bAfter, damageToA, damageToB };
}

/**
 * The board an ELIMINATED seat left behind — what the odd seat fights when the living count is odd (owner rule
 * 2026-07-29: a ghost, never a free round). `prep` is the side it fought its dying fight with, `run` the run
 * that fought it (for the `shipped` snapshot path). A ghost is already out and settles nothing.
 */
export interface GhostSide {
  prep: { board: BoardMinion[]; state: CombatSideState };
  run: RunState;
}

/**
 * The bye seat's ghost fight: `a` (deferred, exactly as in `prepareAndFight`) as `player` against a fallen
 * seat's last board as `enemy`. One `simulate()`, only `a` settles; the ghost takes nothing (it is dead), so
 * `damageToB` is reported as 0 exactly as the shipped table records it.
 */
export function prepareAndFightGhost(a: RunState, ghost: GhostSide, seed: number, opts: FightOptions): Omit<FightOutcome, 'bAfter'> {
  const rules = opts.rules ?? 'corrected';
  const prepA = a.pendingCombatSide;
  if (a.phase !== 'combat' || !prepA) throw new Error('prepareAndFightGhost: the bye seat has no deferred fight pending');
  const boardA: BoardMinion[] = structuredClone(prepA.board);
  let boardB: BoardMinion[];
  let sideB: CombatSideState;
  if (rules === 'corrected') {
    boardB = structuredClone(ghost.prep.board);
    sideB = ghost.prep.state;
  } else {
    const snap = snapshotBoard(ghost.run);
    boardB = opponentBoard(snap);
    sideB = sideFromSnapshot(snap, ghost.run.tier, poolOf(a).all.map((c) => c.id));
  }
  markRightmost(a, boardB);
  const rng = makeRng(mixSeed(seed, opts.round, TAG.COMBAT));
  const result = simulate(boardA, boardB, rng, CARD_INDEX, prepA.state, sideB, prepA.config);
  const mult = opts.damageMult ?? 1;
  const damageToA = Math.min(lossDamageCap(opts.round), Math.round(result.playerDamage * mult));
  const aAfter = reduce(a, { type: 'resolveCombat', fight: { result, damageTaken: damageToA } });
  if (aAfter === a) throw new Error('prepareAndFightGhost: the bye seat refused the deferred result');
  return { result, aAfter, damageToA, damageToB: 0 };
}

function markRightmost(armer: RunState, foe: BoardMinion[]): void {
  if (!armer.markEnemyRightmostTaunt || foe.length === 0) return;
  const last = foe[foe.length - 1]!;
  if (!(last.keywords ?? []).includes('T')) last.keywords = [...(last.keywords ?? []), 'T'];
}

/**
 * The `enemy` seat's view of the one authoritative result.
 *
 * B1 found the simulator's carry-backs were player-only (~45 `player*` fields, 74 `side === 'player'` gates,
 * enemy Deathrattles not even counted) — the largest production discrepancy on the roadmap. `simulate` now
 * computes the SAME carry-backs for both sides and reports the enemy's on `CombatResult.enemyCarry`
 * (core `CombatCarryBacks`, 2026-09-15); this mirror lifts that object onto the `player*` fields the real
 * `resolveCombat` path reads, so the `enemy` seat settles with everything it earned: Engraved gains,
 * Kennelmaster / Sergeant / Guel / Tara progress, hand grants, Reinvestment, quest tallies, ….
 *
 * THE MAPPING IS EXPLICIT, FIELD BY FIELD, in both directions: every `player*` field on the mirrored result is
 * written from `enemyCarry` and nothing else (the fight's own `player*` fields — the OTHER seat's earnings —
 * are stripped first, so a new `player*` field can never leak across the table by default, and a new
 * `CombatCarryBacks` field is silently dropped here until it is mapped — the leak test names the contract).
 *
 * WHAT IS STILL NOT MIRRORED — the simulator's known, kept asymmetries (see `CombatCarryBacks`): Pack
 * Mentality's live growth, Blood Trail's mark, and the resolution-bearing live reads (an enemy Grim reads its
 * frozen tally this fight; enemy spell power / Imp aura / per-card stacks stay static this fight even though
 * their gains DO carry back). A result without `enemyCarry` (a hand-built fixture) mirrors damage, outcome,
 * deaths and survivors only — deathrattles recorded as 0, never estimated.
 */
export function mirrorForEnemySeat(result: CombatResult): CombatResult {
  const clone = structuredClone(result);
  // Strip EVERY player-perspective carry-back: they belong to the other seat.
  for (const key of Object.keys(clone) as (keyof CombatResult)[]) {
    if (key.startsWith('player')) delete clone[key];
  }
  delete clone.damageBreakdown;
  delete clone.enemyScalers;
  delete clone.oddsInput;
  delete clone.enemyCarry; // consumed here — the mirrored view must not carry the other seat's mirror of it
  const outcome = result.result === 'win' ? 'lose' : result.result === 'lose' ? 'win' : 'draw';
  const c = result.enemyCarry;
  const survivors = c ? (c.survivorCardIds ?? []) : enemySurvivorCardIds(result);
  const defined = <T extends object>(o: T): Partial<T> =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
  const carried: Partial<CombatResult> = c ? defined({
    playerDeathrattles: c.deathrattles,
    playerRallies: c.rallies,
    playerImpsSummoned: c.impsSummoned,
    playerFirstKill: c.firstKill,
    playerLastKill: c.lastKill,
    playerQuestTally: c.questTally,
    playerQuestEvents: c.questEvents,
    playerBeastBuyAtkGain: c.beastBuyAtkGain,
    playerBeastBuyHpGain: c.beastBuyHpGain,
    playerBeastScaleProgress: c.beastScaleProgress,
    playerSummonBonus: c.summonBonus,
    playerHpGrantBonus: c.hpGrantBonus,
    playerSpellProgress: c.spellProgress,
    playerDamageMeters: c.damageMeters,
    playerAscendCount: c.ascendCount,
    playerPermaBuffs: c.permaBuffs,
    playerHandGrants: c.handGrants,
    playerHandBuffs: c.handBuffs,
    playerRubyGrants: c.rubyGrants,
    playerRubyGrantIds: c.rubyGrantIds,
    playerNextTurnSpellCopies: c.nextTurnSpellCopies,
    playerRubyBonusGain: c.rubyBonusGain,
    playerRubyMints: c.rubyMints,
    playerHandSummoned: c.handSummoned,
    playerBeastExtraGain: c.beastExtraGain,
    playerTavernBuyGain: c.tavernBuyGain,
    playerTavernBuyGainSources: c.tavernBuyGainSources,
    playerWildHuntGrown: c.wildHuntGrown,
    playerSpellPower: c.spellPower,
    playerCardBuffs: c.cardBuffs,
    playerFodderGrants: c.fodderGrants,
    playerFodderSchedule: c.fodderSchedule,
    playerDeferredBattlecries: c.deferredBattlecries,
    playerMaxGoldGain: c.maxGoldGain,
    playerBonusGold: c.bonusGold,
    playerFreeRolls: c.freeRolls,
    playerGuaranteedAttachments: c.guaranteedAttachments,
    playerSpellsCast: c.spellsCast,
    playerSpellEscalationGain: c.spellEscalationGain,
    playerDiscoverCasts: c.discoverCasts,
    playerNextShopBuff: c.nextShopBuff,
    playerUndeadBuyAtkGain: c.undeadBuyAtkGain,
    playerSlaughterCopy: c.slaughterCopy,
    playerUndeadAuraGain: c.undeadAuraGain,
    playerImpBuffGain: c.impBuffGain,
    playerHoardGain: c.hoardGain,
    playerRightmostSlotBuff: c.rightmostSlotBuff,
    playerBeastialSwarmLevel: c.beastialSwarmLevel,
    playerPackcraftLevel: c.packcraftLevel,
    playerBoardBuffGain: c.boardBuffGain,
    playerMagneticBuffGain: c.magneticBuffGain,
    playerFodderBuffGain: c.fodderBuffGain,
  }) : { playerDeathrattles: 0 }; // UNKNOWN without the symmetric surface — recorded as 0, never estimated
  return {
    ...clone,
    result: outcome,
    playerDamage: result.enemyDamage ?? 0,
    enemyDamage: result.playerDamage,
    playerDeaths: c ? c.deaths : result.enemyDeaths,
    enemyDeaths: c ? c.foeDeaths : (result.playerDeaths ?? 0),
    ...(survivors.length ? { playerSurvivorCardIds: survivors } : {}),
    initial: { player: clone.initial.enemy, enemy: clone.initial.player },
    ...carried,
  } as CombatResult;
}

/** The enemy survivors folded from the event log — the fallback for a result without `enemyCarry`. */
function enemySurvivorCardIds(result: CombatResult): string[] {
  const alive = new Map<string, string>(result.initial.enemy.map((m) => [m.uid, m.cardId]));
  for (const e of result.events) {
    if (e.type === 'summon' && e.side === 'enemy') alive.set(e.minion.uid, e.minion.cardId);
    else if (e.type === 'death' && e.side === 'enemy' && !e.rise) alive.delete(e.target);
  }
  return [...alive.values()];
}
