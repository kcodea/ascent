import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import type { BoardCard } from './state';

/**
 * FUNERAL ON LOAN — the owner's live-testing bug reports (2026-08-04).
 *
 * A borrowed minion now OCCUPIES ITS DROP SLOT while its Echo fires (then leaves, never staying). Positional
 * Echoes need the body to actually be somewhere: Dawnclaw's "adjacent Shouts" has no meaning for a card that
 * was never on the board, and Legion Shepherd's overflow must count against the real board.
 */
const body = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 3, health: 3, keywords: [], golden: false } as BoardCard);

const borrowed = (uid: string, cardId: string): BoardCard => ({ ...body(uid, cardId), borrowed: true } as BoardCard);

describe('a borrowed minion occupies its drop slot while the Echo fires', () => {
  it('Legion Shepherd on a 6-minion board summons what fits and converts the rest into the Imp buff', () => {
    // 6 on board + the ghost Shepherd = full. Its 4 Imps: none fit → all 4 overflow → +8/+8 Imp aura (2/2 × 4).
    const s: RunState = {
      ...createRun(11), embers: 30, shop: [],
      board: [body('b1', 'sandbag'), body('b2', 'sandbag'), body('b3', 'sandbag'), body('b4', 'sandbag'), body('b5', 'sandbag'), body('b6', 'sandbag')],
      hand: [borrowed('sh', 'dm_shepherd')],
    };
    const after = reduce(s, { type: 'play', uid: 'sh', toIndex: 3 });
    expect(after.board.some((c) => c.uid === 'sh'), 'the borrowed body must not STAY').toBe(false);
    expect(after.impBuff, 'all four Imps overflowed into the permanent aura').toEqual({ attack: 8, health: 8 });

    // …and on an EMPTIER board it actually summons: 3 slots free (+ its own ghost slot) → 3 Imps land, 1 overflows.
    const roomy: RunState = { ...s, board: s.board.slice(0, 3), hand: [borrowed('sh', 'dm_shepherd')] };
    const a2 = reduce(roomy, { type: 'play', uid: 'sh', toIndex: 0 });
    expect(a2.board.filter((c) => c.cardId === 'impscrap').length, 'the Imps that fit must actually land').toBe(3);
    expect(a2.impBuff, 'one overflow → +2/+2').toEqual({ attack: 2, health: 2 });
  });

  it("a borrowed Dawnclaw dropped beside a Shout re-fires that neighbour's Shout", () => {
    // Warhorn Captain's Shout: your other Dwarves +3 Attack. Dawnclaw dropped adjacent must trigger it.
    const s: RunState = {
      ...createRun(12), embers: 30, shop: [],
      board: [body('cap', 'dw_ironlung'), body('dw2', 'dw_brunni')],
      hand: [borrowed('dc', 'b2_dawnclaw')],
    };
    const before = s.board[1]!.attack;
    const after = reduce(s, { type: 'play', uid: 'dc', toIndex: 1 }); // between the Captain and the Dwarf
    expect(after.board.some((c) => c.uid === 'dc'), 'the loan expires — Dawnclaw must not stay').toBe(false);
    const dw2 = after.board.find((c) => c.uid === 'dw2')!;
    expect(dw2.attack, "the Captain's re-fired Shout must buff its fellow Dwarf").toBeGreaterThan(before);
  });
});
