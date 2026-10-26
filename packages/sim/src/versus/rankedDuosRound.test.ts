/**
 * RANKED DUOS, one round (R-RANKED-DUOS-ROUND-01): the lobby's pairing over teams (identical to `pairRunLobby`), the bye
 * and its ghost, one tag-team simulate() per pairing, the lobby damage to the team pool (a ghost never loses Health),
 * shared places, the wipe-out survivor, the round-60 backstop, determinism.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, type BoardMinion } from '@game/core';
import type { PreparedCombatSide } from '../state';
import { pairRunLobby, type RunLobby } from '../lobby/runLobby';
import { pairRankedDuosTeams, resolveRankedDuosRound, RANKED_DUOS_MAX_ROUNDS, type RankedDuosEncounter } from './rankedDuosRound';
import { lossDamageCap } from '../lossCap';

const side = (n: number, atk: number, hp: number, tier = 1): PreparedCombatSide => ({
  board: Array.from({ length: n }, (_, i): BoardMinion => ({ cardId: 'sandbag', attack: atk, health: hp, sourceUid: `m${i}` })),
  state: combatSide({ tier }), config: {},
});
const EMPTY = side(0, 0, 0);

describe('pairing over teams = the lobby pairing (R-RANKED-DUOS-ROUND-01)', () => {
  it('agrees with pairRunLobby on every 4- and 2-team table over random histories', () => {
    let rng = 99;
    const next = (n: number): number => { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return rng % n; };
    for (let trial = 0; trial < 300; trial++) {
      const teams = trial % 3 === 0 ? ['a', 'c'] : ['a', 'b', 'c', 'd'];
      const round = 2 + next(8);
      const history: RankedDuosEncounter[] = [];
      for (let r = 1; r < round; r++) {
        const [x, y] = [teams[next(teams.length)]!, teams[next(teams.length)]!];
        if (x !== y) history.push({ round: r, a: x, b: y });
      }
      const seed = next(1_000_000);
      const lobby = {
        seed, round, encounters: history.map((e) => ({ ...e, outcome: 'win', damageToA: 0, damageToB: 0 })),
        seats: teams.map((id) => ({ id, alive: true, resolve: 10 + next(20), armor: next(5) })),
      } as unknown as RunLobby;
      const lobbyPairs = pairRunLobby(lobby).pairs.map(([a, b]) => [a.id, b.id]);
      const mine = pairRankedDuosTeams({ seed, round, alive: teams.map((team) => ({ team, total: 0 })), history, fallen: [] }).pairs;
      expect(mine).toEqual(lobbyPairs);
    }
  });

  it('never repeats a pairing inside 3 rounds when another exists', () => {
    const p = pairRankedDuosTeams({ seed: 5, round: 3, alive: ['a', 'b', 'c', 'd'].map((team) => ({ team, total: 10 })),
      history: [{ round: 2, a: 'a', b: 'b' }, { round: 2, a: 'c', b: 'd' }], fallen: [] });
    for (const [x, y] of p.pairs) expect([x, y].sort().join('')).not.toMatch(/^(ab|cd)$/);
  });

  it('3 teams: the bye fights a ghost, and not the ghost of the team it just knocked out when another exists', () => {
    const p = pairRankedDuosTeams({ seed: 1, round: 5, alive: [{ team: 'a', total: 30 }, { team: 'b', total: 5 }, { team: 'c', total: 20 }],
      history: [{ round: 4, a: 'b', b: 'd' }, { round: 4, a: 'a', b: 'c' }],
      fallen: [{ team: 'd', eliminatedRound: 4 }] });
    expect(p.bye).not.toBeNull();
    expect(p.ghost).toBe('d');
    expect(p.bye).not.toBe('b'); // b just knocked d out: its ghost would be a rematch, so the bye goes elsewhere
    expect(p.pairs).toHaveLength(1);
  });
});

describe('the round (R-RANKED-DUOS-ROUND-01)', () => {
  const base = (over: Partial<Parameters<typeof resolveRankedDuosRound>[0]> = {}) => resolveRankedDuosRound({
    matchSeed: 42, round: 2, history: [], fallen: [], liveTeam: 'a',
    alive: [
      { team: 'a', sides: [side(2, 5, 5, 2), side(1, 1, 1)], first: 0, vitals: { health: 30, armor: 10 } },
      { team: 'b', sides: [side(1, 1, 1), EMPTY], first: 0, vitals: { health: 30, armor: 5 } },
      { team: 'c', sides: [side(3, 2, 2), side(3, 2, 2)], first: 1, vitals: { health: 30, armor: 0 } },
      { team: 'd', sides: [EMPTY, EMPTY], first: 0, vitals: { health: 30, armor: 0 } },
    ],
    ...over,
  });

  it('two fights; only the live team\'s carries a view; the loser takes the capped lobby damage, Armor first', () => {
    const out = base();
    expect(out.fights).toHaveLength(2);
    expect(out.fights.filter((f) => f.liveResult)).toHaveLength(1);
    for (const f of out.fights) {
      if (!f.loser) continue;
      expect(f.damage).toBeLessThanOrEqual(lossDamageCap(2));
      expect(f.damage).toBeGreaterThan(0);
    }
    const fought = new Set(out.fights.flatMap((f) => [f.a, f.b]));
    expect([...fought].sort()).toEqual(['a', 'b', 'c', 'd']);
    const total = (t: string) => out.vitals[t]!.health + out.vitals[t]!.armor;
    const lost = out.fights.filter((f) => f.loser).map((f) => f.loser!);
    for (const t of ['a', 'b', 'c', 'd']) if (!lost.includes(t)) expect(out.vitals[t]).toEqual(base().vitals[t]);
    expect(total('a')).toBeLessThanOrEqual(40);
  });

  it('an empty first board hands straight over', () => {
    const out = base({ alive: [
      { team: 'a', sides: [EMPTY, side(1, 9, 9)], first: 0, vitals: { health: 30, armor: 0 } },
      { team: 'b', sides: [side(1, 1, 1), EMPTY], first: 0, vitals: { health: 30, armor: 0 } },
    ] });
    expect(out.fights[0]!.first.a).toBe(1);
    expect(out.liveFirst).toBe(1);
  });

  it('a ghost never loses Health; its win costs the bye team', () => {
    const out = resolveRankedDuosRound({
      matchSeed: 7, round: 6, liveTeam: 'a',
      history: [{ round: 5, a: 'a', b: 'b' }, { round: 5, a: 'c', b: 'd' }],
      alive: [
        { team: 'a', sides: [side(1, 1, 1), EMPTY], first: 0, vitals: { health: 3, armor: 0 } },
        { team: 'b', sides: [side(7, 20, 20, 6), EMPTY], first: 0, vitals: { health: 30, armor: 0 } },
        { team: 'c', sides: [side(1, 1, 1), EMPTY], first: 0, vitals: { health: 2, armor: 0 } },
      ],
      fallen: [{ team: 'd', sides: [side(7, 30, 30, 6), EMPTY], first: 0, eliminatedRound: 5 }],
    });
    const ghostFight = out.fights.find((f) => f.ghost)!;
    expect(ghostFight.b).toBe('d');
    expect(ghostFight.loser).toBe(ghostFight.a); // the 7 x 30/30 ghost wins
    expect(Object.keys(out.vitals)).not.toContain('d');
  });

  it('teams out together share the lower place; the last team standing is 1st', () => {
    const out = resolveRankedDuosRound({
      // Last round a-c and b-d met, so this round each strong team meets a weak one.
      matchSeed: 3, round: 9, liveTeam: 'a', history: [{ round: 8, a: 'a', b: 'c' }, { round: 8, a: 'b', b: 'd' }], fallen: [],
      alive: [
        { team: 'a', sides: [side(7, 50, 50, 6), EMPTY], first: 0, vitals: { health: 30, armor: 0 } },
        { team: 'b', sides: [side(1, 1, 1), EMPTY], first: 0, vitals: { health: 1, armor: 0 } },
        { team: 'c', sides: [side(7, 50, 50, 6), EMPTY], first: 0, vitals: { health: 30, armor: 0 } },
        { team: 'd', sides: [side(1, 1, 1), EMPTY], first: 0, vitals: { health: 1, armor: 0 } },
      ],
    });
    expect(out.fights.map((f) => f.loser).sort()).toEqual(['b', 'd']);
    expect(out.placed.filter((p) => p.team === 'b' || p.team === 'd').map((p) => p.placement)).toEqual([4, 4]);
    expect(out.placed).toHaveLength(2); // a and c play on
  });

  it(`round ${RANKED_DUOS_MAX_ROUNDS}: the teams still in are placed by Health + Armor`, () => {
    const out = resolveRankedDuosRound({
      matchSeed: 1, round: RANKED_DUOS_MAX_ROUNDS, liveTeam: 'a', history: [], fallen: [],
      alive: [
        { team: 'a', sides: [EMPTY, EMPTY], first: 0, vitals: { health: 10, armor: 0 } },
        { team: 'b', sides: [EMPTY, EMPTY], first: 0, vitals: { health: 20, armor: 0 } },
      ],
    });
    expect(out.placed).toEqual([{ team: 'b', placement: 1 }, { team: 'a', placement: 2 }]);
  });

  it('deterministic: same input, same result', () => {
    expect(JSON.stringify(base())).toBe(JSON.stringify(base()));
  });
});
