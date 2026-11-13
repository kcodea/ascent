import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNES, EPIC_RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods } from './reducer';
import { applyEndOfTurn, consumeShopMinion, offerBuyStats } from './recruit';
import { SHOP_MADNESS_MINIONS, refillShopMadness, shopMinionCount } from './shop';
import { snapshotBoard } from './snapshot';

/**
 * SHOP MADNESS (Set 2 Basic rune, owner addition 2026-11-13): "Minions in your Shop have +3/+3. Your Shop always has
 * 6 minions." Owner rulings: the +3/+3 is ONGOING (every minion that enters the Shop for the rest of the run), and the
 * Shop refills ANY time a minion leaves it, mid-action, so it always holds 6 while the rune is held. The key case the
 * owner names: Hydraskus with many Demons eats once per Demon and never runs out. Rule R-SET2-RUNE-SHOPMADNESS-01.
 */

const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
function run(tier: number, extra: Partial<RunState> = {}, seed = 11): RunState {
  return {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
    ...extra,
  } as RunState;
}
/** Take the rune through the REAL Runeforge path. */
const take = (s: RunState): RunState =>
  ({ ...act({ ...s, runeforgeOffer: ['rune_shop_madness'], runeforgeEpic: false }, { type: 'buyRune', index: 0 }), embers: 60 });
const minions = (s: RunState) => s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !o.starform; });
const bonus = (s: RunState, o: RunState['shop'][number]): [number, number] => {
  const d = CARD_INDEX[o.cardId]!;
  const st = offerBuyStats(s, o);
  return [st.attack - d.attack, st.health - d.health];
};

describe('Shop Madness: content', () => {
  it('a Basic neutral rune, 1 Gold, Set 2 only, the owner text', () => {
    const r = RUNE_INDEX['rune_shop_madness']!;
    expect(RUNES.includes(r)).toBe(true);
    expect(EPIC_RUNES.includes(r)).toBe(false);
    expect([r.name, r.cost, !!r.epic, r.tribes, r.sets]).toEqual(['Shop Madness', 1, false, undefined, ['set2']]);
    expect(r.text).toBe('Minions in your Shop have **+3/+3**. Your Shop always has **6** minions.');
    expect(/—|--|Oath|climb/i.test(r.text)).toBe(false);
  });
});

describe('Shop Madness: the Shop always has 6 minions', () => {
  it('taking it fills a Tier 1 Shop (3 offers) to 6 at once, every offer +3/+3', () => {
    const s0 = run(1);
    expect(minions(s0)).toHaveLength(3);
    const s = take(s0);
    expect(minions(s)).toHaveLength(SHOP_MADNESS_MINIONS);
    for (const o of minions(s)) expect(bonus(s, o), o.cardId).toEqual([3, 3]);
  });

  it('6 minions after a Refresh at every Shop Tier; the spell slot is separate and still served', () => {
    for (let tier = 1; tier <= 6; tier++) {
      const s = act(take(run(tier)), { type: 'roll' });
      expect(minions(s), `Tier ${tier}`).toHaveLength(6);
      expect(s.spell, `Tier ${tier} spell slot`).toBeTruthy();
      expect(minions(s).every((o) => CARD_INDEX[o.cardId]!.tier <= tier)).toBe(true);
    }
  });

  it('a buy refills THAT slot with a fresh minion (+3/+3 too); the rest of the row stays put', () => {
    let s = act(take(run(2)), { type: 'roll' });
    const before = s.shop.map((o) => o.uid);
    s = act(s, { type: 'buy', uid: before[2]! } as Action);
    expect(s.hand.length + s.board.length).toBeGreaterThan(0);
    expect(minions(s)).toHaveLength(6);
    const after = s.shop.map((o) => o.uid);
    expect(after.filter((_, i) => i !== 2)).toEqual(before.filter((_, i) => i !== 2));
    expect(before).not.toContain(after[2]);
    expect(bonus(s, s.shop[2]!)).toEqual([3, 3]);
  });

  it('later Refreshes: the new minions all wear the +3/+3 (the buff is ongoing, not a one-shot)', () => {
    let s = take(run(3));
    for (let k = 0; k < 3; k++) s = act({ ...s, embers: 60 }, { type: 'roll' });
    for (const o of minions(s)) expect(bonus(s, o)).toEqual([3, 3]);
  });

  it('Freeze keeps the 6 into the next turn', () => {
    let s = act(take(run(2)), { type: 'roll' });
    const row = minions(s).map((o) => o.uid);
    s = act(s, { type: 'freeze' });
    s = act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
    expect(minions(s).map((o) => o.uid)).toEqual(row);
  });

  it('without the rune nothing changes: Tier sizes as printed, a buy leaves a gap', () => {
    let s = act(run(2), { type: 'roll' });
    expect(minions(s)).toHaveLength(4);
    s = act(s, { type: 'buy', uid: s.shop[0]!.uid } as Action);
    expect(minions(s)).toHaveLength(3);
  });
});

