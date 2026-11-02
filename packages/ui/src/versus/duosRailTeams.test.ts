/**
 * THE DUOS RAIL'S TEAM READS (owner 2026-11-01; R-DUOS-RAIL-TEAM-02): the fight log names the TEAM a seat's team fought
 * (both members), read from either teammate, one row a round, with the team's damage; the placement column is per team.
 */
import { describe, expect, it } from 'vitest';
import { duosTeamPlaces, duosTeamResults } from './duosRailTeams';

const seats = [
  { id: 's0', heroId: 'auctioneer', label: 'Ann' },
  { id: 's1', heroId: 'rayse', label: 'Bob' },
  { id: 's2', heroId: 'soren', label: 'Soren' },
  { id: 's3', heroId: 'midas', label: 'Midas' },
];
const enc = (round: number, a: string, b: string, outcome: 'win' | 'lose' | 'draw', damageToA = 0, damageToB = 0) =>
  ({ round, a, b, outcome, fought: true, damageToA, damageToB });

describe('duosTeamResults', () => {
  // Round 1: Ann went first vs Soren and won (4 to them). Round 2: Bob went first vs Midas and lost (6 to us).
  const lobby = { seats, encounters: [enc(1, 's0', 's2', 'win', 0, 4), enc(2, 's1', 's3', 'lose', 6, 0)] };

  it('names both members of the team fought, newest first, for either teammate', () => {
    for (const id of ['s0', 's1']) {
      const r = duosTeamResults(lobby, id);
      expect(r.map((x) => x.round)).toEqual([2, 1]);
      expect(r.map((x) => x.foeLabel)).toEqual(['Soren + Midas', 'Soren + Midas']);
      expect(r[0]!.foes.map((f) => f.heroId)).toEqual(['soren', 'midas']);
      expect(r.map((x) => [x.outcome, x.dealt, x.taken])).toEqual([['lose', 0, 6], ['win', 4, 0]]);
    }
  });

  it('reads the other side inverted, naming the first team', () => {
    const r = duosTeamResults(lobby, 's3');
    expect(r.map((x) => x.foeLabel)).toEqual(['Ann + Bob', 'Ann + Bob']);
    expect(r.map((x) => [x.outcome, x.dealt, x.taken])).toEqual([['win', 6, 0], ['lose', 0, 4]]);
  });

  it('Ranked Duos: only the seat team\'s fight each round, never another pairing\'s', () => {
    const ranked = {
      seats: [...seats, { id: 's4', heroId: 'h4', label: 'Cy' }, { id: 's5', heroId: 'h5', label: 'Di' }, { id: 's6', heroId: 'h6', label: 'Ed' }, { id: 's7', heroId: 'h7', label: 'Fo' }],
      encounters: [enc(1, 's0', 's4', 'draw'), enc(1, 's2', 's6', 'win', 0, 3)],
    };
    expect(duosTeamResults(ranked, 's1').map((x) => x.foeLabel)).toEqual(['Cy + Di']);
    expect(duosTeamResults(ranked, 's7').map((x) => [x.foeLabel, x.outcome, x.taken])).toEqual([['Soren + Midas', 'lose', 3]]);
  });
});

describe('duosTeamPlaces', () => {
  it('one place per team, in the rail\'s team order', () => {
    const places = duosTeamPlaces([{ id: 's2' }, { id: 's3' }, { id: 's0' }, { id: 's1' }, { id: 's6' }, { id: 's7' }, { id: 's4' }, { id: 's5' }]);
    expect([...places.entries()]).toEqual([[1, 1], [0, 2], [3, 3], [2, 4]]);
  });
});
