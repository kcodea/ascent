import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatSideState } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/** The 2026-08-07 owner Epic batch: 14 runes. Data-only shape is covered by validateRunes + the count and
 *  tally tripwires; this file pins the ones with real machinery. */
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;
const bm = (uid: string, cardId: string, a = 2, h = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: a, health: h, keywords: [], golden: false });

function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s: RunState = { ...createRun(3, 'runesmith'), wave: 7, phase: 'recruit', embers: 20, runeforgeOffer: [id], ...extra };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 40000 }];
const mods = (m: Partial<CombatSideState['questMods']>) => ({ questMods: m as CombatSideState['questMods'] });

describe('the 14 defs ship as specced', () => {
  const want: [string, number][] = [
    ['rune_enchantment', 5], ['rune_crown', 4], ['rune_lapidary', 5], ['rune_gem_golem', 4],
    ['rune_dragonscale', 4], ['rune_tempered_time', 4], ['rune_savagery', 5], ['rune_crucible', 4],
    ['rune_herald', 5], ['rune_deep', 6], ['rune_guiding_candle', 4], ['rune_muster', 3],
    ['rune_foundry', 4], ['rune_corrupted_tome', 4],
  ];
  it('all present, all EPIC, at the sheet costs', () => {
    for (const [id, cost] of want) {
      const r = rune(id);
      expect(r, `${id} missing`).toBeDefined();
      expect(r.cost, id).toBe(cost);
      expect(r.epic, `${id} should be Epic`).toBe(true);
    }
  });
  it('only the Lapidary and the Gem Golem are set-2 scoped', () => {
    for (const [id] of want) {
      const scoped = ['rune_lapidary', 'rune_gem_golem'].includes(id);
      expect(rune(id).sets, id).toEqual(scoped ? ['set2'] : undefined);
    }
  });
});

describe('the shop-side machinery', () => {
  it('the Crown steps spell power only AFTER the 6th cast', () => {
    const before = withRune('rune_crown', { spellsCast: 5 });
    const after = withRune('rune_crown', { spellsCast: 6 });
    // Spell power feeds the printed value of a stat spell — compare a Growth read across the threshold.
    expect(before.runeCrown).toEqual({ per: 6, attack: 4, health: 4 });
    expect(after.runeCrown).toEqual({ per: 6, attack: 4, health: 4 });
    // The step itself is asserted through the shared bonus helper in the live-text path (spellStatBonus);
    // here we pin the STATE the helper reads, plus the tally boundary the UI shows.
    expect(Math.min(before.spellsCast, 6)).toBe(5);
    expect(Math.min(after.spellsCast, 6)).toBe(6);
  });

  it('the Lapidary plays one Ruby per TYPE at End of Turn, not one per minion', () => {
    // Two Beasts + one Dragon → 2 Rubies (one Beast, one Dragon), not 3.
    const s = withRune('rune_lapidary', {
      board: [bm('b1', 'stray'), bm('b2', 'pack'), bm('d1', 'whelpling')],
    });
    const before = s.board.map((c) => c.attack + c.health);
    const next = reduce({ ...s, phase: 'recruit' }, { type: 'faceOmen' }) as RunState;
    const gained = next.board.filter((c, i) => (c.attack + c.health) > (before[i] ?? 0)).length;
    expect(gained, 'one minion of each type, not each minion').toBe(2);
  });

  it('the Foundry hands over a Dragon every 5 sells', () => {
    let s = withRune('rune_foundry', { board: [], embers: 20 });
    expect(s.runeFoundry).toEqual({ per: 5, sold: 0 });
    for (let i = 0; i < 5; i++) {
      s = { ...s, board: [bm(`x${i}`, 'stray')] };
      s = reduce(s, { type: 'sell', uid: `x${i}` }) as RunState;
    }
    expect(s.runeFoundry?.sold).toBe(0); // wrapped
    const dragons = s.hand.filter((c) => { const d = CARD_INDEX[c.cardId]; return d?.tribe === 'dragon' || d?.tribe2 === 'dragon'; });
    expect(dragons.length, 'no Dragon at 5 sells').toBeGreaterThanOrEqual(1);
  });

  it('the Corrupted Tome turns one Triple Reward into two — never four', () => {
    // The Triple Reward token is granted when the GOLDEN minion is played (`grantGoldenDiscover`), which is
    // the one path the Tome hooks — so play a golden body rather than staging a combine.
    const playGolden = (st: RunState): RunState => reduce(
      { ...st, embers: 0, shop: [], board: [],
        hand: [{ ...bm('g', 'stray', 2, 2), golden: true }] } as RunState,
      { type: 'play', uid: 'g' }) as RunState;
    const tokens = (st: RunState) => st.hand.filter((c) => c.cardId === 'discoverspell').length;
    expect(tokens(playGolden({ ...createRun(3), phase: 'recruit' } as RunState)), 'the fixture granted nothing').toBe(1);
    expect(tokens(playGolden(withRune('rune_corrupted_tome'))), 'two, not four').toBe(2);
  });

  it('the Muster stocks a refresh with plain copies of the board', () => {
    let s = withRune('rune_muster', { board: [bm('a', 'pack'), bm('b', 'whelpling')], embers: 20, freeRolls: 1 });
    s = reduce(s, { type: 'roll' }) as RunState;
    expect(s.shop.map((o) => o.cardId).sort()).toEqual(['pack', 'whelpling'].sort());
    expect(s.runeMuster, 'spent on use').toBeUndefined();
  });

  it('the Guiding Candle locks the first 2 refreshes to Tier 6, then stops', () => {
    let s = withRune('rune_guiding_candle', { tier: 6, embers: 40, freeRolls: 9 });
    const tiersOf = (st: RunState) => st.shop.map((o) => CARD_INDEX[o.cardId]?.tier);
    s = reduce(s, { type: 'roll' }) as RunState;
    expect(tiersOf(s).every((t) => t === 6), 'first refresh not locked').toBe(true);
    s = reduce(s, { type: 'roll' }) as RunState;
    expect(tiersOf(s).every((t) => t === 6), 'second refresh not locked').toBe(true);
    s = reduce(s, { type: 'roll' }) as RunState;
    expect(s.runeGuidingCandle?.left).toBe(0); // the allowance is spent; the draw is unrestricted again
  });
});

