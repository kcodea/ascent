/**
 * BALANCE BOT — the PINNED LOBBY (docs/balance-bot-roadmap.md, "Shipped asynchronous lobby": how does this
 * hero / build perform in the experience people currently play, against a pinned compatible recording population?).
 *
 * The pilot plays a REAL run in seat 0 of the SHIPPED eight-seat lobby. The other seven seats are RECORDED PLAYER
 * RUNS from the registered corpus (`balance:corpus` → `registerOpponents` → `playerRunsFrom`), seated by
 * `createRunLobby` exactly as a player gets them: a seeded shuffle of the eligible runs, unique heroes across the
 * table, real authors' names. Nothing here re-implements the table — every round goes through the machinery the
 * live game runs:
 *
 *  - the pilot's recruit turn is `playRecruitTurn` on a `createLobbyRun(…)` run (the same run shape the client
 *    creates on hero select), ended through the SHIPPED `faceOmen` — the reducer serves the paired seat's recorded
 *    board (`lobbyOpponentBoard` → `playerOpponent` → the recording's board for this round), builds its side
 *    through `sideFromSnapshot`, and resolves ONE `simulate()`;
 *  - `resolveCombat` then settles the run AND the round: `settleLobbyRound` → `settleRunLobbyRound` charges the
 *    player's seat from that one result and resolves the six other seats' fights (recording vs recording, the
 *    shipped tier-only path), the ghost fights, knockouts, shared placements and the round cap;
 *  - the run ends when the player's seat is knocked out or the lobby finishes (`advanceCombat`'s lobby branch).
 *
 * This is `fightRules: 'shipped'` BY DEFINITION — the recorded seats have no live run to prepare through the
 * player's builder — and the record says so whatever the manifest wrote.
 *
 * After the pilot is eliminated the table is played OUT through `settleRunLobbyRound` (the player's seat is dead,
 * so the "player result" it takes is never read) until it finishes, so every recording carries a placement and the
 * report can describe the population the pilot sat in. The client stops at the pilot's elimination; those later
 * rounds change nothing about the pilot's own record.
 *
 * Deterministic from `(manifest, seed)`: the run seed, the hero rotation, the seat fill, the pairing and every fight
 * RNG are pure functions of them and the registered corpus (whose digest the manifest names).
 */
import type { CombatResult } from '@game/core';
import type { SetId } from '@game/content';
import { HERO_INDEX, playableHeroes } from '../heroes';
import { DEFAULT_LOBBY_RULES } from '../lobby/lobby';
import { boardIntel, createLobbyRun, driverFor, playerOpponent, settleRunLobbyRound, type LobbySeatState, type RunLobby } from '../lobby/runLobby';
import { lossDamageCap } from '../reducer';
import type { ScoutedBoard, ScoutedSeat } from '../productionBots/scout';
import { playerRunByKey } from '../lobby/snapshotSeats';
import type { LobbyEncounter } from '../lobby/types';
import { reduce } from '../reducer';
import { runTribesForSeed, type RunState } from '../state';
import { snapshotBoard } from '../snapshot';
import type { CardLineage } from './effectsFromTransition';
import { playRecruitTurn } from './seatRunner';
import { DEFAULT_MAX_ACTIONS_PER_TURN } from './selfPlayLobby';
import type { BalanceRecorder, ExperimentIdentity, ExperimentManifest, LobbyRecord, RoundRecord, RunRecord, SeatContext, SeatPilot } from './types';

/** The `policyId` a recorded seat carries: its placements are the POPULATION's, never a pilot's decisions. */
export const RECORDING_POLICY_ID = 'recording';

/**
 * The pilot's hero for this seed under the production hero rules: the manifest's roster when it names one, else
 * every playable hero; a tribe-gated hero (`HeroDef.tribes`) only on a run that rolled one of its tribes; rotated
 * by seed so a job covers the roster. The seven other seats' heroes are whatever the corpus fill picks (unique).
 */
