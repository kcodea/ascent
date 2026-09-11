import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { spellDisplayText } from './recruit';

/** SET 3 SPELLS — the seven new rows of the owner's 2026-09-10 sheet (Refraction, Stardust, Stellar Chorus and Split
 *  Decision tabled). Every cast is driven through the reducer's play action. Spells are never golden. */
const body = (uid: string, cardId: string, attack = 2, health = 2): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack, health, keywords: [...d.keywords], golden: false } as BoardCard;
};
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false } as BoardCard);
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(5), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, tribes: ['spirit', 'dwarf', 'celestial'], shop: [], spell: null,
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), ...over } as RunState);
const play = (s: RunState, uid: string, extra: Partial<Action> = {}): RunState => reduce(s, { type: 'play', uid, ...extra } as Action);
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];

describe('the roster', () => {
  it('all seven are set-3 spells with the sheet tier / cost / tribe, and the tribe spells are gated', () => {
    const p = poolFor('set3');
    const rows: [string, number, number, string][] = [
      ['aspectsblessing', 1, 1, 'neutral'], ['rushorder', 2, 1, 'dwarf'], ['sharedspirit', 2, 2, 'neutral'], ['starcrash', 3, 2, 'celestial'],
      ['graverobbery', 3, 2, 'neutral'], ['handsoap', 4, 2, 'neutral'], ['crescendo', 6, 3, 'spirit'],
    ];
    for (const [id, tier, cost, tribe] of rows) {
      const d = CARD_INDEX[id]!;
      expect(p.spells.some((c) => c.id === id), id).toBe(true);
      expect([d.tier, d.cost, d.tribe, !!d.spell], id).toEqual([tier, cost, tribe, true]);
    }
  });
});

describe('Aspect\'s Blessing — Choose One, a random hand minion', () => {
  it('branch 1 gives +3/+1, branch 2 +1/+3; only minions in hand are candidates', () => {
    let s = run({ hand: [spell('sp', 'aspectsblessing'), body('h', 'stray'), spell('x', 'growth')] });
    s = play(s, 'sp');
    s = reduce(s, { type: 'chooseOne', index: 0 } as Action);
    expect(stats(s.hand.find((c) => c.uid === 'h')!)).toEqual([5, 3]);
    let t = run({ hand: [spell('sp', 'aspectsblessing'), body('h', 'stray')] });
    t = play(t, 'sp');
    t = reduce(t, { type: 'chooseOne', index: 1 } as Action);
    expect(stats(t.hand.find((c) => c.uid === 'h')!)).toEqual([3, 5]);
  });
  it('fizzles (kept in hand) with no minion in hand', () => {
    const s = play(run({ hand: [spell('sp', 'aspectsblessing'), spell('x', 'growth')] }), 'sp');
    expect(s.hand.some((c) => c.uid === 'sp')).toBe(true);
  });
});

describe('Rush Order — Choose One: an Ale, or 3 Gold next turn', () => {
  it('branch 1 hands a Dwarven Ale; branch 2 banks 3 Gold for next turn', () => {
    let s = run({ hand: [spell('sp', 'rushorder')] });
    s = play(s, 'sp');
    s = reduce(s, { type: 'chooseOne', index: 0 } as Action);
    expect(s.hand.some((c) => CARD_INDEX[c.cardId]?.name.includes('Ale')), 'an Ale arrived').toBe(true);
    let t = run({ hand: [spell('sp', 'rushorder')] });
    t = play(t, 'sp');
    t = reduce(t, { type: 'chooseOne', index: 1 } as Action);
    expect(t.bonusEmbersNextTurn).toBe(3);
  });
});

describe('Shared Spirit — a random board minion AND a random hand minion +3/+2', () => {
  it('one of each, both random; with only a hand it still pays the hand half', () => {
    let s = run({ board: [body('b', 'stray')], hand: [spell('sp', 'sharedspirit'), body('h', 'stray')] });
    s = play(s, 'sp');
    expect(stats(s.board.find((c) => c.uid === 'b')!)).toEqual([5, 4]);
    expect(stats(s.hand.find((c) => c.uid === 'h')!)).toEqual([5, 4]);
    let t = run({ board: [], hand: [spell('sp', 'sharedspirit'), body('h', 'stray')] });
    t = play(t, 'sp');
    expect(stats(t.hand.find((c) => c.uid === 'h')!)).toEqual([5, 4]);
  });
});

