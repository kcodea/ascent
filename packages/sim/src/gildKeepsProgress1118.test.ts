import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { gildProgressCarry } from './gildProgress';
import { stepProgress } from '../../ui/src/cardText';

/**
 * R-GILD-PROGRESS-01, OWNER REPORT 2026-11-18: "minions that track anything like spend etc should not reset when
 * gilded. aka a Billings at 9/10 when gilded should be at the furthest progress of the cards that tripled."
 *
 * Before: `combineIntoGolden` carried the accrued VALUES and a few counters (spell progress, ascend progress, Pummel,
 * the End-of-Turn cadence) but minted the Gilded minion with every other per-instance meter unset, so a Billings one
 * Gold from paying out went back to 0/10. Now ONE helper (`gildProgressCarry`) starts every tracker at the furthest
 * of the copies that merged, on every merge path (3 copies, 2 under Midas, board and hand copies alike).
 */

type Extra = Partial<BoardCard>;
const mk = (cardId: string, uid: string, extra: Extra = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState>): RunState =>
  ({ ...createRun(1), phase: 'recruit', embers: 60, board: [], hand: [], tier: 6, ...over }) as RunState;
const goldenOf = (s: RunState, cardId: string): BoardCard => {
  const g = [...s.hand, ...s.board].find((c) => c.cardId === cardId && c.golden);
  expect(g, `a Gilded ${cardId} exists`).toBeDefined();
  return g!;
};
/** Copies start in hand and are played one by one: the real triple path. Returns the run after the merge. */
const tripleRun = (cardId: string, extras: Extra[], over: Partial<RunState> = {}): RunState => {
  let s = base({ hand: extras.map((e, i) => mk(cardId, `c${i}`, e)), ...over });
  for (let i = 0; i < extras.length; i++) {
    if (!s.hand.some((c) => c.uid === `c${i}`)) break; // already merged
    s = reduce(s, { type: 'play', uid: `c${i}` });
  }
  return s;
};
const triple = (cardId: string, extras: Extra[], over: Partial<RunState> = {}): BoardCard => goldenOf(tripleRun(cardId, extras, over), cardId);
/** Attack a body has been handed under one buff label (the inspect ledger). */
const granted = (c: BoardCard, label: string): number => (c.buffs ?? []).filter((b) => b.source === label).reduce((n, b) => n + b.attack, 0);

