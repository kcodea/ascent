import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * Owner batch 4, tranche 1 — the nine pattern-reuse Basic runes (2026-08-07).
 *
 * Every combat assertion is measured against the SAME board WITHOUT the flag, so what it proves is the rune's
 * contribution rather than whatever the board was going to do on its own. The shop-side ones go through the
 * real `reduce`, not injected state: the Chef's two defects earlier today both lived precisely in the gap
 * between "the mechanism works" and "the reducer actually delivers it".
 */

const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;

const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());

const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 30, runeforgeOffer: [id], ...extra };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('the nine defs ship as specced', () => {
  it('costs, and only the Ruby/Ale ones are Set-2 scoped', () => {
    expect(rune('rune_empty_plate').cost).toBe(3);
    expect(rune('rune_gem_dividend').cost).toBe(3);
    expect(rune('rune_carrion_coin').cost).toBe(3);
    expect(rune('rune_five_banners').cost).toBe(4);
    expect(rune('rune_centerline').cost).toBe(3);
    expect(rune('rune_second_litter').cost).toBe(4);
    expect(rune('rune_shared_pour').cost).toBe(4);
    expect(rune('rune_aftermarket').cost).toBe(4);
    expect(rune('rune_hoardcalling').cost).toBe(5);
    // Gem Dividend needs Rubies and Shared Pour needs Ales, so both are Set-2 only. The rest work in either.
    expect(rune('rune_gem_dividend').sets).toEqual(['set2']);
    expect(rune('rune_shared_pour').sets).toEqual(['set2']);
    for (const id of ['rune_empty_plate', 'rune_carrion_coin', 'rune_five_banners', 'rune_centerline',
      'rune_second_litter', 'rune_aftermarket', 'rune_hoardcalling']) {
      expect(rune(id).sets, `${id} should not be set-scoped`).toBeUndefined();
    }
    // All nine are Basic — none carry the Epic flag.
    for (const id of ['rune_empty_plate', 'rune_gem_dividend', 'rune_carrion_coin', 'rune_five_banners',
      'rune_centerline', 'rune_second_litter', 'rune_shared_pour', 'rune_aftermarket', 'rune_hoardcalling']) {
      expect(rune(id).epic, `${id} should be Basic`).toBeFalsy();
    }
  });
});

// ─────────────────────────── the combat four ───────────────────────────

describe('Rune of the Five Banners', () => {
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 400 }];
  /** Total stats the player's board gained at Start of Combat, rune minus baseline. */
  const gain = (board: BoardMinion[], mods: object) => {
    const r = sim(board, enemy, mods);
    // A `buff` event carries no `side`, so the rune's own source label is what identifies its payouts.
    return r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of the Five Banners')
      .reduce((n, e) => n + ((e as { attack: number }).attack + (e as { health: number }).health), 0);
  };

  it('pays exactly one body per type — not one per minion', () => {
    // Three Beasts and one Dragon: two types present, so 2 × (+6/+6) = 24 total stats, NOT 4 × 12.
    const board: BoardMinion[] = [
      { cardId: 'stray', attack: 1, health: 9 }, { cardId: 'stray', attack: 1, health: 9 },
      { cardId: 'stray', attack: 1, health: 9 }, { cardId: 'emissary', attack: 1, health: 9 },
    ];
    expect(gain(board, {}), 'baseline should buff nothing').toBe(0);
    expect(gain(board, { runeFiveBanners: true })).toBe(24);
  });

  it('scales with the number of TYPES present, one banner each', () => {
    const three: BoardMinion[] = [
      { cardId: 'stray', attack: 1, health: 9 },   // Beast
      { cardId: 'emissary', attack: 1, health: 9 },// Dragon
      { cardId: 'spore', attack: 1, health: 9 },   // Undead
      { cardId: 'drone', attack: 1, health: 9 },   // Mech
    ];
    expect(gain(three, { runeFiveBanners: true }), 'four types, four banners').toBe(48);
  });
});

describe('Rune of the Centerline', () => {
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 400 }];
  const shields = (board: BoardMinion[], mods: object) =>
    sim(board, enemy, mods).events.filter((e) => e.type === 'shieldUp').length;

  it('wards the middle body when the two ends differ in type', () => {
    const board: BoardMinion[] = [
      { cardId: 'stray', attack: 1, health: 9 },      // Beast
      { cardId: 'sandbag', attack: 1, health: 9 },    // middle
      { cardId: 'emissary', attack: 1, health: 9 },   // Dragon
    ];
    expect(shields(board, {}), 'baseline should ward nobody').toBe(0);
    expect(shields(board, { runeCenterline: true })).toBe(1);
  });

  it('pays nothing when the ends share a type, or when the board is too short to have ends', () => {
    const same: BoardMinion[] = [
      { cardId: 'stray', attack: 1, health: 9 }, { cardId: 'sandbag', attack: 1, health: 9 },
      { cardId: 'stray', attack: 1, health: 9 },
    ];
    expect(shields(same, { runeCenterline: true }), 'matching ends should pay nothing').toBe(0);
    const two: BoardMinion[] = [{ cardId: 'stray', attack: 1, health: 9 }, { cardId: 'emissary', attack: 1, health: 9 }];
    expect(shields(two, { runeCenterline: true }), 'two bodies have no middle').toBe(0);
  });
});