describe('Shop Madness x Hydraskus (the owner case)', () => {
  const demons = () => [body('hy', 'dm_hydraskus'), ...Array.from({ length: 6 }, (_, i) => body(`d${i}`, 'dm_hank'))];

  it('Hydraskus + 6 Demons at End of Turn: all 7 Demons eat, the Shop never runs dry, and it is back to 6', () => {
    const s = { ...act(take(run(1)), { type: 'roll' }), board: demons(), shopEaten: [] } as RunState;
    applyEndOfTurn(s);
    expect((s.shopEaten ?? []).length).toBe(7);
    expect(minions(s)).toHaveLength(6);
    // Without the rune a Tier 1 Shop (3 minions) runs dry after 3 bites.
    const plain = { ...act(run(1), { type: 'roll' }), board: demons(), shopEaten: [] } as RunState;
    applyEndOfTurn(plain);
    expect((plain.shopEaten ?? []).length).toBe(3);
    expect(minions(plain)).toHaveLength(0);
  });

  it('every bite eats a +3/+3 minion', () => {
    const s = { ...act(take(run(1)), { type: 'roll' }), board: demons(), shopEaten: [] } as RunState;
    applyEndOfTurn(s);
    for (const e of s.shopEaten ?? []) {
      const d = CARD_INDEX[e.cardId]!;
      expect([e.attack - d.attack, e.health - d.health]).toEqual([3, 3]);
    }
  });
});

describe('Shop Madness: loops, the pool, determinism, snapshots', () => {
  it('a long consume loop terminates and the row stays at 6; a refill of a full row does nothing', () => {
    const s = act(take(run(4)), { type: 'roll' });
    const eater = body('e', 'dm_hank');
    s.board = [eater];
    for (let k = 0; k < 40; k++) {
      expect(consumeShopMinion(s, eater, 0)).toBe(true);
      expect(shopMinionCount(s)).toBe(6);
    }
    const before = s.shop.map((o) => o.uid);
    refillShopMadness(s, [0, 1, 2]);
    expect(s.shop.map((o) => o.uid)).toEqual(before);
  });

  it('a dry pool: the refill stops short instead of looping', () => {
    const s = act(take(run(1)), { type: 'roll' });
    for (const k of Object.keys(s.pool)) s.pool[k] = 0;
    const eater = body('e', 'dm_hank');
    s.board = [eater];
    expect(consumeShopMinion(s, eater, 0)).toBe(true);
    // The eaten copy went back to the pool, so at most that one copy can come back.
    expect(shopMinionCount(s)).toBeGreaterThanOrEqual(5);
    expect(shopMinionCount(s)).toBeLessThanOrEqual(6);
  });

  it('deterministic from the seed: two identical runs refill identically', () => {
    const go = () => {
      let s = act(take(run(2, {}, 21)), { type: 'roll' });
      s = act(s, { type: 'buy', uid: s.shop[1]!.uid } as Action);
      s = act({ ...s, embers: 60 }, { type: 'roll' });
      return s.shop.map((o) => o.cardId);
    };
    expect(go()).toEqual(go());
  });

  it('Shop-only: it never reaches the combat mods or an opponent snapshot', () => {
    const s = take(run(3, { board: [body('a', 'dm_hank')] }));
    expect(s.questFlags?.runeShopMadness).toBe(true);
    expect((questCombatMods(s) as Record<string, unknown>).runeShopMadness).toBeUndefined();
    // A snapshot carries the owner's combat mods; the only trace is the generic per-flag copy count every flag rune
    // carries (`flagCopies`), which no combat code reads for this flag.
    const snap = snapshotBoard(s) as unknown as { questMods?: Record<string, unknown> & { flagCopies?: Record<string, number> } };
    expect(snap.questMods?.runeShopMadness).toBeUndefined();
    const rest = { ...(snap.questMods ?? {}), flagCopies: undefined };
    expect(JSON.stringify(rest)).not.toContain('ShopMadness');
  });
});
