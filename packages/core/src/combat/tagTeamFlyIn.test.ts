import { describe, it, expect } from 'vitest';
import {
  combatSide, makeRng, simulate,
  type BoardMinion, type CombatEvent, type CombatResult, type CombatSideState,
} from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * R-DUOS-FLYIN-01: THE TAG-TEAM FLY-IN (Versus Duos + Ranked Duos, owner ruling 2026-11-02):
 *
 *   "the team flies in and fills the 7 slots from left to right. if there's no room, there's no fly in. flying in after
 *    combat does NOT trigger start of combats or anything, but it DOES deal more dmg to opponents as the filled in slots
 *    tally up for damage"; and "If your first board fell and your teammate's board stepped in and won, NOTHING flies in".
 *
 * Proven here: the winner's unfought teammate board fills the empty slots left to right up to 7 after the last kill (a
 * `flyIn` event); its bodies add their tiers to the damage (and to the itemized breakdown); they trigger nothing and
 * never reach the winner's carry-backs; nothing flies in for a full board, a reserve that already fought, a draw, the
 * loser, or an ordinary fight; deterministic and 1:1 symmetric.
 */

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const bags = (n: number, attack: number, health: number, tag: string, cardId = 'sandbag'): BoardMinion[] =>
  Array.from({ length: n }, (_, i) => ({ cardId, attack, health, sourceUid: `${tag}${i}` }));
const ofType = <T extends CombatEvent['type']>(r: CombatResult, t: T): Extract<CombatEvent, { type: T }>[] =>
  r.events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === t);
const tierOf = (id: string): number => CARD_INDEX[id]?.tier ?? 1;

interface Team { board: BoardMinion[]; state: CombatSideState; reserve: BoardMinion[]; reserveState: CombatSideState }
const team = (board: BoardMinion[], reserve: BoardMinion[], tier = 3): Team =>
  ({ board, state: { ...combatSide(), tier }, reserve, reserveState: { ...combatSide(), tier } });

function fight(A: Team, B: Team, seed: number, swap = false): CombatResult {
  const a = clone(A);
  const b = clone(B);
  return swap
    ? simulate(b.board, a.board, makeRng(seed), CARD_INDEX, b.state, a.state, {
      firstSide: 'enemy',
      reserve: { player: { board: b.reserve, state: b.reserveState }, enemy: { board: a.reserve, state: a.reserveState } },
    })
    : simulate(a.board, b.board, makeRng(seed), CARD_INDEX, a.state, b.state, {
      reserve: { player: { board: a.reserve, state: a.reserveState }, enemy: { board: b.reserve, state: b.reserveState } },
    });
}

// A real tiered minion with an Echo (Deathrattle) and no Start of Combat: proves "trigger nothing" and the tier math.
const ECHO = Object.values(CARD_INDEX).find((d) => !d.spell && !d.token && d.tier >= 2 && d.effects.some((e) => e.on === 'onDeath')
  && !d.effects.some((e) => e.on === 'startOfCombat' || e.on === 'onSummon'))!;