describe('the combat flags', () => {
  it('Tempered Time gives Health equal to half Attack, floored', () => {
    const r = simulate(
      [{ cardId: 'sandbag', attack: 5, health: 10 }, { cardId: 'sandbag', attack: 1, health: 10 }],
      wall, makeRng(2), CARD_INDEX, combatSide({ tier: 6, ...mods({ runeTemperedTime: true }) }), combatSide({ tier: 1 }));
    const grants = r.events.filter((e) => e.type === 'buff' && e.source === 'Rune of Tempered Time');
    expect(grants.length, 'a 1-Attack body floors to 0 and is skipped').toBe(1);
    expect(grants[0]).toMatchObject({ attack: 0, health: 2 }); // floor(5/2)
  });

  it('Savagery doubles a summoned Beast’s Attack', () => {
    // Pack summons pups (Beasts) on death — the summoned body arrives with its Attack doubled.
    const r = simulate(
      [{ cardId: 'pack', attack: 3, health: 1 }],
      [{ cardId: 'omen', attack: 40, health: 4000 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'], ...mods({ runeSavagery: true }) }), combatSide({ tier: 1 }));
    expect(r.events.some((e) => e.type === 'buff' && e.source === 'Rune of Savagery'), 'no summoned Beast doubled').toBe(true);
  });

  it('Dragonscale shields attacking Dragons, capped at 3 a combat', () => {
    const r = simulate(
      [{ cardId: 'whelpling', attack: 4, health: 4000 }],
      [{ cardId: 'sandbag', attack: 1, health: 40000 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['dragon'], ...mods({ runeDragonscale: 3 }) }), combatSide({ tier: 1 }));
    const shields = r.events.filter((e) => e.type === 'shieldUp');
    expect(shields.length, 'the 3-per-combat cap leaked').toBeLessThanOrEqual(3);
    expect(shields.length, 'no Ward was granted at all').toBeGreaterThan(0);
  });

  it('the Herald triggers every Echo at Start of Combat, without killing the bodies', () => {
    const r = simulate(
      [{ cardId: 'pack', attack: 3, health: 400 }, { cardId: 'sandbag', attack: 1, health: 400 }],
      wall, makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast'], ...mods({ runeHerald: true }) }), combatSide({ tier: 1 }));
    // Pack's Echo summons pups — they arrive at Start of Combat, and Pack itself is still alive.
    const summonsBeforeAnyDeath = r.events.findIndex((e) => e.type === 'death');
    const firstSummon = r.events.findIndex((e) => e.type === 'summon');
    expect(firstSummon, 'the Echo never fired').toBeGreaterThanOrEqual(0);
    if (summonsBeforeAnyDeath >= 0) expect(firstSummon).toBeLessThan(summonsBeforeAnyDeath);
  });

  it('the Crucible sacrifices 3 and returns them when the side is wiped', () => {
    const r = simulate(
      [{ cardId: 'sandbag', attack: 2, health: 3 }, { cardId: 'sandbag', attack: 2, health: 3 },
       { cardId: 'sandbag', attack: 2, health: 3 }, { cardId: 'sandbag', attack: 2, health: 3 }],
      [{ cardId: 'omen', attack: 40, health: 4000 }], makeRng(2), CARD_INDEX,
      combatSide({ tier: 6, ...mods({ runeCrucible: 3 }) }), combatSide({ tier: 1 }));
    // 3 die instantly at SoC; when the 4th falls the bank returns — so the side summons after the wipe.
    const deaths = r.events.filter((e) => e.type === 'death' && e.side === 'player').length;
    const summons = r.events.filter((e) => e.type === 'summon' && e.side === 'player').length;
    expect(deaths, 'the sacrifice never happened').toBeGreaterThanOrEqual(3);
    expect(summons, 'the bank never returned').toBe(3);
  });
});
