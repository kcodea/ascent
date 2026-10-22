import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import {
  createRun, reduce, tierSlots, equipmentState, equipmentAmplifiedOf, calibrationPendingOf, equipmentWillAmplify,
  createStarform, buffStarform, hasStarform,
  type Action, type BoardCard, type RunState, type ShopCard,
} from './index';
import { addCardToShop, applyShopRefreshed } from './recruit';
import { RUNE_INDEX, RUNES, EPIC_RUNES } from '@game/content';
const runePool = (setId: string): string[] => [...RUNES, ...EPIC_RUNES].filter((r) => !r.sets || r.sets.includes(setId as never)).map((r) => r.id);
import { equipmentAmplifiedByAura } from './equipment';
import { sellDiscoverTierText } from '../../ui/src/cardText';

/**
 * OWNER SET 3 BATCH (2026-10-13): archives, Solburn's Sell, the tier / stat moves, and three new Neutrals.
 *  - Archived (set-3-own): Delver, Shardluck, Dreaming Deep, Cosmo Express, Constellation Prime, Yeti.
 *  - Left set 3 only (shared carry-overs; set 2 keeps them): Beggy, Geode Guardian, Veinstorm, Mountainbond,
 *    Paymaster Pimm, Kringle, Blade Thrower, Gangplank, Anubis.
 *  - Solburn: "Sell: Collapse your Starform."
 *  - Indy: every 5 rolls, add a Golden Monkey to the Shop (gilded 2). Golden Monkey: Sell, Discover from the Tier above.
 *  - Amplification Agnus: all Equipment is Amplified while it is on the board.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  const g = over.golden ? 2 : 1;
  return { uid, cardId, tribe: d.tribe, attack: d.attack * g, health: d.health * g, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(5), setId: 'set3', phase: 'recruit', embers: 60, tier: 3, tribes: ['celestial', 'undead', 'kobold', 'dwarf', 'spirit'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const play = (s: RunState, uid: string, toIndex = s.board.length): RunState => act(s, { type: 'play', uid, toIndex } as Action);
const sell = (s: RunState, uid: string): RunState => act(s, { type: 'sell', uid } as Action);
const roll = (s: RunState): RunState => act(s, { type: 'roll' } as Action);
const monkeys = (s: RunState): ShopCard[] => s.shop.filter((o) => o.cardId === 'n3_goldenmonkey');
const statsOf = (s: RunState, uid: string): [number, number] => { const c = s.board.find((b) => b.uid === uid)!; return [c.attack, c.health]; };

describe('roster', () => {
  const set3 = poolFor('set3').all.map((c) => c.id);
  const set2 = poolFor('set2').all.map((c) => c.id);

  // Delver (k3_veinchant) and Shardluck (k3_facetbound) were archived here too, until the 2026-10-22 owner Set 3 Kobold pool
  // call restored them to Set 3 (pinned in set3KoboldPool1022.test.ts).
  it('the four remaining set-3-own cards are archived: out of every set, still resolvable by id', () => {
    for (const id of ['sp3_dreamingdeep', 'ce3_courier', 'ce3_constellationprime', 'n3_yeti']) {
      expect(set3, id).not.toContain(id);
      expect(set2, id).not.toContain(id);
      expect(CARD_INDEX[id], id).toBeTruthy();
    }
  });

  it('the shared carry-overs leave set 3 only; set 2 keeps every set-2 one', () => {
    const left = ['k_beggy', 'k_geode', 'veinstorm', 'dw_mountainbond', 'dw_pimm', 'dw_foreman', 'dw_bladethrower', 'dw_gangplank', 'anubis'];
    for (const id of left) expect(set3, id).not.toContain(id);
    for (const id of left.filter((i) => i !== 'anubis')) expect(set2, `${id} stays in set 2`).toContain(id);
  });

  it('the tier / stat moves', () => {
    expect(CARD_INDEX['blaster']).toMatchObject({ tier: 3, attack: 8, health: 2 });
    expect(CARD_INDEX['n3_calibration']).toMatchObject({ tier: 4, attack: 6, health: 4 });
    expect(CARD_INDEX['ce3_coronadevotee']).toMatchObject({ tier: 4, attack: 4, health: 5, text: '**Sell:** Collapse your **Starform**.' });
  });

  it('the three new Neutrals: Indy and Agnus are drawable in set 3, the Golden Monkey is a token', () => {
    expect(CARD_INDEX['n3_indy']).toMatchObject({ tribe: 'neutral', tier: 4, attack: 5, health: 5 });
    expect(CARD_INDEX['n3_agnus']).toMatchObject({ tribe: 'neutral', tier: 7, attack: 10, health: 10 });
    expect(CARD_INDEX['n3_goldenmonkey']).toMatchObject({ tribe: 'neutral', tier: 1, attack: 6, health: 6, keywords: ['T'], token: true });
    expect(set3).toContain('n3_indy');
    expect(set3).toContain('n3_agnus');
    expect(poolFor('set3').buyable.map((c) => c.id)).not.toContain('n3_goldenmonkey');
    expect(CARD_INDEX['n3_indy']!.id, 'a distinct id from the hero Indy').not.toBe('indy');
  });
});

describe('Solburn: Sell, Collapse your Starform', () => {
  const withSf = (over: Partial<RunState> = {}): RunState => {
    const s = run({ shop: [], ...over });
    createStarform(s, { cardId: 'test', name: 'test' });
    buffStarform(s, 6, 9, 'test'); // 7/10 → half 4/5
    return s;
  };

  it('selling it collapses the token onto your Celestials; the sold Solburn takes nothing', () => {
    let s = withSf({ board: [body('d', 'ce3_coronadevotee'), body('a', 'ce3_seer'), body('n', 'sandbag')] });
    const before = statsOf(s, 'a');
    s = sell(s, 'd');
    expect(hasStarform(s)).toBe(false);
    expect(statsOf(s, 'a')).toEqual([before[0] + 4, before[1] + 5]);
    expect(s.board.some((c) => c.uid === 'd')).toBe(false);
  });

  it('gilded: each hit gains the FULL stats', () => {
    let s = withSf({ board: [body('d', 'ce3_coronadevotee', { golden: true }), body('a', 'ce3_seer')] });
    const before = statsOf(s, 'a');
    s = sell(s, 'd');
    expect(statsOf(s, 'a')).toEqual([before[0] + 8, before[1] + 10]);
  });

  it('playing it no longer collapses anything (the Shout is gone)', () => {
    let s = withSf({ board: [body('a', 'ce3_seer')], hand: [body('d', 'ce3_coronadevotee')] });
    s = play(s, 'd');
    expect(hasStarform(s)).toBe(true);
  });

  it('no Starform: selling does nothing beyond the sale', () => {
    let s = run({ shop: [], board: [body('d', 'ce3_coronadevotee'), body('a', 'ce3_seer')] });
    const before = statsOf(s, 'a');
    s = sell(s, 'd');
    expect(statsOf(s, 'a')).toEqual(before);
  });
});

describe('Indy: every 5 rolls, add a Golden Monkey to the Shop', () => {
  it('four rolls add nothing; the fifth adds one; the tenth adds another (cumulative, repeats every 5)', () => {
    let s = run({ board: [body('i', 'n3_indy')] });
    for (let r = 0; r < 4; r++) { s = roll(s); expect(monkeys(s).length, `roll ${r + 1}`).toBe(0); }
    s = roll(s);
    expect(monkeys(s).length).toBe(1);
    expect(s.shop.length, 'the Shop never grows past its slots').toBeLessThanOrEqual(tierSlots(s.tier));
    for (let r = 0; r < 4; r++) { s = roll(s); expect(monkeys(s).length, `roll ${r + 6}`).toBe(0); }
    s = roll(s);
    expect(monkeys(s).length).toBe(1);
  });

  it('gilded adds TWO, and the second never replaces the first', () => {
    let s = run({ board: [body('i', 'n3_indy', { golden: true })] });
    for (let r = 0; r < 5; r++) s = roll(s);
    expect(monkeys(s).length).toBe(2);
    expect(s.shop.length).toBeLessThanOrEqual(tierSlots(s.tier));
  });

  it('the meter is per body, counted from when it arrived', () => {
    let s = run({ board: [] });
    for (let r = 0; r < 3; r++) s = roll(s);
    s = { ...s, board: [body('i', 'n3_indy')] };
    for (let r = 0; r < 4; r++) s = roll(s);
    expect(monkeys(s).length, 'rolls before Indy arrived do not count').toBe(0);
    s = roll(s);
    expect(monkeys(s).length).toBe(1);
  });

  it('ONLY the player pressing Refresh counts (owner 2026-10-13): turn-start / rune / spell refreshes do not; a free reroll does', () => {
    let s = run({ board: [body('i', 'n3_indy')] });
    for (let r = 0; r < 10; r++) applyShopRefreshed(s); // non-player refreshes (turn-start row, runes, spells, hero powers)
    expect(s.board[0]!.eotTick ?? 0, 'a non-player refresh never ticks the meter').toBe(0);
    expect(monkeys(s).length).toBe(0);
    s = { ...s, freeRolls: 5, embers: 0 };
    for (let r = 0; r < 5; r++) s = roll(s);
    expect(s.freeRolls, 'all five were free rerolls').toBe(0);
    expect(monkeys(s).length, 'free rerolls are still the player pressing Refresh').toBe(1);
  });

  it('a full turn boundary does not tick it (the fresh turn-start Shop is not a roll)', () => {
    let s = run({ board: [body('i', 'n3_indy')] });
    for (let r = 0; r < 4; r++) s = roll(s);
    expect(s.board[0]!.eotTick).toBe(4);
    s = act(act(act(s, { type: 'faceOmen' } as Action), { type: 'settleCombat' } as Action), { type: 'resolveCombat' } as Action);
    expect(s.phase).toBe('recruit');
    expect(s.board.find((c) => c.cardId === 'n3_indy')!.eotTick, 'the new turn Shop did not count').toBe(4);
  });

  it('addCardToShop: a short row takes it in a free slot; a full row replaces the right-most minion, never the Starform', () => {
    const s = run({ shop: [] });
    s.shop = [{ uid: 'x1', cardId: 'n3_rig' }];
    addCardToShop(s, 'n3_goldenmonkey');
    expect(s.shop.map((o) => o.cardId)).toEqual(['n3_rig', 'n3_goldenmonkey']);
    const full = run({ shop: [] });
    const slots = tierSlots(full.tier);
    full.shop = Array.from({ length: slots - 1 }, (_, i) => ({ uid: `m${i}`, cardId: 'n3_rig' }));
    createStarform(full, { cardId: 'test', name: 'test' }); // the token takes the last slot
    expect(full.shop.length).toBe(slots);
    addCardToShop(full, 'n3_goldenmonkey');
    expect(full.shop.length).toBe(slots);
    expect(full.shop.some((o) => o.starform), 'the Starform keeps its slot').toBe(true);
    expect(monkeys(full).length).toBe(1);
  });
});

describe('runes tied to the cards that left set 3 (owner 2026-10-13: "archive them")', () => {
  it('Red Storm + Storming Veins (Set-3-only) are archived; Living Geode left set 3 but stays in Set 2', () => {
    const set3 = runePool('set3');
    const set2 = runePool('set2');
    for (const id of ['rune_red_storm', 'rune_storming_veins', 'rune_living_geode']) {
      expect(set3, id).not.toContain(id);
      expect(RUNE_INDEX[id], id + ' still resolves').toBeTruthy();
    }
    expect(set2).toContain('rune_living_geode');
    expect(set2).not.toContain('rune_red_storm');
  });
});

describe('Golden Monkey: Sell, Discover a minion from the Tier above yours (up to Tier 7)', () => {
  it('at Shop tier 3 it offers Tier 4 minions only', () => {
    const s = sell(run({ tier: 3, board: [body('g', 'n3_goldenmonkey')] }), 'g');
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.tier, id).toBe(4);
    expect(s.discoverGolden).toBeFalsy();
  });

  it('at Shop tier 6 it offers Tier 7; at Tier 7 it stays at 7 (the cap)', () => {
    for (const tier of [6, 7]) {
      const s = sell(run({ tier, board: [body('g', 'n3_goldenmonkey')] }), 'g');
      expect(s.discover?.length, `tier ${tier}`).toBeGreaterThan(0);
      for (const id of s.discover!) expect(CARD_INDEX[id]!.tier, id).toBe(7);
    }
  });

  it('gilded: the offer is gilded', () => {
    const s = sell(run({ tier: 2, board: [body('g', 'n3_goldenmonkey', { golden: true })] }), 'g');
    expect(s.discoverGolden).toBe(true);
  });

  it('live text names the Tier it will offer right now, capped at 7', () => {
    expect(sellDiscoverTierText('n3_goldenmonkey', false, 3)).toBe('**Taunt. Sell:** Discover a minion from the Tier above yours {{(Tier 4)}}.');
    expect(sellDiscoverTierText('n3_goldenmonkey', true, 7)).toContain('{{(Tier 7)}}');
    expect(sellDiscoverTierText('salvatore', false, 3), 'only the tier-offset Sell').toBeNull();
  });
});

describe('Amplification Agnus: all Equipment is Amplified while it is on your board', () => {
  /** Frank (Bloodpot) + a target, optionally Agnus. */
  const armed = (agnus: boolean): RunState => {
    let s = run({ hand: [body('f', 'e3_frank', { health: 400 })], board: [body('t', 'u3_poochy', { health: 400, keywords: [] }), ...(agnus ? [body('ag', 'n3_agnus')] : [])] });
    s = play(s, 'f', 1);
    expect(equipmentState(s).available.map((g) => g.equipmentId)).toContain('bloodpot');
    return act(s, { type: 'selectEquipment', equipmentId: 'bloodpot' } as Action);
  };

  it('without Agnus Bloodpot fires once; with Agnus it fires twice', () => {
    const plain = armed(false);
    expect(equipmentWillAmplify(plain, 'bloodpot')).toBe(false);
    const [a, h] = statsOf(plain, 't');
    expect(statsOf(act(plain, { type: 'activateEquipment', targetUid: 't' }), 't')).toEqual([a + 3, h + 3]);

    const amp = armed(true);
    expect(equipmentAmplifiedByAura(amp)).toBe(true);
    expect(equipmentWillAmplify(amp, 'bloodpot'), 'the slot paints blue').toBe(true);
    expect(statsOf(act(amp, { type: 'activateEquipment', targetUid: 't' }), 't')).toEqual([a + 6, h + 6]);
  });

  it('spends nothing: a banked Amplified stack and a pending Calibration both stay', () => {
    let s = armed(true);
    s.equipment!.amplified = { bloodpot: 1 };
    s.equipment!.calibrationPending = 1;
    const [a, h] = statsOf(s, 't');
    s = act(s, { type: 'activateEquipment', targetUid: 't' });
    expect(statsOf(s, 't'), 'still x2, never x4').toEqual([a + 6, h + 6]);
    expect(equipmentAmplifiedOf(s, 'bloodpot')).toBe(1);
    expect(calibrationPendingOf(s)).toBe(1);
  });

  it('only while on the board: sold, the next activation is plain', () => {
    let s = armed(true);
    s = sell(s, 'ag');
    expect(equipmentAmplifiedByAura(s)).toBe(false);
    expect(equipmentWillAmplify(s, 'bloodpot')).toBe(false);
    const [a, h] = statsOf(s, 't');
    s = act(s, { type: 'activateEquipment', targetUid: 't' });
    expect(statsOf(s, 't')).toEqual([a + 3, h + 3]);
  });
});
