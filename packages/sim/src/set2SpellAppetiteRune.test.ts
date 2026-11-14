import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNES, EPIC_RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState, type ShopCard } from './index';
import { mintRubies, offerBuyStats } from './recruit';
import { runeTally } from '../../ui/src/runeTally';

/**
 * SPELL APPETITE (Set 2 EPIC Demon rune, owner design 2026-11-14), rule R-SET2-RUNE-SPELLAPPETITE-01:
 * "When you cast a spell, a random friendly Demon consumes a minion in the Shop." Gold for Grub's bite (`demonConsumeShop`)
 * on the every-spell `anySpell` meter at `per: 1`.
 */

const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
function run(seed = 13, tier = 3): RunState {
  return {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
}
const take = (s: RunState, id: string): RunState =>
  ({ ...act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 }), embers: 60, discover: undefined, discoverQueue: undefined });
function withRunes(ids: string[], over: Partial<RunState> = {}, seed = 13): RunState {
  const s = ids.reduce(take, run(seed));
  return { ...s, runeThresholds: (s.runeThresholds ?? []).map((t) => ({ ...t, tick: 0 })), runeProcs: {}, shopEaten: [], ...over };
}
const isMinion = (o: ShopCard): boolean => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby; };
const minions = (s: RunState) => s.shop.filter(isMinion);
const DEMONS = () => [body('k1', 'dm_knocked'), body('x', 'dw_brakka'), body('k2', 'dm_leech')];
const consumeGain = (c: BoardCard | undefined): [number, number] =>
  (c?.buffs ?? []).filter((b) => b.source === 'Consume').reduce<[number, number]>((t, b) => [t[0] + b.attack, t[1] + b.health], [0, 0]);
const ALE = 'wo_mine'; // an untargeted Ale (Gain 2 Gold)
const spell = (uid: string) => body(uid, ALE);
const play = (s: RunState, uid: string, targetUid?: string): RunState => act(s, { type: 'play', uid, ...(targetUid ? { targetUid } : {}) });

describe('Spell Appetite as content', () => {
  it('Epic, Demon, 3 Gold, Set 2 only, the owner text, Gold for Grub\'s bite on every spell', () => {
    const r = RUNE_INDEX['rune_spell_appetite']!;
    expect(EPIC_RUNES.includes(r)).toBe(true);
    expect(RUNES.includes(r)).toBe(false);
    expect([r.name, r.cost, !!r.epic, r.tribes, r.sets]).toEqual(['Spell Appetite', 3, true, ['demon'], ['set2']]);
    expect(r.text).toBe('When you cast a spell, a random friendly **Demon** consumes a minion in the Shop.');
    expect(r.reward).toEqual({ kind: 'runeThreshold', meter: 'anySpell', per: 1, demonConsumeShop: 1 });
  });
});

