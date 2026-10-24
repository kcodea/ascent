import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type Keyword } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * R-ORD-RISE-ECHO-01 (owner ruling 2026-10-23, bug fba394b7): a Rise / Rebirth minion that dies on its OWN swing
 * and whose Echo fills its slot hands the next turn to the slot's NEW occupants first. "in the dawnclaw case, yeah
 * the dawnclaw would attack next, then the bullseye etc." The Echo tokens attack next in left-to-right order (as
 * they would without Rise), then the returned body, then the rest of the rotation. Symmetric: both sides.
 *
 * The fixture is the report's shape, minimized: a Rise Bullseye (Echo: a random Beast set to 7/7) swings into a
 * Taunt wall, dies to retaliation, its Echo summons into its slot and it Rises to the right. Before the fix the
 * risen Bullseye swung next and the order carried on to its right, so the summoned Beast was skipped.
 */
const wall = (attack: number, health: number, keywords: Keyword[] = ['T']): BoardMinion =>
  ({ cardId: 'sandbag', attack, health, keywords } as unknown as BoardMinion);
const card = (cardId: string, attack: number, health: number, keywords: Keyword[]): BoardMinion =>
  ({ cardId, attack, health, keywords } as unknown as BoardMinion);

type Side = 'player' | 'enemy';
/** One side's swings in order (normal rotation and immediate strikes alike), by uid. */
const swingsOf = (r: ReturnType<typeof simulate>, side: Side): string[] => {
  const mine = new Set<string>(r.initial[side].map((m) => m.uid));
  for (const e of r.events) {
    if (e.type === 'summon' && (e as { side?: Side }).side === side) mine.add((e as { minion: { uid: string } }).minion.uid);
  }
  return r.events.filter((e): e is Extract<CombatEvent, { type: 'attack' }> => e.type === 'attack' && mine.has(e.attacker)).map((e) => e.attacker);
};
const summonedBy = (r: ReturnType<typeof simulate>, side: Side): string[] =>
  r.events.filter((e) => e.type === 'summon' && (e as { side?: Side }).side === side).map((e) => (e as { minion: { uid: string } }).minion.uid);

/** Run with the rising side as `side` (the other side is the mirror), seed fixed. */
const fight = (side: Side, rising: BoardMinion[], other: BoardMinion[], seed = 7) => {
  const p = side === 'player' ? rising : other;
  const e = side === 'player' ? other : rising;
  return simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast', 'neutral'] }), combatSide({ tier: 6, tribes: ['beast', 'neutral'] }));
};

describe('R-ORD-RISE-ECHO-01 — Echo tokens in a Rising attacker\'s slot attack before the risen body', () => {
  for (const side of ['enemy', 'player'] as const) {
    it(`bug fba394b7 shape (${side} side): the Bullseye's Echo Beast swings next, then the risen Bullseye`, () => {
      const r = fight(side,
        [card('b2_bullseye', 4, 3, ['R']), wall(0, 500)],
        [wall(5, 500)]);
      const bullseye = r.initial[side][0]!.uid;
      expect(r.events.some((e) => e.type === 'reborn' && e.target === bullseye), 'Bullseye Rose').toBe(true);
      const [token] = summonedBy(r, side);
      expect(token, 'its Echo summoned a Beast into the slot').toBeDefined();
      // Bullseye, then its Echo Beast, then the risen Bullseye.
      expect(swingsOf(r, side).slice(0, 3)).toEqual([bullseye, token, bullseye]);
    });

    it(`several Echo tokens (${side} side): each token swings in order, then the risen body`, () => {
      // Mama Pup with Rise: Echo summons two 1/1 Pups into its slot, then it Rises to their right.
      const r = fight(side,
        [card('pack', 3, 2, ['R']), wall(0, 500)],
        [wall(5, 500)]);
      const mama = r.initial[side][0]!.uid;
      const pups = summonedBy(r, side).slice(0, 2); // (the risen Mama's second death summons two more later)
      expect(pups).toHaveLength(2);
      const swings = swingsOf(r, side).slice(0, 4);
      expect(swings[0]).toBe(mama);
      expect([...swings.slice(1, 3)].sort(), 'both Pups swing next (board order)').toEqual([...pups].sort());
      expect(swings[3], 'then the risen Mama').toBe(mama);
    });
  }

  it('Rebirth takes the same order as Rise (Echo tokens first, then the returned body)', () => {
    const order = (kw: Keyword) => {
      const r = fight('enemy', [card('pack', 3, 2, [kw]), wall(0, 500)], [wall(5, 500)]);
      const mama = r.initial.enemy[0]!.uid;
      const pups = summonedBy(r, 'enemy');
      return swingsOf(r, 'enemy').slice(0, 4).map((u) => (u === mama ? 'mama' : pups.includes(u) ? 'pup' : u));
    };
    expect(order('RB')).toEqual(['mama', 'pup', 'pup', 'mama']);
    expect(order('RB')).toEqual(order('R'));
  });

  it('after the tokens and the risen body, the rotation carries on to its right (the minion on its right waits)', () => {
    const r = fight('enemy', [card('pack', 3, 2, ['R']), wall(1, 500)], [wall(5, 500)]);
    const mama = r.initial.enemy[0]!.uid;
    const tail = r.initial.enemy[1]!.uid;
    const pups = summonedBy(r, 'enemy');
    const label = (u: string) => (u === mama ? 'mama' : u === tail ? 'tail' : pups.includes(u) ? 'pup' : u);
    // Mama swings and Rises (two Pups first), the risen Mama dies for good on its swing (its second Echo's two
    // Pups land in its slot after the body and so swing next, as any Echo does), and only then the minion to its right.
    expect(swingsOf(r, 'enemy').slice(0, 7).map(label)).toEqual(['mama', 'pup', 'pup', 'mama', 'pup', 'pup', 'tail']);
  });
});