describe('R-DUOS-FLYIN-01: the winner\'s unfought teammate board flies in and counts for damage', () => {
  it('fills the empty slots left to right after the last kill, and the damage sums their tiers', () => {
    const mate: BoardMinion[] = [...bags(4, 1, 1, 'm', ECHO.id), ...bags(2, 1, 1, 'x')];
    const A = team(bags(2, 30, 300, 'A'), mate, 4);
    const B = team(bags(1, 1, 1, 'B'), [], 2);
    const res = fight(A, B, 7);
    expect(res.result).toBe('win');
    const fly = ofType(res, 'flyIn');
    expect(fly).toHaveLength(1);
    const f = fly[0]!;
    expect([f.side, f.member, f.index]).toEqual(['player', 1, 2]);
    // 7 slots, 2 standing: the 5 left-most teammate bodies, in their board order.
    expect(f.minions.map((m) => m.cardId)).toEqual([ECHO.id, ECHO.id, ECHO.id, ECHO.id, 'sandbag']);
    // After the last death.
    const lastDeath = res.events.map((e) => e.type).lastIndexOf('death');
    expect(res.events.indexOf(f)).toBeGreaterThan(lastDeath);
    // The enemy takes the winner's tier + both survivors + the 5 flown in.
    expect(res.enemyDamage).toBe(4 + tierOf('sandbag') * 2 + tierOf(ECHO.id) * 4 + tierOf('sandbag'));
    expect(res.enemyDamageBreakdown!.survivorUids).toEqual([...res.enemyDamageBreakdown!.survivorUids.slice(0, 2), ...f.minions.map((m) => m.uid)]);
    expect(res.enemyDamageBreakdown!.survivorTiers.reduce((a, b) => a + b, 0) + 4).toBe(res.enemyDamage);
  });

  it('they trigger nothing and are not the winner\'s survivors (no events about them, no carry-back)', () => {
    const A = team(bags(1, 30, 300, 'A'), bags(3, 1, 1, 'm', ECHO.id));
    const B = team(bags(1, 1, 1, 'B'), []);
    const res = fight(A, B, 3);
    const f = ofType(res, 'flyIn')[0]!;
    const uids = new Set(f.minions.map((m) => m.uid));
    const at = res.events.indexOf(f);
    expect(JSON.stringify(res.events.filter((_, i) => i !== at))).not.toMatch(new RegExp([...uids].join('|')));
    expect(res.playerSurvivorCardIds).toEqual(['sandbag']);
    expect(res.tagTeam!.members.player).toHaveLength(1);
  });

  it('a full board: no fly-in', () => {
    const res = fight(team(bags(7, 30, 300, 'A'), bags(3, 1, 1, 'm')), team(bags(1, 1, 1, 'B'), []), 5);
    expect(res.result).toBe('win');
    expect(ofType(res, 'flyIn')).toHaveLength(0);
    expect(res.enemyDamage).toBe(3 + 7 * tierOf('sandbag'));
  });

  it('the teammate board already fought (first board fell, the reserve won): nothing flies in', () => {
    const A = team(bags(1, 1, 1, 'A'), bags(2, 20, 50, 'a'));
    const B = team(bags(2, 3, 6, 'B'), []);
    const res = fight(A, B, 4);
    expect(res.result).toBe('win');
    expect(ofType(res, 'tagIn')).toHaveLength(1);
    expect(ofType(res, 'flyIn')).toHaveLength(0);
  });

  it('only the winner: the loser\'s waiting teammate never flies in, and a draw flies nothing in', () => {
    const weakWithMate = team(bags(1, 1, 1, 'W'), []);
    const strong = team(bags(1, 5, 50, 'S'), bags(2, 1, 1, 's'));
    const res = fight(weakWithMate, strong, 2);
    expect(res.result).toBe('lose');
    expect(ofType(res, 'flyIn').map((e) => e.side)).toEqual(['enemy']);
    expect(res.playerDamage).toBe(3 + tierOf('sandbag') * 3);
    const both = team(bags(1, 1, 1, 'X'), bags(1, 1, 1, 'x'));
    const draw = fight(both, clone(both), 2);
    expect(draw.result).toBe('draw');
    expect(ofType(draw, 'flyIn')).toHaveLength(0);
  });

  it('an ordinary fight (no reserve) never flies anything in', () => {
    const res = simulate(bags(1, 30, 300, 'A'), bags(1, 1, 1, 'B'), makeRng(1), CARD_INDEX, combatSide(), combatSide());
    expect(ofType(res, 'flyIn')).toHaveLength(0);
  });

  it('is deterministic and 1:1 symmetric (the swapped fight flies in the mirror)', () => {
    const A = team(bags(2, 30, 300, 'A'), bags(4, 1, 1, 'm', ECHO.id), 4);
    const B = team(bags(1, 1, 1, 'B'), bags(1, 1, 1, 'b'), 2);
    expect(JSON.stringify(fight(A, B, 9))).toBe(JSON.stringify(fight(A, B, 9)));
    const r1 = fight(A, B, 9);
    const r2 = fight(A, B, 9, true);
    expect(r2.result).toBe('lose');
    expect(r2.playerDamage).toBe(r1.enemyDamage);
    const f1 = ofType(r1, 'flyIn')[0]!;
    const f2 = ofType(r2, 'flyIn')[0]!;
    expect(f2.side).toBe('enemy');
    expect([f2.index, f2.minions.map((m) => [m.cardId, m.attack, m.health])]).toEqual([f1.index, f1.minions.map((m) => [m.cardId, m.attack, m.health])]);
  });
});
