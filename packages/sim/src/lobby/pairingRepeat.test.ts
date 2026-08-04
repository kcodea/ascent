import { describe, it, expect } from 'vitest';
import { pairRunLobby, NO_REPEAT_ROUNDS, type RunLobby, type LobbySeatState } from './runLobby';
import { DEFAULT_LOBBY_RULES } from './lobby';

/**
 * The no-repeat rule must hold at ODD tables — the bye is part of the pairing, not a step before it.
 *
 * Owner report 2026-07-31 (Mike's game): three players alive, and he fought the SAME seat two rounds in a row.
 * At 3 alive that should be impossible — the third seat or the ghost is always an alternative. The hole: the
 * bye used to be decided first, purely by fewest-byes with an id tiebreak, and only then were the remaining
 * (even) seats searched. At 3 alive the bye fully determines the pairing, so once bye counts evened out the id
 * tiebreak could bye the same seat twice running — forcing the other two into a back-to-back rematch that the
 * 1e6 no-repeat penalty never got to veto, because the search never saw the alternative.
 *
 * These tests drive the pairing round by round the way `settleRunLobbyRound` does (recording pair encounters
 * and bye encounters, which the meeting tally rightly skips) and assert the rule the owner stated.
 */

const seat = (id: string): LobbySeatState => ({
  id, label: id, heroId: 'warden', kind: 'bot', seed: 1, resolve: 30, armor: 0, alive: true,
});

const lobbyOf = (seats: LobbySeatState[], seed = 9): RunLobby => ({
  version: 1, seed, round: 1, seats, encounters: [], finished: false,
  rules: { ...DEFAULT_LOBBY_RULES },
});

/** One pairing round: record encounters exactly the way settle does, then advance the round counter. */
const playRound = (lobby: RunLobby): { pairs: [string, string][]; bye: string | null } => {
  const { pairs, bye } = pairRunLobby(lobby);
  for (const [a, b] of pairs) {
    lobby.encounters.push({ round: lobby.round, a: a.id, b: b.id, outcome: 'draw', damageToA: 0, damageToB: 0, fought: true });
  }
  if (bye) {
    // A bye fights the ghost; the encounter carries `bye`, which the meeting tally skips.
    lobby.encounters.push({ round: lobby.round, a: bye.id, b: 'ghost', outcome: 'draw', damageToA: 0, damageToB: 0, bye: bye.id, fought: true });
  }
  lobby.round++;
  return { pairs: pairs.map(([a, b]) => [a.id, b.id] as [string, string]), bye: bye?.id ?? null };
};

describe('no back-to-back rematches at a 3-alive table', () => {
  it('never pairs the same two seats in consecutive rounds, across many seeds and rounds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const lobby = lobbyOf([seat('s0'), seat('s3'), seat('s5')], seed);
      let prevPair: string | null = null;
      for (let r = 0; r < 12; r++) {
        const { pairs } = playRound(lobby);
        expect(pairs.length).toBe(1);
        const key = pairs[0]!.slice().sort().join('|');
        expect(key, `seed ${seed}, round ${lobby.round - 1}: back-to-back rematch`).not.toBe(prevPair);
        prevPair = key;
      }
    }
  });

  it('the engineered failure shape: skewed bye counts must not re-bye the freshest seat', () => {
    // The shape a shrinking table produces: while 4+ were alive, s0 and s3 each collected a bye (an odd table
    // earlier in the lobby); s5 never has. s7 dies in round 3, right after s0|s3 fought. Round 4 opens at 3
    // alive with bye counts s0:1, s3:1, s5:0 — the old bye-first rule picks s5 (strictly fewest) and forces
    // the ONLY remaining pairing, an immediate s0|s3 rematch, without the no-repeat cost ever seeing it.
    const dead = { ...seat('s7'), alive: false, eliminatedRound: 3 };
    const lobby = lobbyOf([seat('s0'), seat('s3'), seat('s5'), dead]);
    lobby.round = 4;
    lobby.encounters.push(
      { round: 1, a: 's0', b: 'ghost', outcome: 'draw', damageToA: 0, damageToB: 0, bye: 's0', fought: true },
      { round: 1, a: 's3', b: 's5', outcome: 'draw', damageToA: 0, damageToB: 0, fought: true },
      { round: 2, a: 's3', b: 'ghost', outcome: 'draw', damageToA: 0, damageToB: 0, bye: 's3', fought: true },
      { round: 2, a: 's0', b: 's5', outcome: 'draw', damageToA: 0, damageToB: 0, fought: true },
      { round: 3, a: 's0', b: 's3', outcome: 'draw', damageToA: 0, damageToB: 0, fought: true },
      { round: 3, a: 's5', b: 's7', outcome: 'win', damageToA: 0, damageToB: 9, fought: true },
    );
    const { pairs } = pairRunLobby(lobby);
    // s0|s3 fought in round 3 — round 4 must not repeat them. Byeing s0 or s3 gives a fresh pairing.
    expect(pairs.length).toBe(1);
    const key = pairs[0]!.map((s) => s.id).sort().join('|');
    expect(key, 'the round-3 pair was repeated in round 4').not.toBe('s0|s3');
  });

  it('…and the rotation stays violation-free from that skewed start onward', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const dead = { ...seat('s7'), alive: false, eliminatedRound: 3 };
      const lobby = lobbyOf([seat('s0'), seat('s3'), seat('s5'), dead], seed);
      lobby.round = 4;
      lobby.encounters.push(
        { round: 1, a: 's0', b: 'ghost', outcome: 'draw', damageToA: 0, damageToB: 0, bye: 's0', fought: true },
        { round: 2, a: 's3', b: 'ghost', outcome: 'draw', damageToA: 0, damageToB: 0, bye: 's3', fought: true },
        { round: 3, a: 's0', b: 's3', outcome: 'draw', damageToA: 0, damageToB: 0, fought: true },
      );
      let prevPair = ['s0', 's3'].join('|');
      for (let r = 0; r < 10; r++) {
        const { pairs } = playRound(lobby);
        const key = pairs[0]!.slice().sort().join('|');
        expect(key, `seed ${seed}, round ${lobby.round - 1}: back-to-back rematch`).not.toBe(prevPair);
        prevPair = key;
      }
    }
  });

  it('the recency window still yields when there is genuinely no alternative (final 2)', () => {
    const lobby = lobbyOf([seat('s0'), seat('s3')]);
    for (let r = 0; r < NO_REPEAT_ROUNDS + 2; r++) {
      const { pairs, bye } = playRound(lobby);
      expect(pairs.length, 'a final 2 must always fight').toBe(1);
      expect(bye).toBeNull();
    }
  });
});
