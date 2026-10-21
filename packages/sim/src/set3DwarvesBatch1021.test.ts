/**
 * SET 3 DWARVES — owner batch 2026-10-21 ("create these set 3 dwarf minions and wire their art"):
 *
 *   Coin Counter    T1 1/3  "After you play a Dwarf, gain +1/+1."
 *   Keg Runner      T2 3/2  "Sell: Gain 2 additional Gold."
 *   Champion Inu    T5 6/8  "After you cast a Dwarven Ale, give your Dwarves +2/+2."
 *   Foamguard       T5 4/8  "Taunt. Ward. The first time this loses Ward each combat, gain +10/+10 and Ward."
 *
 * Pinned here: each card's data and pool membership, the trigger's real gate (a PLAY not a summon; an Ale not any
 * spell; a real Ward break, once per combat), gilded doubling, All-types counting as a Dwarf, and Champion Inu in
 * BOTH phases (a Dwarven Ale can be cast mid-fight). R-DWARF-1021-01 in the oracle.
 */
import { describe, it, expect } from 'vitest';
import { ALE_IDS, combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { noteSpellCast } from './recruit';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: ['kobold', 'dwarf', 'undead', 'spirit', 'dragon'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), recruitBuffFx: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (cards: readonly BoardCard[], uid: string): BoardCard => cards.find((c) => c.uid === uid)!;
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const ALL_TYPES = Object.values(CARD_INDEX).find((c) => c.universalTribe && !c.spell && !c.token && !c.keywords.includes('M'))!;
/** Combat re-keys uids (m0, m1…): find a body's combat uid by its card id from the opening snapshot. */
const uidOf = (r: { initial: { player: readonly { uid: string; cardId: string }[] } }, cardId: string): string =>
  r.initial.player.find((m) => m.cardId === cardId)!.uid;
const NON_DWARF = 'u3_poochy';

describe('the cards', () => {
  it.each([
    ['dw3_coincounter', 'Coin Counter', 1, 1, 3],
    ['dw3_kegrunner', 'Keg Runner', 2, 3, 2],
    ['dw3_championinu', 'Champion Inu', 5, 6, 8],
    ['dw3_foamguard', 'Foamguard', 5, 4, 8],
  ] as const)('%s is a Set 3 Dwarf (%s, T%i %i/%i) in the buyable pool', (id, name, tier, attack, health) => {
    expect(CARD_INDEX[id]).toMatchObject({ name, tribe: 'dwarf', tier, attack, health });
    expect(poolFor('set3').buyable.some((c) => c.id === id)).toBe(true);
  });
  it('Foamguard starts with Taunt and Ward', () => {
    expect(CARD_INDEX['dw3_foamguard']!.keywords).toEqual(['T', 'DS']);
  });
  it('a non-Dwarf probe really is a non-Dwarf', () => {
    expect(CARD_INDEX[NON_DWARF]!.tribe).not.toBe('dwarf');
    expect(CARD_INDEX[NON_DWARF]!.tribe2).toBeUndefined();
  });
});

describe('COIN COUNTER — after you play a Dwarf, gain +1/+1', () => {
  it('playing a Dwarf grows it +1/+1, permanently (a shop gain)', () => {
    let s = run({ board: [body('cc', 'dw3_coincounter')], hand: [body('d', 'dw3_striker')] });
    s = act(s, { type: 'play', uid: 'd' });
    expect(stats(at(s.board, 'cc'))).toEqual([2, 4]);
    expect(at(s.board, 'cc').buffs?.find((b) => b.source === 'Coin Counter')).toMatchObject({ attack: 1, health: 1 });
  });
  it('a non-Dwarf play does nothing', () => {
    let s = run({ board: [body('cc', 'dw3_coincounter')], hand: [body('n', NON_DWARF)] });
    s = act(s, { type: 'play', uid: 'n' });
    expect(stats(at(s.board, 'cc'))).toEqual([1, 3]);
  });
  it('an All-types minion counts as a Dwarf', () => {
    expect(ALL_TYPES, 'an All-types minion exists').toBeTruthy();
    let s = run({ board: [body('cc', 'dw3_coincounter')], hand: [body('a', ALL_TYPES.id)] });
    s = act(s, { type: 'play', uid: 'a' });
    expect(at(s.board, 'cc').buffs?.find((b) => b.source === 'Coin Counter')).toMatchObject({ attack: 1, health: 1 });
  });
  it('its own play does not count, and gilded doubles (+2/+2)', () => {
    let s = run({ board: [], hand: [body('cc', 'dw3_coincounter', { golden: true, attack: 2, health: 6 }), body('d', 'dw3_striker')] });
    s = act(s, { type: 'play', uid: 'cc' });
    expect(stats(at(s.board, 'cc')), 'own play: no gain').toEqual([2, 6]);
    s = act(s, { type: 'play', uid: 'd' });
    expect(stats(at(s.board, 'cc'))).toEqual([4, 8]);
  });
  it('in HAND it stays asleep (a board watcher), and Dozer the hand watcher still only grows in hand', () => {
    let s = run({ board: [], hand: [body('cc', 'dw3_coincounter'), body('dz', 'sp3_slumbering'), body('d', 'dw3_striker'), body('sp', 'sp3_seedling')] });
    s = act(s, { type: 'play', uid: 'd' });
    expect(stats(at(s.hand, 'cc'))).toEqual([1, 3]);
    s = act(s, { type: 'play', uid: 'sp' });
    expect(stats(at(s.hand, 'dz')), 'Dozer +4/+4 in hand').toEqual([CARD_INDEX['sp3_slumbering']!.attack + 4, CARD_INDEX['sp3_slumbering']!.health + 4]);
  });
});

describe('KEG RUNNER — Sell: gain 2 additional Gold', () => {
  const sellGold = (cardId: string, golden = false): number => {
    const s0 = run({ embers: 0, board: [body('k', cardId, { golden })], hand: [] });
    return act(s0, { type: 'sell', uid: 'k' }).embers - s0.embers;
  };
  it('pays 2 more than a plain sell, 4 more gilded', () => {
    const plain = sellGold('dw3_striker');
    const plainGolden = sellGold('dw3_striker', true);
    expect(sellGold('dw3_kegrunner') - plain).toBe(2);
    expect(sellGold('dw3_kegrunner', true) - plainGolden).toBe(4);
  });
});

describe('CHAMPION INU — after you cast a Dwarven Ale, give your Dwarves +2/+2', () => {
  it('SHOP: an Ale cast gives every Dwarf (itself and All-types included) +2/+2, never a non-Dwarf', () => {
    const s = run({ board: [body('inu', 'dw3_championinu'), body('d', 'dw3_striker'), body('a', ALL_TYPES.id), body('n', NON_DWARF)] });
    noteSpellCast(s, CARD_INDEX['wo_mine']!); // a Dwarven Ale whose own cast touches no board stats
    const src = (uid: string) => at(s.board, uid).buffs?.find((b) => b.source === 'Champion Inu');
    expect(src('inu'), 'itself').toMatchObject({ attack: 2, health: 2 });
    expect(src('d')).toMatchObject({ attack: 2, health: 2 });
    expect(src('a'), 'All-types').toMatchObject({ attack: 2, health: 2 });
    expect(src('n'), 'not a Dwarf').toBeUndefined();
  });
  it('SHOP: every Ale counts, a non-Ale Shop spell does not', () => {
    for (const id of ALE_IDS) {
      const s = run({ board: [body('inu', 'dw3_championinu')] });
      noteSpellCast(s, CARD_INDEX[id]!);
      expect(at(s.board, 'inu').buffs?.find((b) => b.source === 'Champion Inu'), id).toMatchObject({ attack: 2, health: 2 });
    }
    const s = run({ board: [body('inu', 'dw3_championinu')] });
    noteSpellCast(s, CARD_INDEX['emberpouch']!);
    expect(stats(at(s.board, 'inu'))).toEqual([6, 8]);
  });
  it('SHOP: a hand-played Ale through the reducer, gilded doubles (+4/+4)', () => {
    let s = run({ board: [body('inu', 'dw3_championinu', { golden: true, attack: 12, health: 16 })], hand: [body('ale', 'wo_mine', { tribe: 'neutral', attack: 0, health: 1 })] });
    s = act(s, { type: 'play', uid: 'ale' });
    expect(stats(at(s.board, 'inu'))).toEqual([16, 20]);
  });

  it('SHOP: Edward Keg-hands makes a hand-cast Ale trigger twice, so Champion Inu pays twice', () => {
    let s = run({ board: [body('inu', 'dw3_championinu'), body('ed', 'dw_edward')], hand: [body('ale', 'wo_mine', { tribe: 'neutral', attack: 0, health: 1 })] });
    s = act(s, { type: 'play', uid: 'ale' });
    expect(stats(at(s.board, 'inu'))).toEqual([6 + 4, 8 + 4]);
  });

  // COMBAT: a probe Rally caster casts a Dwarven Ale for real through `castInCombat`.
  const caster = (spellId: string): CardDef => ({
    id: `inu_caster_${spellId}`, name: 'Ale Caster', tribe: 'neutral', tier: 1, attack: 1, health: 80, keywords: ['RL'],
    effects: [{ on: 'onAttack', do: 'rallyCastNamedSpell', params: { spellId } }], text: '**Rally:** cast a spell.',
  });
  const fight = (spellId: string, golden = false) => {
    const c = caster(spellId);
    const cards: Record<string, CardDef> = { ...CARD_INDEX, [c.id]: c };
    const bm = (uid: string, cardId: string, attack: number, health: number, g = false): BoardMinion =>
      ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...cards[cardId]!.keywords], golden: g } as unknown as BoardMinion);
    return simulate(
      [bm('cx', c.id, 1, 80), bm('inu', 'dw3_championinu', golden ? 12 : 6, 500, golden)],
      [bm('sb', 'sandbag', 0, 200)], makeRng(3), cards, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
  };
  const inuBuffs = (events: readonly CombatEvent[]) =>
    events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && (e as { srcCard?: string }).srcCard === 'dw3_championinu');
  const casts = (events: readonly CombatEvent[]) => events.filter((e) => e.type === 'spellcast' && e.side === 'player').length;

  it('COMBAT: each Ale cast mid-fight buffs the Dwarves +2/+2; gilded +4/+4', () => {
    const r = fight('wo_mine');
    const n = casts(r.events);
    expect(n, 'the probe cast').toBeGreaterThan(0);
    expect(inuBuffs(r.events).map((e) => e.attack)).toEqual(Array(n).fill(2));
    const g = fight('wo_mine', true);
    expect(inuBuffs(g.events).map((e) => e.attack)).toEqual(Array(casts(g.events)).fill(4));
  });
  it('COMBAT: a non-Ale spell cast mid-fight does nothing', () => {
    const r = fight('growth');
    expect(casts(r.events)).toBeGreaterThan(0);
    expect(inuBuffs(r.events)).toEqual([]);
  });
});

