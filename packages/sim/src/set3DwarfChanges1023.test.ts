/**
 * SET 3 DWARF RUNES + MINION CHANGES, owner batch 2026-10-23 (R-DWARF-RUNES-1023-01..02, R-SET3-CHANGES-1023-01):
 *
 *   Basic  Last Call          3  "After you Sell 3 minions, your next Dwarven Ale casts twice."
 *   Epic   Return Customers   3  "The first 2 Dwarves you Sell each turn return a plain copy to your hand"
 *
 *   Mariet     "When you sell 4 minions, get a Dwarven Ale."
 *   Adeptus    T2, "Echo: Give your Shop spells +1 Attack."
 *   Gravus     T6, 10/3 Taunt. "Echo: Give this minion's Attack to 2 friendly minions." (the owner wrote "Gravis")
 *   Shardluck  T5 8/4, "Choose One: Cast 2 Rubies on your Kobolds or cast Veinstorm 2 times."
 *   Thymes     T5, 5/7.
 *
 * Every rune block drives the real engine: the Runeforge `buyRune`, the reducer's `sell` / `play` / `faceOmen`.
 * (Mariet, Adeptus, Gravus and Shardluck behaviour lives in their existing suites: set3SellDwarves1021, set3Undead,
 * set3Dragons1015, rubyTypes.)
 */
import { describe, it, expect } from 'vitest';
import { ALE_IDS } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, spellCasts, type Action, type BoardCard, type RunState } from './index';
import { LAST_CALL_ID, RETURN_CUSTOMERS_PER_TURN } from './recruit';
import { runeTally } from '../../ui/src/runeTally';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
/** A Set 3 run at the Runeforge, the rune bought through the REAL `buyRune` path. */
function withRune(ids: string[], extra: Partial<RunState> = {}, seed = 3): RunState {
  let s = {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set3'),
    tribes: [...SETS.set3.tribes], wave: 7, tier: 6, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])),
  } as RunState;
  for (const id of ids) s = act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 });
  return { ...s, ...extra };
}
/** A full turn flip through the real reducer: fight, settle, resolve, back in the Shop. */
const nextTurn = (s: RunState): RunState => {
  const next = act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
  expect(next.phase).toBe('recruit');
  return { ...next, runeforgeOffer: undefined, embers: 60 } as RunState;
};
/** Distinct plain non-Dwarf bodies (distinct ids, so no three ever triple mid-test). */
const PLAIN = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token && !c.universalTribe && c.tribe === 'neutral' && !c.tribe2 && c.effects.length === 0 && c.keywords.length === 0)
  .map((c) => c.id).filter((id) => !['sylus', 'chronos', 'yazzus'].includes(id));
const plain = (uid: string, i: number): BoardCard => body(uid, PLAIN[i % PLAIN.length]!);
const ALL_TYPES = 'n2_standardbearer'; // a plain All-types body (Rally only)
const ale = (uid: string): BoardCard => body(uid, 'wo_mine'); // "Gain 2 Gold": untargeted, so a cast is easy to count

describe('the two runes as content', () => {
  it('names, costs, pools (Basic vs Epic by array), Dwarf gate, Set 3 only, text, no art', () => {
    const rows: [string, string, number, boolean, string][] = [
      [LAST_CALL_ID, 'Last Call', 3, false, 'After you **Sell 3 minions**, your next **Dwarven Ale** casts twice.'],
      ['rune_return_customers', 'Return Customers', 3, true, 'The first **2 Dwarves** you **Sell** each turn return a plain copy to your hand.'],
    ];
    for (const [id, name, cost, epic, text] of rows) {
      const r = RUNE_INDEX[id]!;
      expect([r.name, r.cost, r.text, r.sets, r.tribes]).toEqual([name, cost, text, ['set3'], ['dwarf']]);
      expect(r.name.startsWith('Rune of'), 'bare rune names (R-RUNE-NAME-01)').toBe(false);
      expect(EPIC_RUNES.some((x) => x.id === id), `${id} Epic pool`).toBe(epic);
      expect(RUNES.some((x) => x.id === id), `${id} Basic pool`).toBe(!epic);
    }
  });
  it('Last Call is the Set 3 twin of the archived Set 2 Last Call (a different id, both resolve)', () => {
    expect(LAST_CALL_ID).not.toBe('rune_last_call');
    expect(RUNE_INDEX['rune_last_call']!.sets).toEqual([]);
  });
});

