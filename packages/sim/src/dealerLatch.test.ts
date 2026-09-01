import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { chooseBothActive, chooseBothStateOf, spendChooseBothCharge, createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * DEALER'S LATCH IS PER INSTANCE (owner ruling 2026-08-31).
 *
 *   *"her card text doesn't activate until she's played, so she doesn't start looking for the 'first choose
 *    one played' until she is on the board. therefore, she has a fresh tracker/counter. duplicate versions
 *    would also therefore have their first tracker."*
 *
 * The two worked cases the owner gave ARE the test:
 *
 *   · start a turn with TWO Dealers → still only the first Choose One gets both. They were both waiting for
 *     the same first card, so they are redundancy, not two cards' worth.
 *   · one Dealer on board, play a Choose One, THEN buy a second Dealer and play another Choose One → that
 *     one gets both too, because the newcomer arrived with her own fresh latch.
 *
 * What was wrong: the effect was `startOfTurn` only and wrote a RUN-level counter. A Dealer bought mid-turn
 * therefore did nothing at all until the next turn, and a second copy could not have a tracker of her own
 * because there was only ever one number.
 */
const body = (uid: string, over: Partial<BoardCard> = {}): BoardCard => ({
  uid, cardId: 'k3_forkedcrown', tribe: 'kobold', attack: 4, health: 3, keywords: [], golden: false, ...over,
});
const anyChooseOne = CARD_INDEX['beetle']!; // any Choose One card; the latch does not care which
const run = (board: BoardCard[]): RunState => ({ ...createRun(4), setId: 'set3', board } as RunState);
const armed = (s: RunState): boolean => chooseBothActive(chooseBothStateOf(s), undefined, anyChooseOne);

describe("Dealer — one latch per body, armed when she arrives", () => {
  it('TWO Dealers at the start of a turn still only pay for ONE Choose One', () => {
    const s = run([body('d1', { chooseBothLeft: 1 }), body('d2', { chooseBothLeft: 1 })]);
    expect(armed(s), 'the first Choose One resolves both').toBe(true);
    spendChooseBothCharge(s, undefined, anyChooseOne);
    expect(armed(s), 'and the second does NOT — both Dealers were watching the same card').toBe(false);
  });

  it('a Dealer who arrives AFTER the turn\u2019s first Choose One brings her own', () => {
    // The second worked case, exactly.
    const s = run([body('d1', { chooseBothLeft: 1 })]);
    spendChooseBothCharge(s, undefined, anyChooseOne);   // the turn's first Choose One
    expect(armed(s), 'the first Dealer is spent').toBe(false);
    s.board.push(body('d2', { chooseBothLeft: 1 }));      // …then a second Dealer is played
    expect(armed(s), 'her fresh latch covers the next one').toBe(true);
  });

  it('playing a Dealer ARMS her — she does not wait for the next turn', () => {
    // The reported bug in one line: the effect used to be start-of-turn only.
    let s = run([]);
    s = { ...s, hand: [{ ...body('h1'), cardId: 'k3_forkedcrown' }], embers: 20 } as RunState;
    expect(armed(s), 'nothing on board, nothing armed').toBe(false);
    const after = reduce(s, { type: 'play', uid: 'h1', toIndex: 0 });
    expect(after.board.find((c) => c.uid === 'h1')?.chooseBothLeft, 'armed on arrival').toBe(1);
    expect(armed(after), 'and the very next Choose One resolves both').toBe(true);
  });

  it('a GILDED Dealer carries two of her own', () => {
    const s = run([body('d1', { chooseBothLeft: 2, golden: true })]);
    spendChooseBothCharge(s, undefined, anyChooseOne);
    expect(armed(s), 'her second charge is still there').toBe(true);
    spendChooseBothCharge(s, undefined, anyChooseOne);
    expect(armed(s), 'and now she is spent').toBe(false);
  });

  it('a card that would resolve both ANYWAY does not eat her latch', () => {
    // The existing rule, still true with a per-instance latch: a golden Orivax pays for itself.
    const orivax = { id: 'x', chooseOne: [{ text: 'a', effects: [] }, { text: 'b', effects: [] }], chooseBothWhenGolden: true };
    const s = run([body('d1', { chooseBothLeft: 1 })]);
    spendChooseBothCharge(s, { golden: true }, orivax);
    expect(s.board[0]!.chooseBothLeft, 'untouched').toBe(1);
  });
});
