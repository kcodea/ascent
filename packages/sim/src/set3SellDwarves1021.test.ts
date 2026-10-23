/**
 * SET 3 SELL DWARVES, owner batch 2026-10-21:
 *
 *   Sailsey  T2 3/1  "Sell: Give your Dwarves +2/+3."
 *   Mariet     T3 2/6  "When you Sell 4 minions, get a random Shop Spell."
 *   Valyou         T5 6/9  "When you Sell a minion, gain +3/+3. Every 4 triggers also grants 2 Gold."
 *   Leeds          T6 6/8  "When you play a Dwarf, give your Dwarves +2/+2. Improves when you Sell 4 minions."
 *
 * Pinned here: each card's trigger, Gilded (stats, Gold and the spell count double; Mariet follows Runic Archivist,
 * two spells per payout rather than a halved counter), All-types counting as a Dwarf, and the per-instance sale meters
 * carrying across a turn boundary.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { ALE_IDS } from '@game/core';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { runSpells } from './spellPool';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: [...SETS.set3.tribes],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), recruitBuffFx: [], hand: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const buffFrom = (c: BoardCard, source: string) => (c.buffs ?? []).filter((b) => b.source === source);
const sumFrom = (c: BoardCard, source: string) =>
  buffFrom(c, source).reduce((t, b) => ({ attack: t.attack + b.attack, health: t.health + b.health }), { attack: 0, health: 0 });
/** End the turn and come back to a fresh Shop phase (the meters must survive it). */
const nextTurn = (s: RunState): RunState => ({ ...act(s, { type: 'faceOmen' }), phase: 'recruit', embers: 30 } as RunState);
const ALL_TYPES = CARD_INDEX['n2_standardbearer']!; // a plain All-types body (Rally only)
/** Distinct plain non-Dwarf bodies to sell (distinct ids, so no three of a kind ever merge into a triple). */
const FODDER_IDS = Object.values(CARD_INDEX)
  .filter((c) => !c.spell && !c.universalTribe && c.tribe !== 'dwarf' && c.tribe2 !== 'dwarf' && c.tier <= 3 && c.effects.length === 0 && !c.ruby && !c.keywords.includes('M') && !/Choose One|Discover|Shout|Magnetic/.test(c.text))
  .map((c) => c.id);
let fodderN = 0;
const FODDER = (uid: string) => body(uid, FODDER_IDS[fodderN++ % FODDER_IDS.length]!);

it('has enough distinct plain fodder to sell', () => expect(FODDER_IDS.length).toBeGreaterThanOrEqual(6)); // every fodder in a test is a different card, so none can triple

describe('the four Sell Dwarves are new Set 3 cards with the owner stats', () => {
  it.each([
    ['dw3_salezarsails', 'Sailsey', 2, 3, 1],
    ['dw3_marketing', 'Mariet', 3, 2, 6],
    ['dw3_valyou', 'Valyou', 5, 6, 9],
    ['dw3_leeds', 'Leeds', 6, 6, 8],
  ] as const)('%s', (id, name, tier, attack, health) => {
    expect(CARD_INDEX[id]).toMatchObject({ name, tier, attack, health, tribe: 'dwarf' });
    expect(CARD_INDEX[id]!.token).toBeFalsy();
    expect(poolFor('set3').buyable.some((c) => c.id === id), 'drawable in Set 3').toBe(true);
    expect(poolFor('set2').all.some((c) => c.id === id), 'not a Set 2 card').toBe(false);
    expect(CARD_INDEX[id]!.text).toMatch(/\*\*Sell[*:]/);
  });
});

describe('SAILSEY: Sell: Give your Dwarves +2/+3', () => {
  it('selling it buffs your other Dwarves (and an All-types), never a non-Dwarf, never itself', () => {
    let s = run({ board: [body('z', 'dw3_salezarsails'), body('a', 'dw_brunni'), body('u', ALL_TYPES.id), FODDER('n')] });
    s = act(s, { type: 'sell', uid: 'z' });
    expect(s.board.some((c) => c.uid === 'z')).toBe(false);
    expect(sumFrom(at(s, 'a'), 'Sailsey')).toEqual({ attack: 2, health: 3 });
    expect(sumFrom(at(s, 'u'), 'Sailsey'), 'All-types counts as a Dwarf').toEqual({ attack: 2, health: 3 });
    expect(buffFrom(at(s, 'n'), 'Sailsey')).toHaveLength(0);
    expect(at(s, 'a').attack).toBe(CARD_INDEX['dw_brunni']!.attack + 2); // a permanent Shop buff
  });

  it('Gilded gives +4/+6', () => {
    let s = run({ board: [body('z', 'dw3_salezarsails', { golden: true }), body('a', 'dw_brunni')] });
    s = act(s, { type: 'sell', uid: 'z' });
    expect(sumFrom(at(s, 'a'), 'Sailsey')).toEqual({ attack: 4, health: 6 });
  });

  it('selling ANOTHER minion does nothing (it is its own Sell)', () => {
    let s = run({ board: [body('z', 'dw3_salezarsails'), body('a', 'dw_brunni'), FODDER('n')] });
    s = act(s, { type: 'sell', uid: 'n' });
    expect(buffFrom(at(s, 'a'), 'Sailsey')).toHaveLength(0);
  });
});