describe('LAST CALL: After you Sell 3 minions, your next Dwarven Ale casts twice', () => {
  it('the 3rd sale arms it; the next Ale cast from hand casts twice (the x2 previews first); the one after casts once', () => {
    let s = withRune([LAST_CALL_ID]);
    s = { ...s, board: [plain('a', 0), plain('b', 1), plain('c', 2)], hand: [ale('x'), ale('y')] };
    s = act(s, { type: 'sell', uid: 'a' });
    s = act(s, { type: 'sell', uid: 'b' });
    expect(runeTally(s, LAST_CALL_ID)).toBe('2/3');
    expect(s.lastCallArmed).toBeFalsy();
    expect(spellCasts(s, CARD_INDEX['wo_mine']!)).toBe(1);
    s = act(s, { type: 'sell', uid: 'c' });
    expect(s.lastCallArmed).toBe(true);
    expect(runeTally(s, LAST_CALL_ID)).toBe('0/3');
    expect(spellCasts(s, CARD_INDEX['wo_mine']!), 'the hand Ale previews x2').toBe(2);
    let before = s.spellsCast;
    const gold = s.embers;
    s = act(s, { type: 'play', uid: 'x' });
    expect(s.spellsCast - before).toBe(2);
    expect(s.embers - gold, 'Gain 2 Gold, twice').toBe(4);
    expect(s.lastCallArmed).toBeFalsy();
    before = s.spellsCast;
    s = act(s, { type: 'play', uid: 'y' });
    expect(s.spellsCast - before, 'spent: the next Ale casts once').toBe(1);
  });

  it('a non-Ale spell does not spend the charge, and the charge carries across turns until an Ale is cast', () => {
    let s = withRune([LAST_CALL_ID]);
    s = { ...s, board: [plain('a', 0), plain('b', 1), plain('c', 2)] };
    for (const u of ['a', 'b', 'c']) s = act(s, { type: 'sell', uid: u });
    expect(s.lastCallArmed).toBe(true);
    const nonAle = Object.values(CARD_INDEX).find((c) => c.spell && !c.target && !ALE_IDS.includes(c.id) && c.effects.some((e) => e.do === 'gainEmbers'));
    if (nonAle) {
      s = { ...s, hand: [body('n', nonAle.id)] };
      s = act(s, { type: 'play', uid: 'n' });
      expect(s.lastCallArmed, `${nonAle.id} is not an Ale`).toBe(true);
    }
    s = nextTurn(s);
    expect(s.lastCallArmed, 'the charge waits across the turn').toBe(true);
    s = { ...s, hand: [ale('x')] };
    const before = s.spellsCast;
    s = act(s, { type: 'play', uid: 'x' });
    expect(s.spellsCast - before).toBe(2);
  });

  it('one charge waiting at most: 6 sales before any Ale still give ONE doubled Ale; the meter keeps repeating', () => {
    let s = withRune([LAST_CALL_ID]);
    s = { ...s, board: [0, 1, 2, 3, 4, 5].map((i) => plain(`p${i}`, i)), hand: [ale('x'), ale('y')] };
    for (let i = 0; i < 6; i++) s = act(s, { type: 'sell', uid: `p${i}` });
    let before = s.spellsCast;
    s = act(s, { type: 'play', uid: 'x' });
    expect(s.spellsCast - before).toBe(2);
    before = s.spellsCast;
    s = act(s, { type: 'play', uid: 'y' });
    expect(s.spellsCast - before).toBe(1);
  });

  it('no rune: no charge, an Ale casts once', () => {
    let s = withRune([]);
    s = { ...s, board: [plain('a', 0), plain('b', 1), plain('c', 2)], hand: [ale('x')] };
    for (const u of ['a', 'b', 'c']) s = act(s, { type: 'sell', uid: u });
    const before = s.spellsCast;
    s = act(s, { type: 'play', uid: 'x' });
    expect(s.spellsCast - before).toBe(1);
  });
});

