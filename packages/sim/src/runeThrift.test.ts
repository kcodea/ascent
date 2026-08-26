/**
 * RUNE OF THRIFT — "Shop spells that give stats cost 2 less" (owner report 2026-08-26: it wasn't working, and
 * Ales specifically weren't discounted).
 *
 * TWO defects, either of which alone made it dead:
 *   1. Every `spellCostReduction(state)` call site omitted the DEF, so `isStatSpell(undefined)` was always
 *      false — the rune could never fire, for any spell, at the buy sites or in the shown price.
 *   2. `isStatSpell` hand-listed five factory ids, silently missing every stat spell authored since.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { ALE_IDS } from '@game/core';
import { createRun, reduce, spellCostReduction, isStatSpell, type Action, type RunState } from './index';

const thrifty = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(11, 'aster'), runeThrift: true, embers: 20, ...over }) as RunState;

describe('Rune of Thrift discounts every stat spell', () => {
  it('the Ales that grant stats are recognised (the reported miss)', () => {
    const stat = ALE_IDS.map((id) => CARD_INDEX[id]!).filter((d) => isStatSpell(d));
    expect(stat.length, 'the stat-granting Ales must be discountable').toBeGreaterThan(0);
    for (const d of stat) expect(spellCostReduction(thrifty(), d), `${d.id} is discounted`).toBeGreaterThanOrEqual(2);
  });

  it('covers the whole buff family, not five hand-listed factories', () => {
    // Every spell whose cast effect is a `spellBuff*` grant must qualify — this is the part that used to rot
    // as new stat spells were authored.
    const buffFamily = Object.values(CARD_INDEX).filter(
      (c) => c.spell && c.effects.some((e) => e.on === 'cast' && e.do.startsWith('spellBuff')),
    );
    expect(buffFamily.length).toBeGreaterThan(5);
    for (const d of buffFamily) expect(isStatSpell(d), `${d.id} gives stats`).toBe(true);
  });

  it('a NON-stat spell is not discounted', () => {
    const econ = Object.values(CARD_INDEX).find((c) => c.spell && c.effects.some((e) => e.on === 'cast' && e.do === 'gainEmbers'))!;
    expect(isStatSpell(econ), `${econ.id} grants no stats`).toBe(false);
    expect(spellCostReduction(thrifty(), econ)).toBe(0);
  });

  it('the GOLD ACTUALLY CHARGED is 2 lower when buying a stat spell from the slot', () => {
    const stat = Object.values(CARD_INDEX).find((c) => c.spell && !c.token && !c.ruby && (c.cost ?? 0) >= 3 && isStatSpell(c))!;
    const run = (thrift: boolean): number => {
      let s = thrifty({ runeThrift: thrift, spell: { uid: 'sp1', cardId: stat.id } } as Partial<RunState>);
      const before = s.embers;
      s = reduce(s, { type: 'buy', uid: 'sp1' } as Action);
      expect(s.hand.some((c) => c.cardId === stat.id), 'the spell was bought').toBe(true);
      return before - s.embers;
    };
    expect(run(false) - run(true), 'Thrift saves exactly 2 Gold at the till').toBe(2);
  });
});