describe('Rune of the Second Litter', () => {
  it('copies the FIRST Beast summoned in combat, and only the first', () => {
    // Alleycat Pack's Deathrattle summons two Pups: the rune should add exactly ONE extra body across the
    // whole fight, not one per summon — the latch is the thing being proved.
    const board: BoardMinion[] = [{ cardId: 'pack', attack: 1, health: 1 }];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const beasts = (mods: object) => sim(board, killer, mods).events.filter((e) => e.type === 'summon' && e.side === 'player').length;
    const base = beasts({});
    expect(base, 'the fixture needs to summon at least one Beast').toBeGreaterThan(0);
    expect(beasts({ runeSecondLitter: true }) - base, 'exactly one extra copy').toBe(1);
  });
});

describe('Rune of Carrion Coin', () => {
  it('grants a Shop spell every 4th friendly death, and nothing before the 4th', () => {
    const fodder: BoardMinion[] = Array.from({ length: 8 }, () => ({ cardId: 'sandbag', attack: 0, health: 1 }));
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const granted = (mods: object) => sim(fodder, killer, mods).events.filter((e) => e.type === 'toHand' && e.side === 'player').length;
    expect(granted({}), 'baseline should grant nothing').toBe(0);
    expect(granted({ runeCarrionCoin: 4 }), '8 deaths at Avenge(4) is two payouts').toBe(2);
    // The threshold is real: three deaths must not pay.
    const three: BoardMinion[] = Array.from({ length: 3 }, () => ({ cardId: 'sandbag', attack: 0, health: 1 }));
    expect(sim(three, killer, { runeCarrionCoin: 4 }).events.filter((e) => e.type === 'toHand' && e.side === 'player').length).toBe(0);
  });
});

// ─────────────────────────── the shop five ───────────────────────────

describe('Rune of the Empty Plate', () => {
  it('arms a `consume` threshold that pays a Shop spell on the 3rd Consume', () => {
    const s = withRune('rune_empty_plate');
    const t = (s.runeThresholds ?? []).find((x) => x.sourceId === 'rune_empty_plate');
    expect(t, 'the threshold was never armed').toBeDefined();
    expect([t!.meter, t!.per, t!.grantSpell]).toEqual(['consume', 3, 1]);
  });
});

describe('Rune of the Gem Dividend', () => {
  it('arms a per-turn Ruby threshold that banks Gold into NEXT turn', () => {
    const s = withRune('rune_gem_dividend');
    const t = (s.runeThresholds ?? []).find((x) => x.sourceId === 'rune_gem_dividend');
    expect(t, 'the threshold was never armed').toBeDefined();
    expect([t!.meter, t!.per, t!.grantGoldNextTurn]).toEqual(['castRuby', 5, 3]);
    // The sheet says "in a turn", so the meter must not bank a remainder across turns.
    expect(t!.resetEachTurn, 'the window is a turn — the meter has to reset').toBe(true);
  });
});

describe('Rune of Shared Pour', () => {
  it('arms the once-per-turn flag rather than a permanent multiplier', () => {
    const s = withRune('rune_shared_pour');
    expect(s.runeSharedPour).toBe(true);
    expect(s.sharedPourUsedThisTurn, 'the freebie starts unspent').toBeFalsy();
  });
});

describe('Rune of the Aftermarket', () => {
  it('the first sell each turn pushes the sold minion’s BASE stats into the Shop', () => {
    const s = withRune('rune_aftermarket', { board: [bm('sold', 'stray', 9, 9)] });
    expect(s.runeAftermarket).toBe(true);
    const before = s.shop.map((c) => (c.atk ?? 0) + (c.hp ?? 0));
    const next = reduce(s, { type: 'sell', uid: 'sold' }) as RunState;
    const after = next.shop.map((c) => (c.atk ?? 0) + (c.hp ?? 0));
    // Base stats, not the buffed 9/9 the body was carrying — a Stray is 1/1, so +2 total per Shop minion.
    const base = CARD_INDEX['stray']!;
    const delta = base.attack + base.health;
    expect(after.length).toBe(before.length);
    for (let i = 0; i < after.length; i++) expect(after[i]! - before[i]!).toBe(delta);
    expect(next.aftermarketUsedThisTurn, 'the once-per-turn latch should be spent').toBe(true);
  });

  it('the second sell in the same turn pays nothing', () => {
    const s = withRune('rune_aftermarket', { board: [bm('a', 'stray', 9, 9), bm('b', 'stray', 9, 9)] });
    const one = reduce(s, { type: 'sell', uid: 'a' }) as RunState;
    const mid = one.shop.map((c) => (c.atk ?? 0) + (c.hp ?? 0));
    const two = reduce(one, { type: 'sell', uid: 'b' }) as RunState;
    expect(two.shop.map((c) => (c.atk ?? 0) + (c.hp ?? 0))).toEqual(mid);
  });
});

describe('Rune of Hoardcalling', () => {
  it('arms the once-per-turn Dragon-Shout flag', () => {
    const s = withRune('rune_hoardcalling');
    expect(s.runeHoardcalling).toBe(true);
    expect(s.hoardcallingUsedThisTurn, 'the freebie starts unspent').toBeFalsy();
  });
});