export function pilotHeroFor(manifest: ExperimentManifest, seed: number): { heroId?: string; failure?: string } {
  const roster = manifest.heroes?.length
    ? manifest.heroes.map((id) => { const h = HERO_INDEX[id]; if (!h) throw new Error(`balance: manifest names unknown hero '${id}'`); return h; })
    : playableHeroes();
  const tribes = runTribesForSeed(seed, manifest.setId);
  for (let offset = 0; offset < roster.length; offset++) {
    const h = roster[(seed + offset) % roster.length]!;
    if (h.tribes && !h.tribes.some((t) => tribes.includes(t))) continue;
    return { heroId: h.id };
  }
  return { failure: `no eligible pilot hero for seed ${seed} (roster ${roster.length}, run tribes ${tribes.join('/')})` };
}

const outcomeOf = (r: 'win' | 'lose' | 'draw'): RoundRecord['result'] => (r === 'lose' ? 'loss' : r === 'draw' ? 'tie' : 'win');
const invert = (r: 'win' | 'lose' | 'draw'): 'win' | 'lose' | 'draw' => (r === 'win' ? 'lose' : r === 'lose' ? 'win' : 'draw');

/** A seat's view of one encounter: who it met, what it took and dealt, how it went. */
function seatView(e: LobbyEncounter, seatId: string): { foe: string; taken: number; dealt: number; result: RoundRecord['result'] } {
  const isA = e.a === seatId;
  const outcome = isA ? e.outcome : invert(e.outcome);
  return {
    foe: isA ? e.b : e.a,
    taken: isA ? e.damageToA : e.damageToB,
    dealt: isA ? e.damageToB : e.damageToA,
    // A bye is the odd seat's ghost fight (or a sit-out before the first elimination) — recorded as `bye` exactly
    // as the self-play lobby records it, so the two modes' pacing tables read alike.
    result: e.bye === seatId || !e.fought ? 'bye' : outcomeOf(outcome),
  };
}

/** The board a RECORDED seat fielded this round — the same lookup the table's own fights make. */
function recordedBoard(seat: LobbySeatState, round: number, setId: SetId | undefined): { ids: string[]; tier: number } {
  const d = driverFor(seat, setId);
  const b = d?.prepare(round) ?? d?.finalBoard?.() ?? null;
  return b ? { ids: b.minions.map((m) => m.cardId), tier: b.tier } : { ids: [], tier: 1 };
}

/**
 * THE PILOT'S SCOUT for this round — exactly what the shipped rail shows a player while shopping (the rule, with
 * its file:line sources, is documented in `productionBots/scout.ts`):
 *  - the NEXT opponent (`playerOpponent`, LobbyPanel.tsx:87) with the intel of the board it brings THIS round
 *    (LobbyPanel.tsx:89-91 — tier / triples / dominant tribe / quests / runes, never its bodies);
 *  - every other living seat with the intel RECORDED AT SETTLE from its last fielded board (runLobby.ts:584-586)
 *    and its live Resolve / Armor;
 *  - the pilot's own combat memory: the board a seat fielded the last time the pilot FOUGHT it (`memory`, written
 *    only after that fight resolved — never a board from a wave the pilot has not met).
 * `seatedRecordings` is the fairness guard for the pool panel, not player information.
 */
export function pinnedScout(run: RunState, lobby: RunLobby, round: number, memory: ReadonlyMap<string, ScoutedBoard>): Pick<SeatContext, 'nextOpponent' | 'field' | 'myHealth' | 'myArmor' | 'lossCap' | 'seatedRecordings'> {
  const view = (s: LobbySeatState): ScoutedSeat => ({
    seatId: s.id, heroId: s.heroId, alive: s.alive, health: Math.max(0, s.resolve), armor: Math.max(0, s.armor),
    intel: s.intel ?? null, lastFought: memory.get(s.id) ?? null,
  });
  const next = playerOpponent(lobby);
  return {
    nextOpponent: next ? { ...view(next.seat), intel: boardIntel(next.board, round), ...(next.ghost ? { ghost: true } : {}) } : null,
    field: lobby.seats.filter((s) => s.id !== 's0' && s.alive).map(view),
    myHealth: run.resolve, myArmor: run.armor, lossCap: lossDamageCap(round),
    seatedRecordings: lobby.seats.filter((s) => s.runKey).map((s) => s.runKey!),
  };
}

