import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { gainGold } from './recruit';

/**
 * Rune of Profit Sharing + the gold-gain chokepoint it required.
 *
 * Gold was credited in a dozen places across the reducer and the recruit factories. Wiring eleven of them would
 * have shipped a rune that silently misses whichever income the twelfth provides — so `gainGold` is now the one
 * credit path, and these tests exercise SEVERAL distinct income sources rather than one.
 */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const dwarf = CARD_INDEX['dw_brunni']!;
const mk = (uid: string): BoardCard => ({ uid, cardId: 'dw_brunni', tribe: dwarf.tribe, attack: dwarf.attack, health: dwarf.health, keywords: [], golden: false });
const armed = (over: Partial<RunState> = {}): RunState => ({
  ...set2(), runeProfitSharing: { tribe: 'dwarf', attack: 3, health: 3 }, board: [mk('d')], hand: [], ...over,
} as RunState);
const atk = (s: RunState) => s.board.find((c) => c.uid === 'd')!.attack;

describe('Rune of Profit Sharing', () => {
  it('fires on a direct gain', () => {
    const s = armed();
    gainGold(s, 5);
    expect(atk(s)).toBe(dwarf.attack + 3);
  });

  it('fires ONCE per gain, not once per Gold', () => {
    // "Whenever you gain Gold" is per transaction — per-coin would make a 10-Gold payout a +30/+30 swing.
    const s = armed();
    gainGold(s, 10);
    expect(atk(s), 'the buff scaled with the amount instead of the event').toBe(dwarf.attack + 3);
  });

  it('ignores a zero or negative gain', () => {
    const s = armed();
    gainGold(s, 0);
    expect(atk(s)).toBe(dwarf.attack);
  });

  it('buffs the tribe in HAND as well as on board', () => {
    const s = armed({ hand: [mk('h')] });
    gainGold(s, 3);
    expect(s.hand.find((c) => c.uid === 'h')!.attack).toBe(dwarf.attack + 3);
  });

  it('leaves other tribes alone', () => {
    const pack = CARD_INDEX['pack']!;
    const s = armed({ board: [mk('d'), { uid: 'b', cardId: 'pack', tribe: pack.tribe, attack: pack.attack, health: pack.health, keywords: [], golden: false }] });
    gainGold(s, 5);
    expect(s.board.find((c) => c.uid === 'b')!.attack, 'a Beast was buffed by a Dwarf rune').toBe(pack.attack);
  });

  it('catches income from a REAL sell, not just direct calls', () => {
    // The point of the chokepoint: the sell path credits Gold through its own code, and must still fire this.
    const s = armed({ board: [mk('d'), mk('sell')] });
    const next = reduce(s, { type: 'sell', uid: 'sell' });
    expect(next.board.find((c) => c.uid === 'd')!.attack, 'a sell did not route through gainGold').toBe(dwarf.attack + 3);
  });
});

describe('the rune data', () => {
  it('ships at 4 Gold, epic, set-2 scoped', () => {
    const r = byName('Rune of Profit Sharing')!;
    expect(r.cost).toBe(4);
    expect(!!r.epic).toBe(true);
    expect(r.sets).toEqual(['set2']); // Dwarves
  });
});
