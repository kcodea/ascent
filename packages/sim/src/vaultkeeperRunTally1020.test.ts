import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, snapshotBoard, runTallyFor, type Action, type BoardCard, type RunState } from './index';

/**
 * OWNER CHANGE 2026-10-20 (R-VAULT-02), through the real reducer: "lets change vaultkeeper to a Dwarf / Dragon tribe
 * type, and let's change its mechanic to 4 dragons or dwarves played improves it. i want this mechanic to be active
 * even when the card is not on board or in hand or in shop."
 *
 *  Text: "When you play a Dragon, gain +3/+3. Improves every 4 Dragons or Dwarves played this game."
 *  - The +3/+3 pays on Dragons only; Dwarves only count (owner 2026-10-20).
 *  - The improve is a RUN-WIDE tally (`RunState.tribeUnionPlays['dragon+dwarf']`), counted from the start of the game
 *    whether or not a Vaultkeeper is owned; a Vaultkeeper's own play counts; a dual-type body counts once.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 50, tier: 7, hand: [], board: [], shop: [], ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const playAll = (s: RunState, ...uids: string[]): RunState => uids.reduce((acc, uid) => reduce(acc, { type: 'play', uid } as Action), s);
const tallyOf = (s: RunState): number => s.tribeUnionPlays?.['dragon+dwarf'] ?? 0;

const DRAGON = 'd2_transcendence', DRAGON2 = 'd2_cinderchef', DWARF = 'dw_brakka', DWARF2 = 'dw_edward', BEAST = 'b2_trex';
const VAULT = CARD_INDEX['d2_herzog']!;
const base: [number, number] = [VAULT.attack, VAULT.health];
const plus = (n: number): [number, number] => [base[0] + n, base[1] + n];

describe('Vaultkeeper (2026-10-20): Dwarf/Dragon, improving every 4 Dragons or Dwarves played this game', () => {
  it('is a Dwarf/Dragon with the "this game" text, plain and Gilded', () => {
    expect([VAULT.tribe, VAULT.tribe2]).toEqual(['dwarf', 'dragon']);
    expect([VAULT.text, VAULT.goldenText]).toEqual([
      'When you play a **Dragon**, gain **+3/+3**. Improves every **4 Dragons or Dwarves** played this game.',
      'When you play a **Dragon**, gain **+6/+6**. Improves every **4 Dragons or Dwarves** played this game.',
    ]);
    expect([VAULT.tier, VAULT.attack, VAULT.health], 'the body is unchanged').toEqual([6, 6, 10]);
  });

  it('the tally counts with NO Vaultkeeper anywhere: Dragons and Dwarves count, other types do not', () => {
    const s = playAll(run({ hand: [body('d1', DRAGON), body('w1', DWARF), body('b1', BEAST)] }), 'd1', 'w1', 'b1');
    expect(tallyOf(s)).toBe(2);
  });

  it('a Dragon/Dwarf dual type is ONE play', () => {
    const s = playAll(run({ hand: [body('m', 'dw_brisbane')] }), 'm');
    expect(tallyOf(s)).toBe(1);
  });

  it('a Dragon pays +3/+3, a Dwarf pays nothing but counts', () => {
    let s = run({ board: [body('v', 'd2_herzog')], hand: [body('d1', DRAGON), body('w1', DWARF), body('b1', BEAST)] });
    s = playAll(s, 'd1');
    expect(stats(at(s, 'v'))).toEqual(plus(3));
    s = playAll(s, 'w1', 'b1');
    expect(stats(at(s, 'v')), 'Dwarf and Beast pay nothing').toEqual(plus(3));
    expect(tallyOf(s)).toBe(2);
  });

  it('every 4 counted plays add +3/+3: grant first, then count', () => {
    let s = run({ board: [body('v', 'd2_herzog')], hand: [body('d1', DRAGON), body('w1', DWARF), body('w2', DWARF2), body('d2', DRAGON2), body('d3', DRAGON)] });
    s = playAll(s, 'd1', 'w1', 'w2');
    expect(stats(at(s, 'v'))).toEqual(plus(3));
    s = playAll(s, 'd2');
    expect(stats(at(s, 'v')), 'the play that completes the 4 still pays the old +3/+3').toEqual(plus(6));
    expect(tallyOf(s)).toBe(4);
    s = playAll(s, 'd3');
    expect(stats(at(s, 'v')), 'the next Dragon pays the improved +6/+6').toEqual(plus(12));
  });

  it('a copy bought late arrives improved: the count started at the beginning of the game', () => {
    let s = playAll(run({ hand: [body('d1', DRAGON), body('w1', DWARF), body('w2', DWARF2), body('d2', DRAGON2), body('v', 'd2_herzog'), body('d3', DRAGON)] }), 'd1', 'w1', 'w2', 'd2');
    expect(tallyOf(s)).toBe(4);
    s = playAll(s, 'v');
    expect(tallyOf(s), "the Vaultkeeper's own play counts").toBe(5);
    expect(stats(at(s, 'v')), 'it does not pay for its own arrival').toEqual(base);
    s = playAll(s, 'd3');
    expect(stats(at(s, 'v')), 'its first Dragon already pays the improved +6/+6').toEqual(plus(6));
  });

  it('Gilded doubles the gain, base and steps alike', () => {
    const s = playAll(run({ board: [body('v', 'd2_herzog', { golden: true })], hand: [body('d1', DRAGON)], tribeUnionPlays: { 'dragon+dwarf': 8 } }), 'd1');
    expect(stats(at(s, 'v')), '(3 + 3 + 3) x 2').toEqual(plus(18));
  });

  it('two Vaultkeepers read the SAME run-wide count', () => {
    const s = playAll(run({ board: [body('v', 'd2_herzog'), body('v2', 'd2_herzog')], hand: [body('d1', DRAGON)], tribeUnionPlays: { 'dragon+dwarf': 4 } }), 'd1');
    expect([stats(at(s, 'v')), stats(at(s, 'v2'))]).toEqual([plus(6), plus(6)]);
  });

  it('a served copy carries its owner\'s count in its tally slot (enemy live text)', () => {
    const s = run({ board: [body('v', 'd2_herzog')], tribeUnionPlays: { 'dragon+dwarf': 9 } });
    expect(snapshotBoard(s).minions.find((m) => m.cardId === 'd2_herzog')?.spiritTally).toBe(9);
    expect(runTallyFor('d2_herzog', s.tribeUnionPlays)).toBe(9);
    expect(runTallyFor(DRAGON, s.tribeUnionPlays), 'a card with no run tally').toBeUndefined();
  });
});