describe('R-GILD-PROGRESS-01: a Gilded minion starts at the furthest progress of the copies that merged', () => {
  it('Billings at 9/10, 3/10 and 0/10 gilds to 9/10 (the owner example), and the card prints it at once', () => {
    const g = triple('dw_billings', [{ goldTick: 9 }, { goldTick: 3 }, {}]);
    expect(g.goldTick).toBe(9);
    expect(stepProgress('dw_billings', { goldTick: g.goldTick })).toMatchObject({ current: 9, total: 10 });
  });

  it('the copy order does not matter: the furthest copy wins wherever it sits', () => {
    expect(triple('dw_billings', [{}, { goldTick: 3 }, { goldTick: 9 }]).goldTick).toBe(9);
    expect(triple('dw_billings', [{ goldTick: 2 }, { goldTick: 9 }, { goldTick: 2 }]).goldTick).toBe(9);
  });

  it('fresh copies gild to a fresh meter (nothing invented)', () => {
    expect(triple('dw_billings', [{}, {}, {}]).goldTick).toBeUndefined();
  });

  it('Midas gilds at 2 copies and keeps the furthest of the two', () => {
    const g = triple('dw_billings', [{ goldTick: 3 }, { goldTick: 9 }], { heroId: 'midas' });
    expect(g.goldTick).toBe(9);
  });

  it('a hand and board mix: a board copy, a hand copy that carried progress, and a fresh hand copy', () => {
    // The 9/10 copy sits in HAND (it was on the board earlier); the board copy is at 4/10.
    let s = base({ board: [mk('dw_billings', 'b0', { goldTick: 4 })], hand: [mk('dw_billings', 'h0', { goldTick: 9 }), mk('dw_billings', 'h1')] });
    s = reduce(s, { type: 'play', uid: 'h1' }); // the play re-checks triples across hand + board
    expect(goldenOf(s, 'dw_billings').goldTick).toBe(9);
    expect([...s.hand, ...s.board].filter((c) => c.cardId === 'dw_billings')).toHaveLength(1);
  });

  it('the merge never fires the payout, and the carried count pays out exactly once when it completes', () => {
    // A second Dwarf stands witness: Billings never buffs itself, so every payout lands on it.
    const paid = (s: RunState): number => granted(s.board.find((c) => c.uid === 'w')!, 'Billings');
    const merged = tripleRun('dw_billings', [{ goldTick: 9 }, { goldTick: 9 }, { goldTick: 9 }], { board: [mk('dw3_marketing', 'w')] });
    const g0 = goldenOf(merged, 'dw_billings');
    expect(g0.goldTick).toBe(9); // three copies at 9 are 9, never 27
    expect(paid(merged)).toBe(0); // merging paid nothing
    let s = reduce(merged, { type: 'play', uid: g0.uid });
    expect(paid(s)).toBe(0);
    const before = s.embers;
    s = reduce(s, { type: 'roll' }); // 1 Gold: 9 -> 10, one payout
    expect(before - s.embers).toBe(1);
    expect(goldenOf(s, 'dw_billings').goldTick).toBe(0);
    expect(paid(s)).toBe(12); // Gilded +12/+12, once
    s = reduce(s, { type: 'roll' });
    expect(goldenOf(s, 'dw_billings').goldTick).toBe(1);
    expect(paid(s)).toBe(12); // 1/10: no second payout
  });

  it('a count at or past its threshold is clamped below it, so a merge can never arm a double payout', () => {
    const d = CARD_INDEX['dw_billings']!;
    expect(gildProgressCarry(d, [mk('dw_billings', 'x', { goldTick: 25 }), mk('dw_billings', 'y', { goldTick: 10 })]).goldTick).toBe(9);
  });

  it('cards bought (Banksly): 3/4 and 1/4 gild to 3/4', () => {
    const g = triple('banksly', [{ buyTick: 1 }, { buyTick: 3 }, {}]);
    expect(g.buyTick).toBe(3);
    expect(stepProgress('banksly', { buyTick: g.buyTick })).toMatchObject({ current: 3, total: 4 });
  });

  it('minions sold (Mariet): 3/4 and 2/4 gild to 3/4', () => {
    expect(triple('dw3_marketing', [{ soldProgress: 2 }, { soldProgress: 3 }, {}]).soldProgress).toBe(3);
  });

  it('casts witnessed (Gemgorge Fiend): the furthest count carries', () => {
    const g = triple('k_gemgorge', [{ rubyCastTick: 2 }, { rubyCastTick: 1 }, {}]);
    expect(g.rubyCastTick).toBe(2);
    expect(stepProgress('k_gemgorge', { rubyCastTick: g.rubyCastTick })).toMatchObject({ current: 2, total: 3 });
  });

  it('Spirits played (Festival Keeper) and Refreshes pressed (Indy): the furthest count carries', () => {
    expect(triple('sp3_festivalkeeper', [{ spiritTally: 2 }, { spiritTally: 1 }, {}]).spiritTally).toBe(2);
    expect(triple('n3_indy', [{ eotTick: 4 }, { eotTick: 1 }, {}]).eotTick).toBe(4);
  });

  it('a CHARGES-USED count is not progress toward a trigger and keeps its own rule (Ninefold)', () => {
    const d = CARD_INDEX['n2_ninefold']!;
    expect(gildProgressCarry(d, [mk('n2_ninefold', 'x', { buyTick: 5 })]).buyTick).toBeUndefined();
  });

  it('the long-standing End of Turn cadence merge is unchanged: the cycle position, not the raw count', () => {
    const cadence = Object.values(CARD_INDEX).find((c) => !c.spell && c.effects.some((e) => e.on === 'endOfTurn' && typeof (e.params as { every?: number } | undefined)?.every === 'number'))!;
    const every = (cadence.effects.find((e) => e.on === 'endOfTurn' && typeof (e.params as { every?: number } | undefined)?.every === 'number')!.params as { every: number }).every;
    expect(every).toBeGreaterThan(1);
    const carried = gildProgressCarry(cadence, [mk(cadence.id, 'x', { eotTick: every + 1 }), mk(cadence.id, 'y', { eotTick: every })]);
    expect(carried.eotTick).toBe(1);
  });

  it('deterministic: the same actions from the same seed give the same run', () => {
    const run = (): RunState => {
      let s = tripleRun('dw_billings', [{ goldTick: 9 }, { goldTick: 3 }, {}]);
      s = reduce(s, { type: 'play', uid: goldenOf(s, 'dw_billings').uid });
      s = reduce(s, { type: 'roll' });
      return reduce(s, { type: 'roll' });
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