describe('MARIET: every 4 minions you Sell, get a Dwarven Ale (owner 2026-10-23; was a random Shop Spell)', () => {
  const legal = (s: RunState) => new Set(runSpells(s).filter((c) => ALE_IDS.includes(c.id)).map((c) => c.id));

  it('pays one Dwarven Ale from the run\'s pool on the 4th sale, not before; the meter carries across a turn', () => {
    let s = run({ board: [body('m', 'dw3_marketing'), FODDER('a'), FODDER('b'), FODDER('c'), FODDER('d'), FODDER('e')] });
    s = act(s, { type: 'sell', uid: 'a' });
    s = act(s, { type: 'sell', uid: 'b' });
    expect(at(s, 'm').soldProgress).toBe(2);
    s = nextTurn(s);
    expect(at(s, 'm').soldProgress, 'the meter carries round to round').toBe(2);
    s = act(s, { type: 'sell', uid: 'c' });
    expect(s.hand).toHaveLength(0);
    s = act(s, { type: 'sell', uid: 'd' });
    expect(s.hand).toHaveLength(1);
    const got = CARD_INDEX[s.hand[0]!.cardId]!;
    expect(got.spell).toBe(true);
    expect(got.token).toBeFalsy();
    expect(ALE_IDS, `${got.id} is a Dwarven Ale`).toContain(got.id);
    expect(legal(s).has(got.id), `${got.id} is in the run's Ale pool`).toBe(true);
    expect(at(s, 'm').soldProgress, 'the payout consumes the threshold').toBe(0);
  });

  it('Gilded gets 2 Dwarven Ales per payout (the Runic Archivist convention), still every 4 sales', () => {
    let s = run({ board: [body('m', 'dw3_marketing', { golden: true }), FODDER('a'), FODDER('b'), FODDER('c'), FODDER('d')] });
    for (const u of ['a', 'b', 'c']) s = act(s, { type: 'sell', uid: u });
    expect(s.hand).toHaveLength(0);
    s = act(s, { type: 'sell', uid: 'd' });
    expect(s.hand).toHaveLength(2);
    for (const h of s.hand) expect(ALE_IDS).toContain(h.cardId);
  });

  it('selling Mariet itself does not count', () => {
    let s = run({ board: [body('m', 'dw3_marketing'), FODDER('a')] });
    s = act(s, { type: 'sell', uid: 'm' });
    expect(s.hand).toHaveLength(0);
  });
});

describe('VALYOU: +3/+3 per Sell, every 4 triggers also 2 Gold', () => {
  const sellDelta = (s: RunState, uid: string): [RunState, number] => {
    const before = s.embers;
    const next = act(s, { type: 'sell', uid });
    return [next, next.embers - before];
  };

  it('gains +3/+3 per sale permanently, and the 4th sale pays 2 extra Gold; the meter carries across a turn', () => {
    let s = run({ board: [body('v', 'dw3_valyou'), FODDER('a'), FODDER('b'), FODDER('c'), FODDER('d'), FODDER('e')] });
    const d: number[] = [];
    const sell = (uid: string) => { const [next, delta] = sellDelta(s, uid); s = next; d.push(delta); };
    sell('a');
    sell('b');
    expect(at(s, 'v').soldProgress).toBe(2);
    s = nextTurn(s);
    expect(at(s, 'v').soldProgress, 'carries round to round').toBe(2);
    sell('c');
    sell('d');
    expect(d[2]).toBe(d[0]);
    expect(d[3]! - d[2]!, 'the 4th trigger grants 2 Gold').toBe(2);
    expect(sumFrom(at(s, 'v'), 'Valyou')).toEqual({ attack: 12, health: 12 });
    expect(at(s, 'v').attack).toBe(6 + 12);
    expect(at(s, 'v').soldProgress).toBe(0);
  });

  it('Gilded: +6/+6 per sale and 4 Gold every 4 triggers', () => {
    let s = run({ board: [body('v', 'dw3_valyou', { golden: true }), FODDER('a'), FODDER('b'), FODDER('c'), FODDER('d')] });
    let d3 = 0, d4 = 0;
    for (const u of ['a', 'b']) [s] = sellDelta(s, u);
    [s, d3] = sellDelta(s, 'c');
    [s, d4] = sellDelta(s, 'd');
    expect(d4 - d3).toBe(4);
    expect(sumFrom(at(s, 'v'), 'Valyou')).toEqual({ attack: 24, health: 24 });
  });
});

