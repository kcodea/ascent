import type { CombatResult } from '@game/core';
import { playerRunByKey } from './snapshotSeats';
import { settleRunLobbyRound, type LobbySeatState, type RunLobby } from './runLobby';

/**
 * THE FIGHT LEDGER (owner 2026-09-22): "we want the hall of champions to answer 'what board has been the best
 * against everything else' … we would want to know its strength start to finish though, like overall win/loss
 * across games. so a 15 round game may mean it was 12-3".
 *
 * Every real lobby resolves EVERY pairing at the table each round (`settleRunLobbyRound`), not only the
 * player's own fight, so by the time the player's run ends the lobby already holds a full record of who beat
 * whom — while the player was alive. This module turns that record into rows a server can aggregate per RUN
 * (one row per fight, both sides named by their run key), and, when the player fell before the table finished,
 * PLAYS THE REST OF THE TABLE OUT on a copy so the remaining seats' fights are recorded too (owner answer (1):
 * "Play out after elimination — yes").
 *
 * WHY A COPY, AND WHY HERE. An earlier cut played the table out inside the reducer and collided with the balance
 * instrument, which plays its own pilot's table out and reads every round as it goes (devlog
 * 2026-09-22-hall-of-champions-table-wins.md). `playOutRunLobby` therefore takes a lobby and returns a NEW,
 * finished lobby; the run state that produced it is never touched. It is deterministic: pairing and combat both
 * seed from `(lobby.seed, round)`, and every non-player driver in a real lobby is a recording (pure per round).
 *
 * KEYS. A recorded seat is keyed by the run it replays (`author|heroId|seed`, exactly as `playerRunsFrom`
 * groups the pool); the reporting player's seat by the same shape built from their own run; a generated seat
 * (`hybrid`, `bot`, `authored`) by `bot:<kind>:<heroId>` — a real key for the OPPONENT's record, never a Hall
 * candidate. A snapshot seat whose run this session's pool cannot resolve is driven by a hybrid under the same
 * `runKey` (see `driverFor`), so its fights are credited to `bot:hybrid:<hero>`, not to the recorded run whose
 * boards never played.
 *
 * WHAT IS NOT A FIGHT. A ghost fight (the odd seat against an eliminated seat's board, `bye` set) is not the
 * dead run playing — its owner is out — and a sit-out or an unfieldable pairing (`fought: false`) resolved
 * nothing. Neither is a row. A bot-versus-bot fight counts for nobody the Hall or the strength read, so it is
 * skipped too.
 */

/** One fight the table resolved, from A's side. `observed` = the reporting player was still in the lobby when
 *  it happened (false for a round the play-out resolved after their elimination). */
export interface FightRow {
  lobbySeed: number;
  round: number;
  runA: string;
  runB: string;
  outcome: 'a' | 'b' | 'draw';
  observed: boolean;
  patch: string;
}

export interface FightLedgerOptions {
  /** The reporting player's own run key (`author|heroId|seed`). */
  reporterKey: string;
  patch: string;
  /** Whether a snapshot seat's `runKey` resolves to a recording in THIS session (default: the registered pool).
   *  Injectable so tests need no pool. */
  resolves?: (runKey: string) => boolean;
}

/** The generated-seat key: `bot:<kind>:<heroId>`. */
export const botFightKey = (kind: string, heroId: string): string => `bot:${kind}:${heroId}`;
/** True for a generated seat's key — never a Hall candidate, read as a fixed 25 by the lobby strength. */
export const isBotFightKey = (key: string): boolean => key.startsWith('bot:');

/** The fight-ledger key of one seat (see the module note). */
export function seatFightKey(seat: LobbySeatState, lobby: Pick<RunLobby, 'setId'>, opts: FightLedgerOptions): string {
  if (seat.kind === 'player') return opts.reporterKey;
  if (seat.kind === 'snapshot' && seat.runKey) {
    const resolves = opts.resolves ?? ((key: string) => playerRunByKey(key, undefined, lobby.setId) !== null);
    return resolves(seat.runKey) ? seat.runKey : botFightKey('hybrid', seat.heroId);
  }
  return botFightKey(seat.kind, seat.heroId);
}

/** The seven OPPONENT keys of a lobby (every seat but the player's), for the lobby-strength read. */
export function opponentFightKeys(lobby: RunLobby, opts: FightLedgerOptions): string[] {
  return lobby.seats.filter((s) => s.kind !== 'player').map((s) => seatFightKey(s, lobby, opts));
}

/** A result nobody reads: `settleRunLobbyRound` takes the player's result, and the player's seat is dead — the
 *  pairing skips dead seats, so it is never consulted. */
const DEAD_PLAYER_RESULT: CombatResult = {
  result: 'draw', playerDamage: 0, enemyDamage: 0, playerDeaths: 0, enemyDeaths: 0, playerDeathrattles: 0, events: [], initial: { player: [], enemy: [] },
} as unknown as CombatResult;

/** A shallow copy safe to settle: `settleRunLobbyRound` mutates seats and pushes encounters in place. */
export function cloneRunLobby(lobby: RunLobby): RunLobby {
  return { ...lobby, seats: lobby.seats.map((s) => ({ ...s })), encounters: [...lobby.encounters] };
}

/**
 * Finish the table on a COPY. Returns the input unchanged (same reference) when there is nothing to play out:
 * the lobby is already finished, or the player is still alive (their fights are the reducer's to resolve).
 * Otherwise every remaining round is settled by the same rules the table used, on a clone, and the finished
 * clone is returned. The lobby handed in is never mutated.
 */
export function playOutRunLobby(lobby: RunLobby): RunLobby {
  const me = lobby.seats.find((s) => s.kind === 'player');
  if (lobby.finished || !me || me.alive) return lobby;
  let out = cloneRunLobby(lobby);
  let guard = 0;
  while (!out.finished && guard++ <= lobby.rules.maxRounds + 1) out = settleRunLobbyRound(out, DEAD_PLAYER_RESULT);
  return out;
}

/**
 * The ledger rows of a finished run's lobby: every fought, non-ghost pairing the table resolved while the player
 * was in it (observed), plus — when the player fell early — every one the play-out resolved after (not
 * observed). Pure apart from the play-out's driver reads. Returns rows in table order.
 */
export function fightRowsOf(lobby: RunLobby, opts: FightLedgerOptions): FightRow[] {
  const observedCount = lobby.encounters.length;
  const full = playOutRunLobby(lobby);
  const keyOf = new Map<string, string>();
  for (const s of full.seats) keyOf.set(s.id, seatFightKey(s, full, opts));
  const rows: FightRow[] = [];
  full.encounters.forEach((e, i) => {
    if (!e.fought || e.bye !== undefined) return;
    const runA = keyOf.get(e.a);
    const runB = keyOf.get(e.b);
    if (!runA || !runB || runA === runB) return;
    if (isBotFightKey(runA) && isBotFightKey(runB)) return;
    rows.push({
      lobbySeed: full.seed, round: e.round, runA, runB,
      outcome: e.outcome === 'win' ? 'a' : e.outcome === 'lose' ? 'b' : 'draw',
      observed: i < observedCount,
      patch: opts.patch,
    });
  });
  return rows;
}
