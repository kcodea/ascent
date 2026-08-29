/**
 * SABLE'S SOULBIND SURVIVES A TRIPLE (owner report 2026-08-29: "sable's hero power breaks if a minion who is
 * soulbound gets tripled").
 *
 * The bond is stored as two run-board UIDs (`sableBond.a` / `.b`), and a triple destroys its three copies and
 * mints a golden with a BRAND-NEW uid. So a bonded body that tripled left the bond pointing at a uid that no
 * longer existed — and because the mirror needs BOTH ends to resolve, the whole power went dead for the rest
 * of the turn, silently, in both phases (the combat half matches on the same run-board uid).
 *
 * Everything else in `combineIntoGolden` carries state forward to the golden — buffs, spell progress, ascend
 * progress, the earliest boughtWave. The bond now does too.
 */
import { describe, it, expect } from 'vitest';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { CARD_INDEX } from '@game/content';

const card = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 3, health: 3,
     keywords: [], golden: false, ...over } as BoardCard);

/** A Sable run whose board is [sandbag, X, X] with the bond already forged on the outermost pair. */
function bonded(over: Partial<RunState> = {}): RunState {
  const s = createRun(5, 'sable');
  return {
    ...s, tier: 6, embers: 30, phase: 'recruit',
    board: [card('L', 'sandbag'), card('m', 'dw_orin'), card('R', 'sandbag')],
    hand: [],
    sableBond: { a: 'L', b: 'R', wave: s.wave },
    ...over,
  } as unknown as RunState;
}

/** Play the hand card `uid`, which completes a triple. */
const play = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid } as Action);

describe("Sable's bond and a triple", () => {
  it('follows the tripled body to the golden instead of dangling on a dead uid', () => {
    // Two sandbags on the board are bonded ends; a third arrives and triples them into one golden.
    let s = bonded({ hand: [card('h', 'sandbag')] });
    s = play(s, 'h');

    const golden = [...s.board, ...s.hand].find((c) => c.cardId === 'sandbag' && c.golden);
    expect(golden, 'fixture guard: the triple actually happened').toBeDefined();
    // BOTH ends were consumed into the same golden, so there is no pair left to bond — the power ends
    // rather than binding the golden to itself and paying it twice for every buff.
    expect(s.sableBond, 'a self-bond would double every buff on one body').toBeUndefined();
  });

  it('re-points the bond when only ONE end is consumed', () => {
    // Board: [L=sandbag, mid, R=orin]. Two more orins arrive → the RIGHT end triples, the left does not.
    let s = bonded({
      board: [card('L', 'sandbag'), card('m2', 'dw_orin'), card('R', 'dw_orin')],
      hand: [card('h', 'dw_orin')],
      sableBond: { a: 'L', b: 'R', wave: 1 },
      wave: 1,
    });
    s = play(s, 'h');

    const golden = [...s.board, ...s.hand].find((c) => c.cardId === 'dw_orin' && c.golden);
    expect(golden, 'fixture guard: the triple actually happened').toBeDefined();
    expect(s.sableBond, 'the bond survives — one end is still on the board').toBeDefined();
    expect(s.sableBond!.a, 'the untouched end is unchanged').toBe('L');
    expect(s.sableBond!.b, 'and the consumed end now points at the golden').toBe(golden!.uid);
  });

  it('a bond that touches no tripled body is left completely alone', () => {
    let s = bonded({
      board: [card('L', 'sandbag'), card('o1', 'dw_orin'), card('o2', 'dw_orin'), card('R', 'sandbag')],
      hand: [card('h', 'dw_orin')],
      sableBond: { a: 'L', b: 'R', wave: 1 },
      wave: 1,
    });
    s = play(s, 'h');
    expect(s.sableBond).toEqual({ a: 'L', b: 'R', wave: 1 });
  });
});