describe('RETURN CUSTOMERS: The first 2 Dwarves you Sell each turn return a plain copy to your hand', () => {
  const copiesOf = (s: RunState, id: string) => s.hand.filter((c) => c.cardId === id);

  it('the first 2 Dwarves sold each return a PLAIN copy (gilded and buffed sales come back base); the 3rd does not', () => {
    let s = withRune(['rune_return_customers']);
    const k = CARD_INDEX['dw3_kneel']!;
    s = { ...s, board: [
      body('k', 'dw3_kneel', { golden: true, attack: k.attack * 2 + 7, health: k.health * 2 + 7, buffs: [{ source: 'Test', attack: 7, health: 7, count: 1 }] }),
      body('b', 'dw_brunni'), body('t', 'dw3_tankerchief'),
    ] };
    expect(runeTally(s, 'rune_return_customers')).toBe(`0/${RETURN_CUSTOMERS_PER_TURN}`);
    s = act(s, { type: 'sell', uid: 'k' });
    const back = copiesOf(s, 'dw3_kneel');
    expect(back).toHaveLength(1);
    expect(back[0]!.golden).toBe(false);
    expect([back[0]!.attack, back[0]!.health]).toEqual([k.attack, k.health]);
    expect(back[0]!.buffs ?? []).toHaveLength(0);
    expect(runeTally(s, 'rune_return_customers')).toBe('1/2');
    s = act(s, { type: 'sell', uid: 'b' });
    expect(copiesOf(s, 'dw_brunni')).toHaveLength(1);
    expect(runeTally(s, 'rune_return_customers')).toBe('2/2');
    s = act(s, { type: 'sell', uid: 't' });
    expect(copiesOf(s, 'dw3_tankerchief'), 'only the first 2 each turn').toHaveLength(0);
  });

  it('a non-Dwarf sale returns nothing and does not use up a slot; an All-types body counts as a Dwarf', () => {
    let s = withRune(['rune_return_customers']);
    s = { ...s, board: [plain('n', 0), body('u', ALL_TYPES), body('k', 'dw3_kneel'), body('b', 'dw_brunni')] };
    s = act(s, { type: 'sell', uid: 'n' });
    expect(s.hand).toHaveLength(0);
    expect(s.returnCustomersThisTurn ?? 0).toBe(0);
    s = act(s, { type: 'sell', uid: 'u' });
    expect(copiesOf(s, ALL_TYPES), 'All-types counts as a Dwarf').toHaveLength(1);
    s = act(s, { type: 'sell', uid: 'k' });
    expect(copiesOf(s, 'dw3_kneel')).toHaveLength(1);
    s = act(s, { type: 'sell', uid: 'b' });
    expect(copiesOf(s, 'dw_brunni')).toHaveLength(0);
  });

  it('resets each turn', () => {
    let s = withRune(['rune_return_customers']);
    s = { ...s, board: [body('k', 'dw3_kneel'), body('b', 'dw_brunni')] };
    s = act(s, { type: 'sell', uid: 'k' });
    s = act(s, { type: 'sell', uid: 'b' });
    expect(runeTally(s, 'rune_return_customers')).toBe('2/2');
    s = nextTurn(s);
    expect(runeTally(s, 'rune_return_customers')).toBe('0/2');
    s = { ...s, hand: [], board: [body('t', 'dw3_tankerchief')] };
    s = act(s, { type: 'sell', uid: 't' });
    expect(copiesOf(s, 'dw3_tankerchief')).toHaveLength(1);
  });

  it('respects the hand cap: a full hand gets nothing', () => {
    let s = withRune(['rune_return_customers']);
    s = { ...s, board: [body('k', 'dw3_kneel')], hand: Array.from({ length: CONFIG.handMax }, (_, i) => plain(`h${i}`, i)) };
    s = act(s, { type: 'sell', uid: 'k' });
    expect(s.hand).toHaveLength(CONFIG.handMax);
    expect(copiesOf(s, 'dw3_kneel')).toHaveLength(0);
  });

  it('no rune: a sold Dwarf returns nothing', () => {
    let s = withRune([]);
    s = { ...s, board: [body('k', 'dw3_kneel')] };
    s = act(s, { type: 'sell', uid: 'k' });
    expect(s.hand).toHaveLength(0);
  });
});

describe('minion changes (owner 2026-10-23)', () => {
  it('tiers, stats and keywords', () => {
    expect(CARD_INDEX['dw3_thymes']).toMatchObject({ tier: 5, attack: 5, health: 7 });
    expect(CARD_INDEX['d3_gravus']).toMatchObject({ tier: 6, attack: 10, health: 3, tribe: 'dragon', tribe2: 'undead' });
    expect(CARD_INDEX['d3_gravus']!.keywords).toContain('T');
    expect(CARD_INDEX['d3_gravus']!.text).toBe("**Taunt.** **Echo:** Give this minion's **Attack** to **2** friendly minions.");
    expect(CARD_INDEX['u3_adeptus']).toMatchObject({ tier: 2, attack: 4, health: 1 });
    expect(CARD_INDEX['k3_facetbound']).toMatchObject({ tier: 5, attack: 8, health: 4 });
    expect(CARD_INDEX['dw3_marketing']!.text).toBe('When you **Sell** **4 minions**, get a **Dwarven Ale**.');
  });
});
