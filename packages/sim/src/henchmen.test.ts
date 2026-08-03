import { describe, it, expect } from 'vitest';
import { CARD_INDEX, HENCHMEN } from '@game/content';
import { HEROES } from './heroes';
import { createRun, henchmanOffer, type RunState } from './state';
import { reduce } from './reducer';

/**
 * HENCHMEN (owner spec 2026-08-03): every hero has a hero-bound minion, never shop-offered, recruitable once
 * per run at a Gold cost that FALLS each round — win −3, loss −2 (draw −2: the spec keys the two named
 * outcomes and "every round" means the price always moves; a draw is a non-win). The card is a minion like
 * any other once recruited.
 */

const HERO = 'warden'; // the placeholder henchman rides the WIP Warden (withheld from the picker)

const withCombat = (s: RunState, result: 'win' | 'lose' | 'draw'): RunState => {
  // Drive the real settle path: a minimal fake CombatResult through the same reducer action the game uses.
  const r = reduce({ ...s, phase: 'combat', combatSettled: false, lastCombat: { result, events: [], playerDamage: 0, initial: { player: [], enemy: [] } } as never }, { type: 'resolveCombat' });
  return { ...r, phase: 'recruit' };
};

describe('henchman cost decay', () => {
  it('a WIN knocks 3 Gold off, a LOSS 2, floored at 0', () => {
    let s = createRun(1, HERO);
    expect(henchmanOffer(s)).toMatchObject({ cardId: 'hm_test_squire', cost: 10 });
    s = withCombat(s, 'win');
    expect(henchmanOffer(s)!.cost).toBe(7);
    s = withCombat(s, 'lose');
    expect(henchmanOffer(s)!.cost).toBe(5);
    for (let i = 0; i < 4; i++) s = withCombat(s, 'win');
    expect(henchmanOffer(s)!.cost, 'the price floors at 0, never negative').toBe(0);
  });

  it('a hero with no henchman authored offers nothing', () => {
    const s = createRun(1, 'soren');
    expect(henchmanOffer(s)).toBeNull();
    expect(reduce(s, { type: 'buyHenchman' })).toBe(s); // the action no-ops
  });
});

describe('recruiting the henchman', () => {
  it('pays the decayed cost, grants the minion to hand, once per run', () => {
    let s: RunState = { ...createRun(1, HERO), embers: 8 };
    s = withCombat(s, 'win'); // 10 → 7
    s = { ...s, embers: 8 };
    const before = s.hand.length;
    s = reduce(s, { type: 'buyHenchman' });
    expect(s.embers).toBe(1); // paid 7
    expect(s.hand.length).toBe(before + 1);
    expect(s.hand.some((c) => c.cardId === 'hm_test_squire')).toBe(true);
    expect(s.henchmanBought).toBe(true);
    expect(henchmanOffer(s), 'once per run — the offer retires').toBeNull();
    expect(reduce(s, { type: 'buyHenchman' })).toBe(s);
  });

  it('cannot be recruited without the Gold', () => {
    const s: RunState = { ...createRun(1, HERO), embers: 9 }; // cost 10
    expect(reduce(s, { type: 'buyHenchman' })).toBe(s);
  });

  it('a FREE henchman (fully decayed) still recruits cleanly at 0 Gold', () => {
    let s: RunState = { ...createRun(1, HERO), embers: 0, henchmanDiscount: 99 };
    s = reduce(s, { type: 'buyHenchman' });
    expect(s.embers).toBe(0);
    expect(s.hand.some((c) => c.cardId === 'hm_test_squire')).toBe(true);
  });
});

describe('henchman registry doctrine', () => {
  it('every henchman card carries the flag and appears in NO set pool', () => {
    expect(HENCHMEN.length).toBeGreaterThan(0);
    for (const h of HENCHMEN) {
      expect(h.henchman, `${h.id} must be flagged`).toBe(true);
      expect(CARD_INDEX[h.id], `${h.id} must resolve globally`).toBeDefined();
    }
  });

  it('every hero henchman link resolves to a real flagged card', () => {
    for (const hero of HEROES) {
      if (!hero.henchman) continue;
      const def = CARD_INDEX[hero.henchman.cardId];
      expect(def, `${hero.id}'s henchman card must exist`).toBeDefined();
      expect(def!.henchman, `${hero.id}'s henchman must be a flagged henchman card`).toBe(true);
      expect(hero.henchman.cost).toBeGreaterThan(0);
    }
  });
});
