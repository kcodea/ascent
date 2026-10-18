import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';

/**
 * R-IMMUNE-SHIELD-01 (owner 2026-10-18): *"make an immune while attacking effect. this would apply to iggy and bounty
 * bot as an example. they should gain a blue/gold shield when they wind up to attack that dissipates when they
 * settle"*.
 *
 * The presentation keys the shield off the engine's `attack.immune` flag, so the flag must be exactly the truth the
 * clash acts on: set on every swing the immunity covers (and that swing takes no retaliation), absent once the
 * "Twice per combat" charges are spent, on BOTH sides (R-SYMMETRY-01). The FX half is pinned in
 * `packages/ui/src/choreo/immuneShield.test.ts`.
 */

const m = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health, keywords: [...CARD_INDEX[cardId]!.keywords], ...over } as unknown as BoardMinion);
const POOL = poolFor('set3').all.map((c) => c.id);
const fight = (p: BoardMinion[], e: BoardMinion[], seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, poolIds: POOL }), combatSide({ tier: 6, poolIds: POOL }));
const wall = (attack = 1): BoardMinion[] => [{ cardId: 'sandbag', attack, health: 5000, keywords: [] } as unknown as BoardMinion];

/** Each swing `uid` takes, in order: was it flagged immune, and did it take retaliation (a `dmg` on itself)? */
function swingsOf(events: CombatEvent[], uid: string): { immune: boolean; hurt: boolean }[] {
  const out: { immune: boolean; hurt: boolean }[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type !== 'attack' || e.attacker !== uid) continue;
    let hurt = false;
    for (let j = i + 1; j < events.length && events[j]!.type !== 'attack'; j++) {
      const d = events[j]!;
      if (d.type === 'dmg' && d.target === uid) hurt = true;
    }
    out.push({ immune: e.immune === true, hurt });
  }
  return out;
}

describe('R-IMMUNE-SHIELD-01: the engine flags every swing its "immune while attacking" covers', () => {
  it('Immune Iggy: swings 1-2 flagged + unhurt, swing 3+ unflagged + hurt; Gilded: 4', () => {
    for (const [golden, cap] of [[false, 2], [true, 4]] as const) {
      const r = fight([m('d3_iggy', { health: 100, golden })], wall(1));
      const s = swingsOf(r.events, r.initial.player[0]!.uid);
      expect(s.length, `golden=${golden}`).toBeGreaterThan(cap);
      s.forEach((sw, i) => {
        expect(sw.immune, `golden=${golden} swing ${i + 1}`).toBe(i < cap);
        expect(sw.hurt, `golden=${golden} swing ${i + 1}`).toBe(i >= cap);
      });
    }
  });

  it('Bounty Bot: the first 2 attacks each combat are flagged, then never again', () => {
    const r = fight([m('bountybot', { health: 100 })], wall(1));
    const s = swingsOf(r.events, r.initial.player[0]!.uid);
    expect(s.slice(0, 2).every((x) => x.immune && !x.hurt)).toBe(true);
    expect(s.slice(2).length).toBeGreaterThan(0);
    expect(s.slice(2).some((x) => x.immune)).toBe(false);
  });

  it('Mauron ("Immune while attacking", always on) is flagged on every swing', () => {
    const r = fight([m('mauron', { health: 100 })], wall(1));
    const s = swingsOf(r.events, r.initial.player[0]!.uid);
    expect(s.length).toBeGreaterThan(3);
    expect(s.every((x) => x.immune && !x.hurt)).toBe(true);
  });

  it('works on the ENEMY side identically (combat sides are symmetric)', () => {
    const r = fight(wall(1), [m('d3_iggy', { health: 100 })]);
    const s = swingsOf(r.events, r.initial.enemy[0]!.uid);
    expect(s.length).toBeGreaterThan(2);
    expect(s.map((x) => x.immune).slice(0, 3)).toEqual([true, true, false]);
  });

  it('an ordinary attacker never carries the flag', () => {
    const r = fight([m('sandbag', { attack: 3, health: 100 } as Partial<BoardMinion>)], wall(1));
    expect(r.events.some((e) => e.type === 'attack' && e.immune)).toBe(false);
  });
});