describe('Spell Appetite: every spell cast is a bite', () => {
  it('each spell cast from hand: a friendly Demon eats one Shop minion, gaining its Shop stats, and the rune fires', () => {
    let s = withRunes(['rune_spell_appetite'], { board: DEMONS(), hand: [spell('a1'), spell('a2')] });
    const statsByUid = new Map(s.shop.map((o) => [o.uid, offerBuyStats(s, o)]));
    const before = minions(s).length;
    s = play(s, 'a1');
    expect(s.shopEaten).toHaveLength(1);
    const ev = s.shopEaten![0]!;
    expect(['k1', 'k2']).toContain(ev.eaterUid);
    const meal = statsByUid.get(ev.uid)!;
    expect(consumeGain(s.board.find((c) => c.uid === ev.eaterUid))).toEqual([meal.attack, meal.health]);
    expect(consumeGain(s.board.find((c) => c.uid === 'x')), 'the Dwarf never eats').toEqual([0, 0]);
    expect(minions(s).length).toBe(before - 1);
    expect(s.runeProcs?.rune_spell_appetite).toBe(1);
    s = { ...s, shopEaten: [] };
    s = play(s, 'a2');
    expect(s.shopEaten).toHaveLength(1);
    expect(s.runeProcs?.rune_spell_appetite).toBe(2);
  });

  it('a Ruby is a spell: casting one bites too', () => {
    let s = withRunes(['rune_spell_appetite'], { board: DEMONS() });
    mintRubies(s, 1);
    const ruby = s.hand.find((c) => CARD_INDEX[c.cardId]?.ruby)!;
    s = play(s, ruby.uid, 'k1');
    expect(s.shopEaten).toHaveLength(1);
    expect(s.runeProcs?.rune_spell_appetite).toBe(1);
  });

  it('a multiplied cast (Edward Keg-hands doubles an Ale) bites once per cast', () => {
    let s = withRunes(['rune_spell_appetite'], { board: [...DEMONS(), body('e', 'dw_edward')], hand: [spell('a1')] });
    s = play(s, 'a1');
    expect(s.shopEaten).toHaveLength(2);
  });

  it('no badge: an every-cast rune has no meter to show', () => {
    const s = withRunes(['rune_spell_appetite'], { board: DEMONS() });
    expect(runeTally(s, 'rune_spell_appetite')).toBeNull();
  });

  it('no Demon on the board: nothing is eaten and the rune does not fire', () => {
    let s = withRunes(['rune_spell_appetite'], { board: [body('x', 'dw_brakka')], hand: [spell('a1')] });
    const row = s.shop.map((o) => o.uid);
    s = play(s, 'a1');
    expect(s.shopEaten).toEqual([]);
    expect(s.shop.map((o) => o.uid)).toEqual(row);
    expect(s.runeProcs?.rune_spell_appetite).toBeUndefined();
  });

  it('no minion in the Shop: nothing is eaten and the rune does not fire', () => {
    let s = withRunes(['rune_spell_appetite'], { board: DEMONS(), hand: [spell('a1')] });
    s = { ...s, shop: s.shop.filter((o) => !isMinion(o)) };
    s = play(s, 'a1');
    expect(s.shopEaten).toEqual([]);
    expect(s.runeProcs?.rune_spell_appetite).toBeUndefined();
  });

  it('without the rune a spell eats nothing', () => {
    let s = withRunes([], { board: DEMONS(), hand: [spell('a1')] });
    s = play(s, 'a1');
    expect(s.shopEaten ?? []).toEqual([]);
  });

  it('two copies: one meter each, so one spell is two bites', () => {
    let s = withRunes(['rune_spell_appetite', 'rune_spell_appetite'], { board: DEMONS(), hand: [spell('a1')] });
    s = play(s, 'a1');
    expect(s.shopEaten).toHaveLength(2);
  });

  it('with Shop Madness the eaten slot refills at once (the Shop keeps 6 minions)', () => {
    let s = withRunes(['rune_shop_madness', 'rune_spell_appetite'], { board: DEMONS(), hand: [spell('a1')] });
    expect(minions(s)).toHaveLength(6);
    s = play(s, 'a1');
    expect(s.shopEaten).toHaveLength(1);
    expect(minions(s)).toHaveLength(6);
  });

  it('shares its bite with Gold for Grub without stealing its credit', () => {
    let s = withRunes(['rune_gold_for_grub', 'rune_spell_appetite'], { board: DEMONS(), hand: [spell('a1')] });
    s = play(s, 'a1');
    expect(s.runeProcs?.rune_spell_appetite).toBe(1);
    expect(s.runeProcs?.rune_gold_for_grub).toBeUndefined();
  });

  it('the random Demon and meal are deterministic from the seed', () => {
    const go = (seed: number) => {
      let s = withRunes(['rune_spell_appetite'], { board: DEMONS(), hand: [spell('a1'), spell('a2')] }, seed);
      s = play(play(s, 'a1'), 'a2');
      return (s.shopEaten ?? []).map((e) => `${e.eaterUid}:${e.cardId}`).join('|');
    };
    expect(go(29)).toEqual(go(29));
    const seen = new Set([3, 5, 7, 11, 13, 17, 19, 23].map(go));
    expect(seen.size).toBeGreaterThan(1);
  });
});
