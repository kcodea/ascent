/**
 * BALANCE BOT — B1: the full eight-seat SELF-PLAY lobby (docs/balance-bot-roadmap.md, "Full live eight-seat
 * self-play": what happens when every seat shops and develops under the actual results of its own fights).
 *
 * Eight LIVING seats, each a real `createRun(…, 'lobby', …)` pinned to the manifest's set. Every round: the
 * table is paired by the shipped `pairRunLobby` (the exhaustive min-cost matching with the no-repeat window and
 * the bottom-three bye rule), every living seat plays its recruit turn through `playRecruitTurn`, each pair
 * fights ONCE through `prepareAndFight`, the odd seat fights the most recently fallen seat's last board (a
 * ghost — never a free round), seats are charged through the shipped `hitSeat`, knocked out by `knockOutIfDead`,
 * and the round closes through `closeRunLobbyRound` (wipeout guard, shared placements, `maxRounds`).
 *
 * A seat that cannot be advanced FAILS THE LOBBY: every run is terminated `failed`, the record carries the
 * reason, and nothing is written as a loss (roadmap: "must never become ordinary losses or silently forced turns").
 *
 * Deterministic from `(manifest, seed)`: seat seeds, hero rotation, pairing, fight RNG and the pilots are all
 * pure functions of them — two runs of one seed produce byte-identical records.
 */
import type { SetId } from '@game/content';
import { HERO_INDEX, playableHeroes } from '../heroes';
import { DEFAULT_LOBBY_RULES } from '../lobby/lobby';
import { closeRunLobbyRound, hitSeat, knockOutIfDead, pairRunLobby, type LobbySeatState, type RunLobby } from '../lobby/runLobby';
import type { LobbyEncounter } from '../lobby/types';
import { createRun, runTribesForSeed, type RunState } from '../state';
import { snapshotBoard } from '../snapshot';
import { prepareAndFight, prepareAndFightGhost, type FightRules, type GhostSide } from './seatRunner';
import { playRecruitTurn } from './seatRunner';
import type { BalanceRecorder, ExperimentIdentity, ExperimentManifest, LobbyRecord, RoundRecord, SeatPilot } from './types';

/** Recruit actions a seat may take per turn before it is failed, when the manifest does not say. */
export const DEFAULT_MAX_ACTIONS_PER_TURN = 200;

interface Seat {
  idx: number;
  state: LobbySeatState;
  run: RunState;
  pilot: SeatPilot;
  /** The side + run of the seat's most recent fight — what it leaves behind as a ghost. */
  lastFought?: GhostSide;
  /** Per-round bookkeeping for the RoundRecord. */
  turnGoldSpent: number;
  turnGoldUnspent: number;
}

/** Seat i's run seed — the shipped derivation for generated seats (`createRunLobby`: `seed * 1000 + i`). */
export const seatSeed = (lobbySeed: number, idx: number): number => lobbySeed * 1000 + idx;

/**
 * Rotate the manifest's heroes across the seats for this seed, under the production hero rules: a hero sits at
 * most once per lobby (owner 2026-09-13), `wip` / `practiceOnly` heroes are off the table unless the manifest
 * names them explicitly, and a tribe-gated hero (`HeroDef.tribes`) only sits on a run that rolled one of its
 * tribes. Returns the failure reason when a seat cannot be filled (a manifest with fewer than eight eligible
 * heroes is a manifest error, reported — not padded).
 */
export function rotateHeroes(manifest: ExperimentManifest, seed: number, seatCount: number): { heroIds: string[]; failure?: string } {
  const roster = manifest.heroes?.length
    ? manifest.heroes.map((id) => { const h = HERO_INDEX[id]; if (!h) throw new Error(`balance: manifest names unknown hero '${id}'`); return h; })
    : playableHeroes();
  const heroIds: string[] = [];
  for (let i = 0; i < seatCount; i++) {
    const tribes = runTribesForSeed(seatSeed(seed, i), manifest.setId);
    let picked: string | undefined;
    for (let offset = 0; offset < roster.length; offset++) {
      const h = roster[(seed + i + offset) % roster.length]!;
      if (heroIds.includes(h.id)) continue;
      if (h.tribes && !h.tribes.some((t) => tribes.includes(t))) continue;
      picked = h.id;
      break;
    }
    if (!picked) return { heroIds, failure: `no eligible hero for seat ${i} (roster ${roster.length}, ${heroIds.length} seated, run tribes ${tribes.join('/')})` };
    heroIds.push(picked);
  }
  return { heroIds };
}

function makeRun(seed: number, heroId: string, setId: SetId): RunState {
  return createRun(seed, heroId, 'lobby', undefined, setId);
}

/** The most recently fallen seat (strictly before this round) with a board to raise — the shipped `ghostFor` rule. */
function ghostOf(seats: Seat[], round: number): Seat | null {
  const fallen = seats
    .filter((x) => !x.state.alive && x.state.eliminatedRound !== undefined && x.state.eliminatedRound < round && x.lastFought)
    .sort((a, b) => (b.state.eliminatedRound ?? 0) - (a.state.eliminatedRound ?? 0));
  return fallen[0] ?? null;
}

