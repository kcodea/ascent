import { describe, it, expect } from 'vitest';
import { CARD_INDEX, QUEST_DEFS } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import { applyRunShopBuff, applyShopRefreshQuestBuff, applyShoutsForShopBuff } from './recruit';

/**
 * SET 2 — the DEMON shop line. The Set-2 Demon manipulates the SHOP rather than eating Fodder, so all three
 * quests pay into `tavernBuyBonus` — the channel the Staff of Guel and Contract Butcher already use. The tests
 * assert the compounding and banking rules, which are the only parts that can silently be wrong: a reward that
 * pays a flat rate forever still looks correct in a shape check.
 */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const questById = (id: string) => QUEST_DEFS.find((q) => q.id === id)!;
const bonus = (s: RunState) => ({ a: s.tavernBuyBonus.atk, h: s.tavernBuyBonus.hp });

describe("Bane's Presence — every 3 Shouts buffs the shop", () => {
  it('banks Shouts across calls and pays exactly once per 3', () => {
    // A per-trigger rule would pay on every Shout; a non-banking one would never pay when Shouts arrive singly.
    const s = { ...set2(), shopBuffPerShouts: { per: 3, attack: 1, health: 1, tick: 0 } };
    applyShoutsForShopBuff(s, 2);
    expect(bonus(s), 'paid out below the threshold').toEqual({ a: 0, h: 0 });
    applyShoutsForShopBuff(s, 1);
    expect(bonus(s)).toEqual({ a: 1, h: 1 });
    applyShoutsForShopBuff(s, 6); // two more payouts
    expect(bonus(s)).toEqual({ a: 3, h: 3 });
  });

  it('does nothing when the quest is not held', () => {
    const s = set2();
    applyShoutsForShopBuff(s, 9);
    expect(bonus(s)).toEqual({ a: 0, h: 0 });
  });

  it('fires off a real Shout, on the same count the objective reads', () => {
    // Driven off `lastShoutFires` — the field the quest meter also reads — so a DOUBLED Shout advances the
    // objective and pays the reward identically instead of the two disagreeing about what "a Shout" is.
    // `lastShoutFires` is recomputed per action, so this has to play an actual Shout minion to mean anything.
    const orin = CARD_INDEX['dw_orin']!;
    const s: RunState = { ...set2(), shopBuffPerShouts: { per: 1, attack: 1, health: 1, tick: 0 }, board: [],
      hand: [{ uid: 'o', cardId: 'dw_orin', tribe: orin.tribe, attack: orin.attack, health: orin.health, keywords: [], golden: false }] };
    const next = reduce(s, { type: 'play', uid: 'o' });
    expect(next.lastShoutFires, 'no Shout was recorded — the test never exercised the hook').toBeGreaterThan(0);
    expect(next.tavernBuyBonus.atk).toBe(1);
  });
});

describe('Endless Inventory — the per-refresh buff compounds', () => {
  it('improves by +1/+1 every 5 refreshes rather than paying a flat rate', () => {
    const s = { ...set2(), shopBuffOnRefresh: { attack: 5, health: 5, step: 1, per: 5, grown: 0, tick: 0 } };
    for (let i = 0; i < 5; i++) applyShopRefreshQuestBuff(s);
    expect(bonus(s), 'the first five refreshes should each give +5/+5').toEqual({ a: 25, h: 25 });
    expect(s.shopBuffOnRefresh!.grown, 'the magnitude never stepped up').toBe(1);
    applyShopRefreshQuestBuff(s); // the 6th refresh pays the improved rate
    expect(bonus(s)).toEqual({ a: 31, h: 31 });
  });

  it('fires on a real shop roll, not only when called directly', () => {
    const s = { ...set2(), embers: 10, shopBuffOnRefresh: { attack: 5, health: 5, step: 1, per: 5, grown: 0, tick: 0 } };
    const next = reduce(s, { type: 'roll' });
    expect(next.tavernBuyBonus.atk, 'a refresh did not trigger the reward').toBe(5);
  });
});

describe('the shopStats objective', () => {
  it('counts a run-wide buy-bonus rise, not just visible offers', () => {
    // Counting only the offers on screen would make Stock the Shelves read as zero progress, since a run-wide
    // buff shows up on future offers rather than current ones.
    const s: RunState = { ...set2(), activeQuests: [{ questId: 'q_endless_inventory', progress: 0, completed: false }], shopBuffOnRefresh: { attack: 5, health: 5, step: 1, per: 5, grown: 0, tick: 0 }, embers: 10 };
    const next = reduce(s, { type: 'roll' });
    expect(next.activeQuests![0]!.progress, 'a +5/+5 shop buff should be 10 stats of progress').toBe(10);
  });
});

describe('the quest data', () => {
  it('all three are set-2 only', () => {
    for (const id of ['q_stock_the_shelves', 'q_banes_presence', 'q_endless_inventory']) {
      expect(questById(id).sets, `${id} leaks outside set 2`).toEqual(['set2']);
    }
  });

  it("Bane's Presence is repeatable, as the sheet says", () => {
    expect(questById('q_banes_presence').repeatable).toBe(true);
  });

  it('Stock the Shelves grants a Demon AND buffs the shop', () => {
    const s = set2();
    applyRunShopBuff(s, 4, 4, 'test');
    expect(bonus(s)).toEqual({ a: 4, h: 4 });
    const kinds = (questById('q_stock_the_shelves').reward as { rewards: { kind: string }[] }).rewards.map((x) => x.kind);
    expect(kinds).toEqual(['grant', 'shopBuff']);
  });
});