/** A result nobody reads: `settleRunLobbyRound` takes the player's result, and the player's seat is dead. */
const DEAD_PLAYER_RESULT: CombatResult = { result: 'draw', playerDamage: 0, enemyDamage: 0, playerDeaths: 0, enemyDeaths: 0, playerDeathrattles: 0, events: [], initial: { player: [], enemy: [] } } as unknown as CombatResult;

export function runPinnedLobby(
  manifest: ExperimentManifest,
  seed: number,
  pilot: SeatPilot,
  recorder: BalanceRecorder,
  identity: ExperimentIdentity,
): LobbyRecord {
  const setId = manifest.setId;
  const rules = { ...DEFAULT_LOBBY_RULES, ...(manifest.maxRounds !== undefined ? { maxRounds: manifest.maxRounds } : {}) };
  const maxActionsPerTurn = manifest.maxActionsPerTurn ?? DEFAULT_MAX_ACTIONS_PER_TURN;
  const lobbyId = `${manifest.mode}:${setId}:${manifest.policy.id}:${seed}`;
  // The record labels the rules it ACTUALLY ran under: a pinned lobby's fights are the shipped path by construction.
  const record: LobbyRecord = { lobbyId, seed, manifest: { ...manifest, fightRules: 'shipped' }, identity, seats: [], rounds: [], actions: [], effects: [], roundsPlayed: 0 };
  const rec: BalanceRecorder = {
    onAction: (ev) => { record.actions.push(ev); recorder.onAction(ev); },
    onEffect: (ev) => { record.effects.push(ev); recorder.onEffect(ev); },
    onRound: (r) => { record.rounds.push(r); recorder.onRound(r); },
    onRun: (r) => { record.seats.push(r); recorder.onRun(r); },
  };
  let failure: string | undefined;
  const fail = (why: string): void => { failure ??= why; };

  // ── the table, exactly as the client builds it on hero select ─────────────────────────────────────────────
  const hero = pilotHeroFor(manifest, seed);
  if (!hero.heroId) fail(hero.failure!);
  let run: RunState | null = hero.heroId ? createLobbyRun(seed, hero.heroId, { maxRounds: rules.maxRounds }, 'lobby', undefined, setId) : null;
  const lobby0 = run?.lobby;
  if (run && lobby0) {
    // EVERY other seat must be a recording. The shipped fill pads a thin corpus with generated hybrid seats — bot
    // seats, whose data the owner has ruled worthless here — so a table the corpus cannot fill is a FAILURE of the
    // job's premise, reported, never a quietly mixed population.
    const generated = lobby0.seats.filter((s) => s.kind !== 'player' && s.kind !== 'snapshot');
    if (generated.length) fail(`corpus too thin: ${generated.length} of 7 seats fell to generated seats (${generated.map((s) => `${s.id}:${s.kind}/${s.heroId}`).join(', ')}) — register a corpus with ≥ 7 runs on heroes other than ${hero.heroId}`);
    if (lobby0.seats.length !== rules.seatCount) fail(`the shipped fill seated ${lobby0.seats.length} of ${rules.seatCount}`);
  }

  const seatRecord = (lobby: RunLobby, seat: LobbySeatState, round: number, e: LobbyEncounter | undefined, extra: { tier: number; board: readonly string[]; hand: readonly string[]; goldSpent: number; goldUnspent: number; snapshot?: RoundRecord['snapshot'] }): void => {
    const v = e ? seatView(e, seat.id) : null;
    rec.onRound({
      lobbyId, seatId: seat.id, round, heroId: seat.heroId,
      tier: extra.tier, goldSpent: extra.goldSpent, goldUnspent: extra.goldUnspent,
      board: extra.board, hand: extra.hand,
      health: Math.max(0, seat.resolve), armor: Math.max(0, seat.armor),
      opponentSeatId: v ? (v.foe === seat.id ? null : v.foe) : null,
      result: v ? v.result : 'bye', damageDealt: v?.dealt ?? 0, damageTaken: v?.taken ?? 0,
      eliminated: !seat.alive,
      ...(extra.snapshot ? { snapshot: extra.snapshot } : {}),
    });
  };

  /** Round records for every seat that took part in `round`, read off the settled table. */
  const recordRound = (lobby: RunLobby, round: number, living: readonly string[], fought: RunState | null): void => {
    const encounters = lobby.encounters.filter((x) => x.round === round);
    const encounterOf = (id: string): LobbyEncounter | undefined => encounters.find((x) => x.a === id || x.b === id);
    for (const seat of lobby.seats) {
      if (!living.includes(seat.id)) continue;
      const e = encounterOf(seat.id);
      if (seat.kind === 'player') {
        if (!fought) continue;
        seatRecord(lobby, seat, round, e, {
          tier: fought.tier, board: fought.board.map((c) => c.cardId), hand: fought.hand.map((c) => c.cardId),
          goldSpent: fought.goldSpentThisTurn ?? 0, goldUnspent: fought.embers,
          ...(fought.board.length > 0 ? { snapshot: snapshotBoard(fought) } : {}),
        });
        continue;
      }
      // A recorded seat: the board it fielded. For the seat the PILOT fought, the bodies that actually entered the
      // fight (`lastCombat.initial.enemy`) — the served board, not a re-derivation of it.
      const foughtPilot = fought?.lastCombat && e && (e.a === 's0' || e.b === 's0') && !(e.bye === 's0');
      const board = foughtPilot ? { ids: fought!.lastCombat!.initial.enemy.map((m) => m.cardId), tier: recordedBoard(seat, round, lobby.setId).tier } : recordedBoard(seat, round, lobby.setId);
      seatRecord(lobby, seat, round, e, { tier: board.tier, board: board.ids, hand: [], goldSpent: 0, goldUnspent: 0 });
    }
  };

  // ── the rounds ─────────────────────────────────────────────────────────────────────────────────────────────
  /** The pilot's combat memory: seat id → the board it fielded the last time the pilot fought it. */
  const memory = new Map<string, ScoutedBoard>();
  /** The pilot's card LINEAGE (uid → acquisition route), kept ACROSS turns so the recorder's attributer can say how
   *  every played / sold / cast card came to be (`sourceId` + `route: 'shop'` on a buy — the report's offer → buy →
   *  played funnel reads exactly that; without it the pinned report printed `bought 0` for every card). */
  const lineage: CardLineage = new Map();
  while (!failure && run && run.phase === 'recruit') {
    const lobby = run.lobby!;
    const round = lobby.round;
    if (round > rules.maxRounds) { fail(`round ${round} exceeds maxRounds ${rules.maxRounds} with the run still in recruit`); break; }
    const living = lobby.seats.filter((s) => s.alive).map((s) => s.id);
    const scout = pinnedScout(run, lobby, round, memory);
    // The board the paired seat brings — the very one `faceOmen` will serve (`lobbyOpponentBoard` makes the same
    // call). Remembered only AFTER the fight resolves, below.
    const foe = playerOpponent(lobby);
    const turn = playRecruitTurn(run, pilot, { seatId: 's0', round, scoutedOpponent: null, ...scout }, rec, { maxActionsPerTurn, lobbyId, deferFight: false, lineage });
    run = turn.run;
    if (turn.failure) { fail(turn.failure); break; }
    if (run.phase !== 'combat' || !run.lastCombat) { fail(`round ${round}: End Turn did not resolve a fight (phase ${run.phase})`); break; }
    const fought = run; // the run as it entered the fight: board, hand, Gold, and the served enemy
    if (foe) {
      memory.set(foe.seat.id, {
        minions: foe.board.minions.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] })),
        ...(foe.board.snapshot ? { snapshot: foe.board.snapshot } : {}),
        tier: foe.board.tier, round,
      });
    }
    // The SHIPPED settle: the run's carry-backs and the whole table's round, from that one result.
    const next = reduce(run, { type: 'resolveCombat' });
    if (next === run) { fail(`round ${round}: the engine refused resolveCombat`); break; }
    run = next;
    const settled = run.lobby!;
    if (settled.round !== round + 1 && !settled.finished) { fail(`round ${round}: the table did not advance (round ${settled.round})`); break; }
    // The seat and the run must agree on the pilot's health — asserted, not assumed.
    const me = settled.seats[0]!;
    if (me.alive && (Math.max(0, me.resolve) !== run.resolve || Math.max(0, me.armor) !== run.armor)) { fail(`round ${round}: seat/run health diverged (${me.resolve}/${me.armor} vs ${run.resolve}/${run.armor})`); break; }
    recordRound(settled, round, living, fought);
    record.roundsPlayed = round;
  }

  // ── play the table out once the pilot is gone, so the population has placements ──────────────────────────
  if (!failure && run && run.lobby && !run.lobby.finished && !run.lobby.seats[0]!.alive) {
    let lobby: RunLobby = { ...run.lobby, seats: run.lobby.seats.map((x) => ({ ...x })), encounters: [...run.lobby.encounters] };
    while (!lobby.finished) {
      const round = lobby.round;
      const living = lobby.seats.filter((s) => s.alive).map((s) => s.id);
      lobby = settleRunLobbyRound(lobby, DEAD_PLAYER_RESULT);
      recordRound(lobby, round, living, null);
      record.roundsPlayed = round;
    }
    run = { ...run, lobby };
  }

  // ── terminations ───────────────────────────────────────────────────────────────────────────────────────────
  const lobby = run?.lobby;
  const capped = !failure && !!lobby && lobby.round > lobby.rules.maxRounds && lobby.seats.filter((s) => s.alive).length > 1;
  for (const seat of lobby?.seats ?? []) {
    const isPilot = seat.kind === 'player';
    const recording = !isPilot && seat.runKey ? playerRunByKey(seat.runKey, undefined, setId) : null;
    const rr: RunRecord = {
      lobbyId, seatId: seat.id, heroId: seat.heroId, setId,
      tribes: isPilot ? run!.tribes : (recording?.snaps[0]?.tribes ?? []),
      policyId: isPilot ? pilot.id : RECORDING_POLICY_ID,
      ...(failure ? {} : { placement: seat.placement }),
      ...(seat.eliminatedRound !== undefined ? { eliminatedRound: seat.eliminatedRound } : {}),
      termination: failure ? 'failed' : capped && seat.alive ? 'capped' : 'placed',
      ...(failure ? { failure } : {}),
      runesOwned: isPilot ? (run!.ownedRunes ?? []) : (recording?.snaps[recording.snaps.length - 1]?.runes ?? []),
      finalBoard: isPilot ? run!.board.map((c) => c.cardId) : recordedBoard(seat, seat.eliminatedRound ?? lobby!.round, setId).ids,
      ...(recording ? { recording: { key: recording.key, author: recording.author, waves: recording.snaps.length, ...(recording.snaps[0]?.patch ? { patch: recording.snaps[0].patch } : {}) } } : {}),
      // B4/B9: the line a strategist / operator pilot committed the run to (owed since the B4 integration).
      ...(isPilot ? (() => { const line = pilot.lineOf?.('s0'); return line ? { line } : {}; })() : {}),
    };
    rec.onRun(rr);
  }
  if (failure && !lobby) {
    // The table never existed (no eligible hero): one failed pilot record so coverage still sees the seed.
    rec.onRun({ lobbyId, seatId: 's0', heroId: hero.heroId ?? '', setId, tribes: [], policyId: pilot.id, termination: 'failed', failure, runesOwned: [], finalBoard: [] });
  }
  if (failure) record.failure = failure;
  return record;
}