export function runSelfPlayLobby(
  manifest: ExperimentManifest,
  seed: number,
  pilotFor: (seatIdx: number) => SeatPilot,
  recorder: BalanceRecorder,
  identity: ExperimentIdentity,
): LobbyRecord {
  const rules = { ...DEFAULT_LOBBY_RULES, ...(manifest.maxRounds !== undefined ? { maxRounds: manifest.maxRounds } : {}) };
  const fightRules: FightRules = manifest.fightRules ?? 'corrected';
  const maxActionsPerTurn = manifest.maxActionsPerTurn ?? DEFAULT_MAX_ACTIONS_PER_TURN;
  const lobbyId = `${manifest.mode}:${manifest.setId}:${manifest.policy.id}:${seed}`;
  const record: LobbyRecord = { lobbyId, seed, manifest, identity, seats: [], rounds: [], actions: [], effects: [], roundsPlayed: 0 };
  // The runner's own view of accepted actions rides on the record too (the recorder may be a no-op).
  const rec: BalanceRecorder = {
    onAction: (ev) => { record.actions.push(ev); recorder.onAction(ev); },
    onEffect: (ev) => { record.effects.push(ev); recorder.onEffect(ev); },
    onRound: (r) => { record.rounds.push(r); recorder.onRound(r); },
    onRun: (r) => { record.seats.push(r); recorder.onRun(r); },
  };

  const rotation = rotateHeroes(manifest, seed, rules.seatCount);
  const seats: Seat[] = rotation.heroIds.map((heroId, idx) => {
    const run = makeRun(seatSeed(seed, idx), heroId, manifest.setId);
    return {
      idx,
      state: { id: `s${idx}`, label: `seat ${idx}`, heroId, kind: 'bot', seed: seatSeed(seed, idx), resolve: run.resolve, armor: run.armor, alive: true },
      run,
      pilot: pilotFor(idx),
      turnGoldSpent: 0,
      turnGoldUnspent: 0,
    };
  });
  const table: RunLobby = { version: 1, seed, setId: manifest.setId, round: 1, seats: seats.map((s) => s.state), encounters: [], finished: false, rules };
  const byId = new Map(seats.map((s) => [s.state.id, s]));

  let failure: string | undefined = rotation.failure;
  const fail = (why: string): void => { failure ??= why; };

  const roundRecord = (seat: Seat, round: number, opponent: Seat | null, fought: { taken: number; dealt: number; result: RoundRecord['result'] }): void => {
    rec.onRound({
      lobbyId, seatId: seat.state.id, round, heroId: seat.state.heroId,
      tier: seat.run.tier,
      goldSpent: seat.turnGoldSpent, goldUnspent: seat.turnGoldUnspent,
      board: seat.run.board.map((c) => c.cardId), hand: seat.run.hand.map((c) => c.cardId),
      health: seat.state.resolve, armor: seat.state.armor,
      opponentSeatId: opponent ? opponent.state.id : null,
      result: fought.result, damageDealt: fought.dealt, damageTaken: fought.taken,
      eliminated: !seat.state.alive,
      snapshot: seat.run.board.length > 0 ? snapshotBoard(seat.run) : undefined,
    });
  };
  const outcomeOf = (r: 'win' | 'lose' | 'draw'): RoundRecord['result'] => (r === 'lose' ? 'loss' : r === 'draw' ? 'tie' : 'win');
  const invert = (r: 'win' | 'lose' | 'draw'): 'win' | 'lose' | 'draw' => (r === 'win' ? 'lose' : r === 'lose' ? 'win' : 'draw');

  while (!failure && !table.finished) {
    const round = table.round;
    const living = seats.filter((s) => s.state.alive);
    // Pair FIRST: the pairing is a pure function of the table, so it is what a seat could scout while shopping.
    const { pairs, bye } = pairRunLobby(table);
    const opponentOf = new Map<string, Seat | null>();
    for (const [a, b] of pairs) { opponentOf.set(a.id, byId.get(b.id)!); opponentOf.set(b.id, byId.get(a.id)!); }
    const ghost = bye ? ghostOf(seats, round) : null;
    if (bye) opponentOf.set(bye.id, ghost);

    // Every living seat plays its recruit turn (seat order — the order is immaterial, the runs are independent).
    for (const seat of living) {
      const foe = opponentOf.get(seat.state.id) ?? null;
      const before = seat.run;
      const turn = playRecruitTurn(seat.run, seat.pilot, { seatId: seat.state.id, round, scoutedOpponent: foe?.run.lastCombat ?? null }, rec, { maxActionsPerTurn, lobbyId });
      seat.run = turn.run;
      if (turn.failure) { fail(turn.failure); break; }
      // Gold spent this turn is the run's own counter (reset by the turn rollover, so read it now); unspent is
      // what the shop closed on.
      seat.turnGoldSpent = seat.run.goldSpentThisTurn ?? Math.max(0, before.embers - seat.run.embers);
      seat.turnGoldUnspent = seat.run.embers;
      const prep = seat.run.pendingCombatSide;
      if (!prep) { fail(`seat ${seat.state.id} round ${round}: ended the turn without a deferred fight pending`); break; }
      seat.lastFought = { prep: { board: prep.board, state: prep.state }, run: seat.run };
    }
    if (failure) break;

    const eliminated: LobbySeatState[] = [];
    const hpBefore = new Map(table.seats.map((s) => [s.id, s.armor + s.resolve]));
    let pairIdx = 0;
    for (const [sa, sb] of pairs) {
      const a = byId.get(sa.id)!;
      const b = byId.get(sb.id)!;
      let fight;
      try {
        fight = prepareAndFight(a.run, b.run, seed ^ (pairIdx * 0x9e3779b9), { round, rules: fightRules });
      } catch (e) {
        fail(`round ${round} ${a.state.id} vs ${b.state.id}: ${(e as Error).message}`);
        break;
      }
      pairIdx += 1;
      a.run = fight.aAfter;
      b.run = fight.bAfter;
      // The table charges the seats through the shipped `hitSeat`; the runs charged themselves from the same
      // numbers inside `resolveCombat`, so the two views agree by construction (asserted, not assumed).
      hitSeat(sa, fight.damageToA);
      hitSeat(sb, fight.damageToB);
      if (Math.max(0, sa.resolve) !== a.run.resolve || sa.armor !== a.run.armor) { fail(`round ${round} ${sa.id}: seat/run health diverged (${sa.resolve}/${sa.armor} vs ${a.run.resolve}/${a.run.armor})`); break; }
      if (Math.max(0, sb.resolve) !== b.run.resolve || sb.armor !== b.run.armor) { fail(`round ${round} ${sb.id}: seat/run health diverged (${sb.resolve}/${sb.armor} vs ${b.run.resolve}/${b.run.armor})`); break; }
      knockOutIfDead(sa, round, eliminated);
      knockOutIfDead(sb, round, eliminated);
      const enc: LobbyEncounter = { round, a: sa.id, b: sb.id, outcome: fight.result.result, damageToA: fight.damageToA, damageToB: fight.damageToB, fought: true };
      table.encounters.push(enc);
      roundRecord(a, round, b, { taken: fight.damageToA, dealt: fight.damageToB, result: outcomeOf(fight.result.result) });
      roundRecord(b, round, a, { taken: fight.damageToB, dealt: fight.damageToA, result: outcomeOf(invert(fight.result.result)) });
    }
    if (failure) break;

    if (bye) {
      const me = byId.get(bye.id)!;
      if (!ghost) {
        // Unreachable at eight seats: the count is odd only after an elimination, and every fallen seat fought.
        fail(`round ${round} ${bye.id}: bye with no ghost to raise (the run would sit in a deferred fight forever)`);
        break;
      }
      let fight;
      try {
        fight = prepareAndFightGhost(me.run, ghost.lastFought!, seed ^ (pairIdx * 0x9e3779b9), { round, rules: fightRules });
      } catch (e) {
        fail(`round ${round} ${bye.id} vs ghost ${ghost.state.id}: ${(e as Error).message}`);
        break;
      }
      me.run = fight.aAfter;
      hitSeat(bye, fight.damageToA);
      if (Math.max(0, bye.resolve) !== me.run.resolve || bye.armor !== me.run.armor) { fail(`round ${round} ${bye.id}: seat/run health diverged after the ghost fight`); break; }
      knockOutIfDead(bye, round, eliminated);
      table.encounters.push({ round, a: bye.id, b: ghost.state.id, outcome: fight.result.result, damageToA: fight.damageToA, damageToB: 0, bye: bye.id, fought: true });
      roundRecord(me, round, ghost, { taken: fight.damageToA, dealt: 0, result: 'bye' });
    }

    closeRunLobbyRound(table, eliminated, hpBefore);
    record.roundsPlayed = round;
  }

  // Terminations. A lobby failure censors EVERY seat: no placement is trustworthy once a seat could not play.
  const capped = !failure && table.round > table.rules.maxRounds && table.seats.filter((s) => s.alive).length > 1;
  for (const seat of seats) {
    const st = seat.state;
    rec.onRun({
      lobbyId, seatId: st.id, heroId: st.heroId, setId: manifest.setId,
      tribes: seat.run.tribes, policyId: seat.pilot.id,
      ...(failure ? {} : { placement: st.placement }),
      ...(st.eliminatedRound !== undefined ? { eliminatedRound: st.eliminatedRound } : {}),
      termination: failure ? 'failed' : capped && st.alive ? 'capped' : 'placed',
      ...(failure ? { failure } : {}),
      runesOwned: seat.run.ownedRunes ?? [],
      finalBoard: seat.run.board.map((c) => c.cardId),
    });
  }
  if (failure) record.failure = failure;
  return record;
}
