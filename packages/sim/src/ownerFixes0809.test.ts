import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import { rollShop } from './shop';

/** Owner batch 2026-08-08 (third pass): the Guiding Candle, the Undertow's cap, Chimerus's max Health. */

const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['beast', 'dragon', 'demon', 'kobold', 'dwarf', 'undead', 'mech'], questMods: mods as never }), combatSide());

describe('Rune of the Guiding Candle', () => {
  /** Roll a shop at `tier` with the Candle armed, and report the tiers it offered. */
  const rollAt = (tier: number, armed: boolean): number[] => {
    const s: RunState = { ...createRun(11), phase: 'recruit', tier } as RunState;
    if (armed) s.runeGuidingCandle = { count: 2, tier: 6, left: 2 };
    rollShop(s);
    return s.shop.map((o) => CARD_INDEX[o.cardId]?.tier ?? 0);
  };

  it('serves a full shop of Tier 6s REGARDLESS of the player’s tavern tier', () => {
    // The bug: the draw pool was `card.tier <= state.tier`, so below tier 6 the narrowed set was empty and
    // the code fell through to a normal shop — the rune did nothing at every tier worth buying it at.
    for (const tier of [2, 3, 4, 5]) {
      const tiers = rollAt(tier, true);
      expect(tiers.length, `tier ${tier}: the shop should still be full`).toBeGreaterThan(0);
      expect(tiers.every((t) => t === 6), `tier ${tier}: offered ${tiers.join(',')} — expected all 6s`).toBe(true);
    }
  });

  it('an unarmed shop at the same tier offers nothing above the tavern tier', () => {
    const tiers = rollAt(3, false);
    expect(tiers.every((t) => t <= 3), `baseline offered ${tiers.join(',')}`).toBe(true);
  });

  it('the allowance still runs out — the third refresh is a normal shop', () => {
    const s: RunState = { ...createRun(11), phase: 'recruit', tier: 3 } as RunState;
    s.runeGuidingCandle = { count: 2, tier: 6, left: 2 };
    const seen: number[][] = [];
    for (let i = 0; i < 3; i++) {
      // Mirrors the reducer's order exactly: `rollShop` reads the lock, THEN the allowance is spent.
      const gc: { count: number; tier: number; left: number } = s.runeGuidingCandle!;
      rollShop(s);
      if (gc.left > 0) s.runeGuidingCandle = { ...gc, left: gc.left - 1 };
      seen.push(s.shop.map((o) => CARD_INDEX[o.cardId]?.tier ?? 0));
    }
    expect(seen[0]!.every((t) => t === 6), 'refresh 1 should be all 6s').toBe(true);
    expect(seen[1]!.every((t) => t === 6), 'refresh 2 should be all 6s').toBe(true);
    expect(seen[2]!.every((t) => t === 6), 'refresh 3 must NOT be locked any more').toBe(false);
  });
});

describe('Rune of the Undertow', () => {
  it('wards at most 4 summons a combat', () => {
    // Alleycat Pack summons 2 Pups per death; a wide fragile board cascades well past 4 summons.
    const board: BoardMinion[] = Array.from({ length: 5 }, () => ({ cardId: 'pack', attack: 1, health: 1 }));
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const warded = (mods: object) => sim(board, killer, mods).events
      .filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.keywords.includes('DS')).length;
    const summons = sim(board, killer, {}).events.filter((e) => e.type === 'summon' && e.side === 'player').length;
    expect(summons, 'the fixture needs more than 4 summons to prove a cap').toBeGreaterThan(4);
    expect(warded({}), 'baseline wards nothing').toBe(0);
    expect(warded({ runeUndertow: 4 }), 'the cap should hold at 4').toBe(4);
  });

  it('a legacy save storing `true` still gets the default 4', () => {
    const board: BoardMinion[] = Array.from({ length: 5 }, () => ({ cardId: 'pack', attack: 1, health: 1 }));
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const warded = sim(board, killer, { runeUndertow: true }).events
      .filter((e) => e.type === 'summon' && e.side === 'player' && e.minion.keywords.includes('DS')).length;
    expect(warded).toBe(4);
  });
});

describe('Chimerus gives its MAX Health, not its damaged current Health', () => {
  it('a chipped Chimerus still hands over its full Health', () => {
    // Chimerus rallies on attack. Facing a big attacker it takes damage between swings; the grant must not
    // shrink with the chip (owner ruling: buffed to 1500, hit for 1000, still grants 1500).
    const board: BoardMinion[] = [
      { cardId: 'chimerus', attack: 4, health: 40 },
      { cardId: 'emissary', attack: 1, health: 200 }, // a friendly Dragon to receive the grant
    ];
    const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 400 }];
    const r = sim(board, killer);
    const chim = r.initial.player.find((m) => m.cardId === 'chimerus')!;
    const grants = r.events.filter((e) => e.type === 'buff' && (e as { source: string }).source === chim.uid);
    expect(grants.length, 'Chimerus should have rallied at least once').toBeGreaterThan(0);
    // Every grant equals the body's MAX Health (40 at start, plus anything that raised max) — never a lower,
    // damage-reduced number. Under the old `self.health` read the later grants shrank as it got chipped.
    const amounts = [...new Set(grants.map((e) => (e as { health: number }).health))];
    expect(Math.min(...amounts), 'a grant shrank below the starting max — it read current Health').toBeGreaterThanOrEqual(40);
  });
});
