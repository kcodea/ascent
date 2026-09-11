import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { FACTORIES, combatSide, makeRng, simulate, type BoardMinion } from '@game/core';

/**
 * A RALLY MULTIPLIER REACHES EVERY RALLY WATCHER (found by Doc Bot's `firePaths` lane, 2026-09-11).
 *
 * The 2026-08-14 owner report fixed Paragon: with Uron ("your Rallies trigger an additional time") on the
 * board, a Rally watcher on ANOTHER body fired once on the bus swing and never for the extra, because the
 * multiplier loop re-ran only the attacker's own effects. The fix named Paragon alone. The free-Rally fix a
 * month later (Bug Board 7e04222d) listed all three RL-gated watchers — Paragon, Hawkus, Mineral Master — for
 * ITS path, so the two synthetic Rally paths disagreed on who a Rally watcher is: Uron doubled Paragon and
 * left Hawkus and Mineral Master at ×1. One set now serves both paths; this pins the two that were missing.
 *
 * Counted by a spy on the factory registry (invocations for the watcher's card), not by events: how many
 * events a fire emits depends on the board (a full board drops a summon; an extra body is one more Ruby
 * target), while the contract is "the watcher fires once per Rally trigger".
 */
const bm = (cardId: string, uid: string, attack: number, health: number, keywords?: string[]): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords ?? [...(CARD_INDEX[cardId]?.keywords ?? [])], golden: false } as unknown as BoardMinion);
// The dummy dies to the first swing, so each fight holds EXACTLY one natural Rally.
const fight = (board: BoardMinion[]) => simulate(
  board, [bm('omen', 'W', 0, 1)], makeRng(4), CARD_INDEX,
  combatSide({ tier: 6, tribes: ['beast', 'kobold', 'dragon'] } as never), combatSide({ tier: 1 }));
/** Invocations of `factory` on behalf of `card` across one fight. */
function fires(factory: string, card: string, board: BoardMinion[]): number {
  const table = FACTORIES as Record<string, ((...a: unknown[]) => unknown) | undefined>;
  const real = table[factory]!;
  let n = 0;
  table[factory] = (...args: unknown[]) => { if ((args[1] as { cardId: string }).cardId === card) n++; return real(...args); };
  try { fight(board); } finally { table[factory] = real; }
  return n;
}
const uron = () => bm('uron', 'U', 0, 40);
const rallier = () => bm('d2_cinderchef', 'RL', 6, 40, ['RL']); // a plain self-buff Rally, so nothing else scales

describe('Uron doubles every Rally WATCHER, not just Paragon', () => {
  it('Hawkus fires twice per Rally under Uron (was once)', () => {
    const board = () => [bm('pack', 'ECHO', 0, 40), bm('b2_hawkus', 'HAWK', 0, 40), rallier()];
    expect(fires('onRallyProcLeftmostEcho', 'b2_hawkus', board()), 'one natural Rally → one fire').toBe(1);
    expect(fires('onRallyProcLeftmostEcho', 'b2_hawkus', [...board(), uron()]), 'Uron: the Rally triggers an additional time → Hawkus fires again').toBe(2);
  });

  it('Mineral Master fires twice per Rally under Uron (was once)', () => {
    const board = () => [bm('k_mineralmaster', 'MM', 0, 40), bm('k_boulderdash', 'K', 0, 40), rallier()];
    expect(fires('onRallyPlayRubiesTribe', 'k_mineralmaster', board())).toBe(1);
    expect(fires('onRallyPlayRubiesTribe', 'k_mineralmaster', [...board(), uron()])).toBe(2);
  });

  it('Paragon still doubles (the 2026-08-14 fix is unchanged)', () => {
    const board = () => [bm('n2_paragon', 'P', 0, 40), bm('pup', 'B', 0, 40), rallier()];
    expect(fires('onRallyBuffOnePerTribe', 'n2_paragon', board())).toBe(1);
    expect(fires('onRallyBuffOnePerTribe', 'n2_paragon', [...board(), uron()])).toBe(2);
  });

  it('an ally-ATTACK watcher (Crypt Drake) is NOT doubled — it counts swings, not Rallies', () => {
    const board = () => [bm('cryptdrake', 'CD', 0, 40), rallier()];
    expect(fires('onAllyAttackBuffAll', 'cryptdrake', board())).toBe(1);
    expect(fires('onAllyAttackBuffAll', 'cryptdrake', [...board(), uron()])).toBe(1);
  });
});
