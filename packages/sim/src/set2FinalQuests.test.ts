import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, QUEST_DEFS } from '@game/content';
import { createRun, type BoardCard, type RunState } from './index';
import { RUBY_ID, consumeShopMinion, mintRubies } from './recruit';

/**
 * SET 2 — the last five quests. All are run-wide RULES rather than effects stamped onto individual bodies, so
 * the tests check the rule reaches things that did not exist when the quest was taken (a Kobold summoned
 * mid-combat, a Ruby minted later), which is the property a per-body implementation would silently lose.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const questById = (id: string) => QUEST_DEFS.find((q) => q.id === id)!;
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}) =>
  simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());

describe('Motherlode — every Ruby you get casts copies on your Kobolds', () => {
  it('casts on 2 random Kobolds, at the run\'s live Ruby strength', () => {
    // Minting at base 1/1 would make a late-run Motherlode near-worthless; every other Ruby source pays
    // base + rubyBonus, so this must too.
    const carver = CARD_INDEX['k_gemheart']!;
    const mk = (uid: string): BoardCard => ({ uid, cardId: 'k_gemheart', tribe: carver.tribe, attack: carver.attack, health: carver.health, keywords: [], golden: false });
    const s: RunState = { ...set2(), motherlode: { count: 2, tribe: 'kobold' }, rubyBonus: { attack: 3, health: 3 }, board: [mk('a'), mk('b')], hand: [] };
    mintRubies(s, 1);
    const gained = s.board.reduce((n, c) => n + (c.attack - carver.attack), 0);
    expect(gained, 'two 4/4 Rubies should be 8 Attack across the board').toBe(8);
  });

  it('does nothing with no Kobolds to land on', () => {
    const s: RunState = { ...set2(), motherlode: { count: 2, tribe: 'kobold' }, board: [], hand: [] };
    mintRubies(s, 1);
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length, 'the Ruby itself should still arrive').toBe(1);
  });
});

describe('Bottomless Banquet — the first Consume each turn eats twice', () => {
  const demon = (): BoardCard => ({ uid: 'd', cardId: 'k_gemheart', tribe: 'demon', attack: 3, health: 3, keywords: [], golden: false });

  it('eats a second Shop minion once per turn, then stops', () => {
    const s: RunState = { ...set2(), consumeDoubleFirstEachTurn: true, consumeDoubleUsedThisTurn: false };
    const before = s.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby).length;
    expect(before, 'the test shop needs at least 3 minions').toBeGreaterThanOrEqual(3);
    consumeShopMinion(s, demon(), s.shop.findIndex((o) => !CARD_INDEX[o.cardId]?.spell));
    const afterFirst = s.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby).length;
    expect(before - afterFirst, 'the doubled Consume did not eat a second minion').toBe(2);
    // Second Consume this turn is single — the latch is spent.
    consumeShopMinion(s, demon(), s.shop.findIndex((o) => !CARD_INDEX[o.cardId]?.spell));
    expect(afterFirst - s.shop.filter((o) => !CARD_INDEX[o.cardId]?.spell && !CARD_INDEX[o.cardId]?.ruby).length).toBe(1);
  });

  it('advances its own meter, not the Fodder one', () => {
    const s: RunState = { ...set2() };
    consumeShopMinion(s, demon(), s.shop.findIndex((o) => !CARD_INDEX[o.cardId]?.spell));
    expect(s.shopMinionsEaten).toBe(1);
  });
});

describe('Candlelight Toll — your Kobolds have "Echo: get a Ruby"', () => {
  it('grants a Ruby when a Kobold dies, and nothing when a non-Kobold does', () => {
    const kobold = CARD_INDEX['k_gemheart']!;
    const dying = (cardId: string): BoardMinion[] => [{ cardId, attack: 0, health: 1 }];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 9 }];
    // BUG FIX 2026-08-14 (owner report: "rubies granted from Candlelight Toll don't grant the correct value"):
    // the grant moved off `playerHandGrants` (a raw 1/1 pool copy) onto `playerRubyGrants`, the MINT channel
    // that bakes in the run's live `rubyBonus` at settle. Asserting the channel is the regression guard —
    // a hand grant can never be worth the run's Ruby strength.
    // TWO, not one: the Carver's own Echo summons a Gemheart Golem, which is also a Kobold and also dies to the
    // 9/9 — so the Toll fires for both bodies. The old assertion was `toContain('ruby')`, which could not tell
    // one grant from two; pinning the count is the point of moving to a numeric channel.
    const withToll = sim(dying(kobold.id), enemy, { candlelightToll: true });
    expect(withToll.playerRubyGrants ?? 0, 'a dying Kobold minted no Ruby').toBe(2);
    expect(withToll.playerHandGrants ?? [], 'Rubies are minted, never conjured as a flat 1/1').not.toContain('ruby');
    const beast = sim(dying('pack'), enemy, { candlelightToll: true });
    expect(beast.playerRubyGrants ?? 0, 'a non-Kobold minted a Ruby').toBe(0);
  });

  it('grants nothing without the quest', () => {
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 9 }];
    const r = sim([{ cardId: 'k_gemheart', attack: 0, health: 1 }], enemy, {});
    expect(r.playerRubyGrants ?? 0).toBe(0);
    expect((r.playerHandGrants ?? []).filter((g) => g === 'ruby').length).toBe(0);
  });
});

describe('The Burning Legion — attacking Imps copy themselves, bounded', () => {
  it('stops at 3 copies rather than filling the board', () => {
    // The bound is the whole design: unbounded, the first swing turns any board into a 7-Imp wall.
    const imps: BoardMinion[] = Array.from({ length: 2 }, () => ({ cardId: 'impscrap', attack: 1, health: 20 }));
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 400 }];
    const summons = (mods: object) => sim(imps, enemy, mods).events.filter((e) => e.type === 'summon' && e.side === 'player').length;
    expect(summons({}), 'baseline should summon nothing').toBe(0);
    expect(summons({ burningLegionUses: 3 })).toBe(3);
  });
});

describe('Heart of the Mountain — Gemheart Golems charge in', () => {
  it('is wired to the Golem token, and the token exists', () => {
    expect(CARD_INDEX['gemheart-shard'], 'the Gemheart Golem token is missing').toBeDefined();
    const rewards = (questById('q_heart_of_the_mountain').reward as { rewards: { kind: string; flag?: string; grantGolden?: string[] }[] }).rewards;
    expect(rewards.some((x) => x.flag === 'gemheartCharge')).toBe(true);
    expect(rewards.some((x) => x.grantGolden?.includes('k_gemheart'))).toBe(true);
  });
});

describe('the quest data', () => {
  it('all five are set-2 only', () => {
    for (const id of ['q_candlelight_toll', 'q_motherlode', 'q_heart_of_the_mountain', 'q_burning_legion', 'q_bottomless_banquet']) {
      expect(questById(id).sets, `${id} leaks outside set 2`).toEqual(['set2']);
    }
  });
});
