/** R-DERENOR-01: Derenor (Set 2 Beast, T6 9/9): "When you buy 4 minions, get a random Beast." (owner 2026-11-23). */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { runeforgePool } from './reducer';
import { createRun, deserialize, reduce, serialize, type Action, type BoardCard, type RunState } from './index';

const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const bc = (uid: string, over: Partial<BoardCard> = {}): BoardCard => ({ uid, cardId: 'b2_derenor', tribe: 'beast', attack: 9, health: 9, keywords: [], golden: false, ...over });
const FILL = poolFor('set2').buyable.filter((c) => !c.spell && !c.ruby && c.tribe === 'dwarf' && !c.tribe2 && !c.effects.some((e) => e.on === 'onBuy')).slice(0, 12);
const SPELL = CARD_INDEX['quickstudy']!; // a Shop spell
const base = (over: Partial<RunState> = {}): RunState => ({
  ...createRun(7, 'warden', 'ascent', undefined, 'set2'), wave: 8, tier: 6, phase: 'recruit', embers: 99, maxEmbers: 99, hand: [], board: [bc('d')],
  tribes: ['beast', 'dwarf', 'dragon', 'demon', 'kobold'], shop: [], ...over,
} as RunState);
/** Buy `n` distinct minions one at a time, clearing the hand first so it never fills (unless `keep`). */
function buy(s: RunState, n: number, cardIds = FILL.map((c) => c.id), keep = false): RunState {
  for (let i = 0; i < n; i++) {
    const uid = `o${i}_${s.uidSeq}`;
    const granted = s.hand.filter((c) => c.uid.startsWith('g'));
    s = act({ ...s, embers: 99, hand: keep ? s.hand : granted, shop: [{ uid, cardId: cardIds[i % cardIds.length]! }] } as RunState, { type: 'buy', uid } as Action);
  }
  return s;
}
const beasts = (s: RunState) => s.hand.filter((c) => CARD_INDEX[c.cardId]!.tribe === 'beast' || CARD_INDEX[c.cardId]!.tribe2 === 'beast' || CARD_INDEX[c.cardId]!.universalTribe);
const tick = (s: RunState, uid = 'd') => s.board.find((c) => c.uid === uid)!.buyTick ?? 0;

describe('R-SOULTAXES-SET2-01: Soul Taxes left Set 2', () => {
  it('no Set 2 forge offers it, even with Undead rolled; Set 3 still does', () => {
    const forge = (setId: 'set2' | 'set3') => runeforgePool({ ...createRun(5, 'warden'), setId, tribes: ['undead', 'demon', 'kobold', 'dwarf', 'dragon'], runeforgeEpic: true } as RunState);
    expect(forge('set2')).not.toContain('rune_soul_taxes');
    expect(forge('set3')).toContain('rune_soul_taxes');
  });
});

describe('Derenor as content', () => {
  it('a buyable Set 2 Tier 6 9/9 Beast, not in Set 3, owner text', () => {
    const d = CARD_INDEX['b2_derenor']!;
    expect([d.name, d.tribe, d.tier, d.attack, d.health, !!d.token]).toEqual(['Derenor', 'beast', 6, 9, 9, false]);
    expect(d.text).toBe('When you buy **4 minions**, get a random **Beast**.');
    expect(d.goldenText).toBe('When you buy **4 minions**, get **2** random **Beasts**.');
    expect(poolFor('set2').buyable.some((c) => c.id === 'b2_derenor')).toBe(true);
    expect(poolFor('set3').buyable.some((c) => c.id === 'b2_derenor')).toBe(false);
  });
});

describe('the meter', () => {
  it('three buys pay nothing; the fourth gets one Beast; it repeats', () => {
    let s = buy(base(), 3);
    expect(tick(s)).toBe(3);
    expect(beasts(s)).toHaveLength(0);
    s = buy(s, 1);
    expect(tick(s)).toBe(0);
    expect(beasts(s)).toHaveLength(1);
    s = buy({ ...s, hand: [] }, 4);
    expect(beasts(s)).toHaveLength(1);
  });
  it('a bought Shop spell does not count (row offer), and does not reset the count', () => {
    let s = buy(base(), 3);
    s = buy(s, 1, [SPELL.id]);
    expect(tick(s)).toBe(3);
    s = buy(s, 1);
    expect(beasts(s)).toHaveLength(1);
  });
  it('a spell bought from the spell slot does not count', () => {
    const s0 = buy(base(), 3);
    const s = act({ ...s0, embers: 99, hand: [], spell: { uid: 'sp', cardId: SPELL.id } } as RunState, { type: 'buy', uid: 'sp' } as Action);
    expect(s.hand.some((c) => c.cardId === SPELL.id), 'the spell really was bought').toBe(true);
    expect(tick(s)).toBe(3);
  });
  it('buying Derenor itself never counts for that copy; the count survives the turn and a save', () => {
    let s = buy(base({ board: [] }), 1, ['b2_derenor']);
    expect(s.hand.find((c) => c.cardId === 'b2_derenor')!.buyTick ?? 0).toBe(0);
    s = buy(base(), 2);
    s = deserialize(serialize({ ...s, wave: s.wave + 1 } as RunState));
    expect(tick(s)).toBe(2);
    expect(beasts(buy(s, 2))).toHaveLength(1);
  });
  it('only a Derenor on the board counts: one in hand does nothing', () => {
    const s = buy(base({ board: [], hand: [bc('g1')] }), 4);
    expect(s.hand.find((c) => c.uid === 'g1')!.buyTick ?? 0).toBe(0);
  });
});

describe('the payout', () => {
  it('a full hand gets nothing, and the count still resets', () => {
    const full = Array.from({ length: 10 }, (_, i) => ({ ...bc(`h${i}`), cardId: 'quickstudy', tribe: 'neutral' }) as BoardCard);
    let s = buy(base(), 3);
    // the 4th buy fills the last hand slot: the Beast has no room
    s = buy({ ...s, hand: full.slice(0, 9) } as RunState, 1, undefined, true);
    expect(s.hand).toHaveLength(10);
    expect(beasts(s).filter((c) => !c.uid.startsWith('h'))).toHaveLength(0);
    expect(tick(s)).toBe(0);
  });
  it('a Gilded one gets 2; two Derenors each pay', () => {
    expect(beasts(buy(base({ board: [bc('d', { golden: true })] }), 4))).toHaveLength(2);
    expect(beasts(buy(base({ board: [bc('d'), bc('e')] }), 4))).toHaveLength(2);
  });
  it('never above your Shop Tier, and the same seed gets the same Beast', () => {
    for (const tier of [1, 3, 6]) {
      const a = beasts(buy(base({ tier }), 4)), b = beasts(buy(base({ tier }), 4));
      expect(a).toHaveLength(1);
      expect(CARD_INDEX[a[0]!.cardId]!.tier).toBeLessThanOrEqual(tier);
      expect(a.map((c) => c.cardId)).toEqual(b.map((c) => c.cardId));
    }
  });
  it('the old all-cards meters are unchanged: Korok still counts a spell', () => {
    const k = { ...bc('k'), cardId: 'acid', tribe: 'demon' } as BoardCard;
    expect(tick(buy(base({ board: [k] }), 1, [SPELL.id]), 'k')).toBe(1);
  });
});