describe('LEEDS: when you play a Dwarf, give your Dwarves +2/+2; improves every 4 Sells', () => {
  it('a Dwarf play buffs every Dwarf on board (itself, the played one, an All-types), never a non-Dwarf', () => {
    let s = run({ board: [body('l', 'dw3_leeds'), body('a', 'dw_brunni'), body('u', ALL_TYPES.id), FODDER('n')], hand: [body('d', 'dw_brakka')] });
    s = act(s, { type: 'play', uid: 'd' });
    for (const u of ['l', 'a', 'u', 'd']) expect(sumFrom(at(s, u), 'Leeds'), u).toEqual({ attack: 2, health: 2 });
    expect(buffFrom(at(s, 'n'), 'Leeds')).toHaveLength(0);
  });

  it('a non-Dwarf play does nothing; an All-types play counts as a Dwarf; its own play does not trigger it', () => {
    let s = run({ board: [body('l', 'dw3_leeds'), body('a', 'dw_brunni')], hand: [FODDER('n'), body('u', ALL_TYPES.id), body('l2', 'dw3_leeds')] });
    s = act(s, { type: 'play', uid: 'n' });
    expect(buffFrom(at(s, 'a'), 'Leeds')).toHaveLength(0);
    s = act(s, { type: 'play', uid: 'u' });
    expect(sumFrom(at(s, 'a'), 'Leeds')).toEqual({ attack: 2, health: 2 });
    // A second Leeds arriving: the board Leeds hears it (a Dwarf play), the arriving one stays silent for itself.
    s = act(s, { type: 'play', uid: 'l2' });
    expect(sumFrom(at(s, 'a'), 'Leeds')).toEqual({ attack: 4, health: 4 });
  });

  it('improves by +2/+2 every 4 minions Sold while on board, across turns', () => {
    let s = run({ board: [body('l', 'dw3_leeds'), body('a', 'dw_brunni'), FODDER('f1'), FODDER('f2'), FODDER('f3'), FODDER('f4')],
      hand: [body('d1', 'dw_brakka'), body('d2', 'dw_dorrin')] });
    s = act(s, { type: 'sell', uid: 'f1' });
    s = act(s, { type: 'sell', uid: 'f2' });
    s = nextTurn(s);
    expect(at(s, 'l').soldProgress, 'the Sell meter carries round to round').toBe(2);
    s = act(s, { type: 'sell', uid: 'f3' });
    s = act(s, { type: 'play', uid: 'd1' });
    expect(sumFrom(at(s, 'a'), 'Leeds'), 'three sales: still the base grant').toEqual({ attack: 2, health: 2 });
    s = act(s, { type: 'sell', uid: 'f4' });
    s = act(s, { type: 'play', uid: 'd2' });
    expect(sumFrom(at(s, 'a'), 'Leeds'), 'four sales: +4/+4 on top').toEqual({ attack: 6, health: 6 });
  });

  it('Gilded: +4/+4, improving to +8/+8', () => {
    let s = run({ board: [body('l', 'dw3_leeds', { golden: true }), body('a', 'dw_brunni'), FODDER('f1'), FODDER('f2'), FODDER('f3'), FODDER('f4')],
      hand: [body('d1', 'dw_brakka'), body('d2', 'dw_dorrin')] });
    s = act(s, { type: 'play', uid: 'd1' });
    expect(sumFrom(at(s, 'a'), 'Leeds')).toEqual({ attack: 4, health: 4 });
    for (const u of ['f1', 'f2', 'f3', 'f4']) s = act(s, { type: 'sell', uid: u });
    s = act(s, { type: 'play', uid: 'd2' });
    expect(sumFrom(at(s, 'a'), 'Leeds')).toEqual({ attack: 12, health: 12 });
  });

  it('a Leeds in hand neither counts sales nor fires', () => {
    let s = run({ board: [body('a', 'dw_brunni'), FODDER('f1')], hand: [body('l', 'dw3_leeds'), body('d', 'dw_brakka')] });
    s = act(s, { type: 'sell', uid: 'f1' });
    expect(s.hand.find((c) => c.uid === 'l')!.soldProgress).toBeUndefined();
    s = act(s, { type: 'play', uid: 'd' });
    expect(buffFrom(at(s, 'a'), 'Leeds')).toHaveLength(0);
  });
});