describe('Star Crash — a Celestial +5/+7, and the same on a random friendly minion', () => {
  it('the target gets +5/+7, and one random friendly (the target included — no "other" printed) gets it too', () => {
    // A Celestial body: any card carries `universalTribe`? Use an all-types minion so the tribe aim passes.
    const cel = poolFor('set3').buyable.find((c) => c.tribe === 'celestial' || c.tribe2 === 'celestial') ?? CARD_INDEX['n2_paragon']!;
    let s = run({ board: [body('c', cel.id), body('x', 'stray')], hand: [spell('sp', 'starcrash')] });
    s = play(s, 'sp', { targetUid: 'c' } as Partial<Action>);
    const total = s.board.reduce((n, c) => n + c.attack + c.health, 0);
    expect(total, 'two casts of +5/+7 landed on the board (2 bodies at 2/2 = 8, +24)').toBe(8 + 24);
    expect(stats(s.board.find((c) => c.uid === 'c')!)[0], 'the target got at least one').toBeGreaterThanOrEqual(7);
  });
});

describe('Grave Robbery — destroy a friendly minion, get a random Shop spell', () => {
  it('the target dies via the two-step death (its Echo fires) and a tier-eligible non-Ale spell lands in hand', () => {
    let s = run({ board: [body('v', 'wolvesden')], hand: [spell('sp', 'graverobbery')], tribes: ['undead', 'dwarf', 'spirit'] });
    s = play(s, 'sp', { targetUid: 'v' } as Partial<Action>);
    expect(s.pendingDeath?.uid).toBe('v');
    s = reduce(s, { type: 'resolveShopDeath' } as Action);
    expect(s.board.some((c) => c.uid === 'v'), 'destroyed').toBe(false);
    // (The two-step death's Echo / departure beats are Graverobber's lane — shopDestroy.test.ts.)
    const got = s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell);
    expect(got.length, 'one spell arrived').toBe(1);
    expect(CARD_INDEX[got[0]!.cardId]!.name.includes('Ale')).toBe(false);
  });
});

describe('Hand Soap — the left-most MINION in hand +8/+8', () => {
  it('skips a spell sitting left of the minion; fizzles with no minion in hand', () => {
    let s = run({ hand: [spell('x', 'growth'), body('h1', 'stray'), body('h2', 'stray'), spell('sp', 'handsoap')] });
    s = play(s, 'sp');
    expect(stats(s.hand.find((c) => c.uid === 'h1')!)).toEqual([10, 10]);
    expect(stats(s.hand.find((c) => c.uid === 'h2')!)).toEqual([2, 2]);
    const t = play(run({ hand: [spell('x', 'growth'), spell('sp', 'handsoap')] }), 'sp');
    expect(t.hand.some((c) => c.uid === 'sp'), 'kept in hand').toBe(true);
  });
});

describe('Crescendo — your minions +1/+1 per Spirit played this turn', () => {
  it('pays per Spirit played, prints the live value, and fizzles with none played', () => {
    let s = run({ board: [body('a', 'stray'), body('b', 'stray')], hand: [spell('sp', 'crescendo')], playedThisTurn: ['sp3_tidebud', 'sp3_nurturer', 'stray'] });
    expect(spellDisplayText('crescendo', 0, 0, 0, 0, 0, 0, { playedThisTurn: s.playedThisTurn })).toContain('{{Now +2/+2.}}');
    expect(spellDisplayText('crescendo', 1, 0, 0, 0, 0, 0, { playedThisTurn: s.playedThisTurn }), 'spell power scales the per-Spirit rate').toContain('{{Now +4/+2.}}');
    s = play(s, 'sp');
    expect(stats(s.board.find((c) => c.uid === 'a')!)).toEqual([4, 4]);
    expect(stats(s.board.find((c) => c.uid === 'b')!)).toEqual([4, 4]);
    const t = play(run({ board: [body('a', 'stray')], hand: [spell('sp', 'crescendo')], playedThisTurn: ['stray'] }), 'sp');
    expect(t.hand.some((c) => c.uid === 'sp'), 'no Spirit played → fizzles').toBe(true);
  });
});
