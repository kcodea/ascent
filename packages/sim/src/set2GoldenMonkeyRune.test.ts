import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNES, EPIC_RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type RunState } from './index';
import { advanceRuneThresholds, offerBuyStats } from './recruit';
import { runeTally } from '../../ui/src/runeTally';

/**
 * GOLDEN MONKEY (Set 2 Basic rune, owner addition 2026-11-13): "Every 5 Refreshes, replace a minion in your Shop with
 * a Golden Monkey." Indy's Golden Monkey mechanic (Set 3 `n3_indy`), on Indy's meter (only a Refresh the player
 * presses, a free one included; the turn's fresh row does not count), but the Monkey REPLACES a random Shop minion
 * instead of being added. Rule R-SET2-RUNE-GOLDENMONKEY-01.
 */

const MONKEY = 'n3_goldenmonkey';
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
function run(tier = 3, seed = 13): RunState {
  return {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
}
const take = (s: RunState, id: string): RunState =>
  ({ ...act({ ...s, runeforgeOffer: [id], runeforgeEpic: false }, { type: 'buyRune', index: 0 }), embers: 60, discover: undefined, discoverQueue: undefined });
const withRunes = (ids: string[], tier = 3, seed = 13) => ids.reduce(take, run(tier, seed));
const roll = (s: RunState): RunState => act({ ...s, embers: 60 }, { type: 'roll' });
const rolls = (s: RunState, n: number): RunState => { for (let i = 0; i < n; i++) s = roll(s); return s; };
const monkeys = (s: RunState) => s.shop.filter((o) => o.cardId === MONKEY);
const minions = (s: RunState) => s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !o.starform; });

describe('Golden Monkey: content', () => {
  it('a Basic neutral rune, 2 Gold, Set 2 only, the text, Indy\'s token', () => {
    const r = RUNE_INDEX['rune_golden_monkey']!;
    expect(RUNES.includes(r)).toBe(true);
    expect(EPIC_RUNES.includes(r)).toBe(false);
    expect([r.name, r.cost, !!r.epic, r.tribes, r.sets]).toEqual(['Golden Monkey', 2, false, undefined, ['set2']]);
    expect(r.text).toBe('Every **5** Refreshes, replace a minion in your Shop with a **Golden Monkey**.');
    expect(r.reward).toEqual({ kind: 'runeThreshold', meter: 'refresh', per: 5, replaceShopWith: MONKEY });
    expect(CARD_INDEX[MONKEY]!.name).toBe('Golden Monkey');
  });
});

describe('Golden Monkey: the meter and the replace', () => {
  it('fires on the 5th and 10th Refresh, not before; the badge counts N/5 live', () => {
    let s = withRunes(['rune_golden_monkey']);
    expect(runeTally(s, 'rune_golden_monkey')).toBe('0/5');
    s = rolls(s, 4);
    expect(monkeys(s)).toHaveLength(0);
    expect(runeTally(s, 'rune_golden_monkey')).toBe('4/5');
    s = roll(s);
    expect(monkeys(s)).toHaveLength(1);
    expect(runeTally(s, 'rune_golden_monkey')).toBe('0/5');
    s = rolls(s, 4);
    // The 6th to 9th Refreshes rebuild the row (the Monkey is not kept), and none adds one.
    expect(monkeys(s)).toHaveLength(0);
    s = roll(s);
    expect(monkeys(s)).toHaveLength(1);
  });

  it('it REPLACES a minion: the row keeps its size and the Monkey sits in the replaced slot', () => {
    let s = rolls(withRunes(['rune_golden_monkey']), 4);
    // Compare the 5th Refresh with and without the rune from the same state: the rows match except for one slot.
    const plain = roll({ ...s, runeThresholds: [] });
    s = roll(s);
    expect(s.shop.length).toBe(plain.shop.length);
    const diff = s.shop.map((o, i) => (o.cardId === plain.shop[i]!.cardId ? -1 : i)).filter((i) => i >= 0);
    expect(diff).toHaveLength(1);
    expect(s.shop[diff[0]!]!.cardId).toBe(MONKEY);
  });

  it('the turn\'s fresh row does not count (only a pressed Refresh, like Indy); a frozen Shop carries the meter', () => {
    let s = rolls(withRunes(['rune_golden_monkey']), 3);
    s = act(s, { type: 'freeze' });
    s = act(act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
    expect(runeTally(s, 'rune_golden_monkey')).toBe('3/5');
    s = rolls(s, 2);
    expect(monkeys(s)).toHaveLength(1);
  });

  it('an empty Shop (every minion bought): the Monkey fills a free slot instead', () => {
    const s = rolls(withRunes(['rune_golden_monkey'], 2), 4);
    // Every minion bought: only non-minions (if any) remain in the row. The 5th press's meter tick lands on it.
    s.shop = s.shop.filter((o) => !minions(s).includes(o));
    advanceRuneThresholds(s, 'refresh', 1);
    expect(minions(s).map((o) => o.cardId)).toEqual([MONKEY]);
  });

  it('two copies: each holds its own meter, so the 5th Refresh swaps in TWO Monkeys', () => {
    const s = rolls(withRunes(['rune_golden_monkey', 'rune_golden_monkey']), 5);
    expect(monkeys(s)).toHaveLength(2);
  });

  it('deterministic from the seed', () => {
    const go = () => rolls(withRunes(['rune_golden_monkey'], 3, 29), 5).shop.map((o) => o.cardId);
    expect(go()).toEqual(go());
    expect(go()).toContain(MONKEY);
  });
});

describe('Golden Monkey x Shop Madness', () => {
  it('the Shop still holds 6 minions, and the Monkey wears Shop Madness\'s +3/+3 (it is a minion in the Shop)', () => {
    const s = rolls(withRunes(['rune_shop_madness', 'rune_golden_monkey'], 2), 5);
    expect(minions(s)).toHaveLength(6);
    const m = monkeys(s);
    expect(m).toHaveLength(1);
    const d = CARD_INDEX[MONKEY]!;
    const st = offerBuyStats(s, m[0]!);
    expect([st.attack - d.attack, st.health - d.health]).toEqual([3, 3]);
  });
});
