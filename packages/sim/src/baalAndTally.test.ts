import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { ALE_IDS } from '@game/core';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { consumeShopMinion, offerBuyStats } from './recruit';

/** Owner batch 2026-08-03: Baal + Rune of Baal, and the rune meter's `sourceId` stamp. */

const baal = (uid: string): BoardCard =>
  ({ uid, cardId: 'dw_baal', tribe: 'dwarf', attack: 8, health: 7, keywords: [], golden: false });

describe('Baal', () => {
  it('is a forge-only Dwarf/Demon 8/7 at Tier 6', () => {
    const def = CARD_INDEX['dw_baal']!;
    expect(def).toBeDefined();
    expect([def.tribe, def.tribe2]).toEqual(['dwarf', 'demon']);
    expect([def.tier, def.attack, def.health]).toEqual([6, 8, 7]);
    expect(def.token, 'forge-only — must never be drawable from a shop').toBe(true);
  });

  it('Rune of Baal is an Epic costing 6 that grants exactly Baal', () => {
    const rune = RUNE_INDEX['rune_baal']!;
    expect(rune).toBeDefined();
    expect(rune.cost).toBe(6);
    expect(rune.epic).toBe(true);
    expect(rune.sets).toEqual(['set2']);
    expect(rune.reward).toMatchObject({ kind: 'grant', cards: ['dw_baal'] });
  });

  it('a consume buffs Shop minions and grants an Ale', () => {
    const s: RunState = { ...createRun(1), board: [baal('b')], hand: [], embers: 30 };
    const idx = s.shop.findIndex((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
    expect(idx, 'the fixture needs a minion offer to eat').toBeGreaterThanOrEqual(0);
    const survivor = s.shop.find((o, i) => i !== idx && !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby);
    const before = survivor ? offerBuyStats(s, survivor) : null;

    consumeShopMinion(s, s.board[0]!, idx);

    expect(s.shopTurnBonus).toEqual({ atk: 2, hp: 2 });
    if (survivor && before) {
      const after = offerBuyStats(s, survivor);
      expect([after.attack - before.attack, after.health - before.health]).toEqual([2, 2]);
    }
    expect(s.hand.some((c) => ALE_IDS.includes(c.cardId)), 'the Ale half must fire too').toBe(true);
  });

  it('the buff SURVIVES a reroll and accumulates — it lasts the whole shop phase', () => {
    // The owner's exact case (2026-08-03): consume two minions, then roll. The freshly-rolled offers must
    // still carry +4/+4 — which a per-offer stamp could never do, since a roll mints brand-new offers.
    let s: RunState = { ...createRun(1), board: [baal('b')], hand: [], embers: 60 };
    const eat = (): void => {
      const i = s.shop.findIndex((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
      if (i >= 0) consumeShopMinion(s, s.board[0]!, i);
    };
    eat();
    eat();
    expect(s.shopTurnBonus, 'two consumes stack').toEqual({ atk: 4, hp: 4 });

    s = reduce(s, { type: 'roll' });
    const fresh = s.shop.find((o) => !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby);
    expect(fresh, 'the roll should mint minion offers').toBeTruthy();
    const def = CARD_INDEX[fresh!.cardId]!;
    const stats = offerBuyStats(s, fresh!);
    expect([stats.attack - def.attack, stats.health - def.health], 'a rerolled offer keeps the buff')
      .toEqual([4, 4]);
  });

  it('does NOT touch the run-wide tavern bonus, and expires with the turn', () => {
    const s: RunState = { ...createRun(1), board: [baal('b')], hand: [], embers: 30 };
    const before = { ...s.tavernBuyBonus };
    const idx = s.shop.findIndex((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; });
    consumeShopMinion(s, s.board[0]!, idx);
    // The run-wide channel would leak onto EVERY future shop — Baal must stay turn-scoped.
    expect(s.tavernBuyBonus).toEqual(before);

    const after = reduce({ ...s, phase: 'combat', combatSettled: false, lastCombat: { result: 'win', events: [], playerDamage: 0, initial: { player: [], enemy: [] } } as never }, { type: 'resolveCombat' });
    expect(after.shopTurnBonus, 'the buff must not survive into the next shop').toBeFalsy();
  });

});

describe('rune meters know which rune armed them', () => {
  it('a threshold rune stamps its own id, so the HUD can show that badge a tally', () => {
    let s: RunState = { ...createRun(1), embers: 50 };
    s = { ...s, runeforgeOffer: ['rune_gemspam'], runeforgeEpic: true };
    s = reduce(s, { type: 'buyRune', index: 0 });
    const meter = s.runeThresholds?.find((t) => t.sourceId === 'rune_gemspam');
    expect(meter, 'the meter must record which rune armed it').toBeTruthy();
    expect(meter!.per).toBe(10);
    expect(meter!.tick).toBe(0);
  });
});