describe('FOAMGUARD — the first Ward loss each combat: +10/+10 and Ward', () => {
  const bm = (uid: string, cardId: string, attack: number, health: number, golden = false): BoardMinion =>
    ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...CARD_INDEX[cardId]!.keywords], golden } as unknown as BoardMinion);
  const fight = (golden = false) => simulate(
    [bm('fg', 'dw3_foamguard', golden ? 8 : 4, golden ? 16 : 8, golden)],
    [bm('h1', 'sandbag', 1, 300)], makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));

  it('the first break buffs +10/+10 and re-wards; the second break does not', () => {
    const r = fight();
    const ev = r.events;
    const fg = uidOf(r, 'dw3_foamguard');
    const breaks = ev.map((e, i) => [e, i] as const).filter(([e]) => e.type === 'shield' && e.target === fg);
    expect(breaks.length, 'the Ward broke twice (once regained)').toBeGreaterThanOrEqual(2);
    const ups = ev.filter((e) => e.type === 'shieldUp' && e.target === fg);
    expect(ups.length, 'one regain only').toBe(1);
    const gains = ev.filter((e) => e.type === 'buff' && e.target === fg && e.attack === 10 && e.health === 10);
    expect(gains.length, 'one +10/+10 only').toBe(1);
    // Order: break → buff → Ward back, all before the second break.
    const iBuff = ev.indexOf(gains[0]!);
    const iUp = ev.indexOf(ups[0]!);
    expect(breaks[0]![1]).toBeLessThan(iBuff);
    expect(iBuff).toBeLessThan(iUp);
    expect(iUp).toBeLessThan(breaks[1]![1]);
  });
  it('gilded doubles the stats (+20/+20), still one regain', () => {
    const r = fight(true);
    const fg = uidOf(r, 'dw3_foamguard');
    expect(r.events.filter((e) => e.type === 'buff' && e.target === fg && e.attack === 20 && e.health === 20).length).toBe(1);
    expect(r.events.filter((e) => e.type === 'shieldUp' && e.target === fg).length).toBe(1);
  });
  it('the gain is combat-only (no permanent carry-back)', () => {
    const r = fight();
    expect((r.playerPermaBuffs ?? [])).toEqual([]);
  });
});
