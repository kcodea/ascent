import type { Rng } from '../rng';
import type { BoardMinion, CardDef } from '../types';

/** The Megamimic token's id (the Megamimed Duos rune, owner design 2026-10-30, R-DUOS-RUNES-03). */
export const MEGAMIMIC_ID = 'duo_megamimic';

/**
 * MEGAMIMIC (owner 2026-10-30): "Start of combat, transform into an exact copy of your teammate's highest health
 * minion." Owner confirmed: the teammate's board at the moment each combat starts (their locked board for the round),
 * combat-only, re-transforms every Start of Combat; ties are a seeded random pick.
 *
 * Pure over BoardMinions, applied by `simulate` to a side's board BEFORE it is instantiated (the opening board, and a
 * reserve's board when it steps in), so the copy is a real body for the whole fight: its own Start of Combat fires
 * with every other one, and its stats, keywords, Gilded state and per-instance fields are the teammate's exactly. The
 * copy carries NO `sourceUid`, so nothing it does carries back onto the run card (combat-only); the run keeps the 1/1.
 * No teammate board (a 1v1 fight, an empty mate) = it fights as itself. Another Megamimic is never a candidate (it is
 * a 1/1 placeholder until it transforms). RNG is drawn only on a tie, so a fight without one is unchanged.
 */
export function megamimicBoard(board: readonly BoardMinion[], mate: readonly BoardMinion[] | undefined, rng: Rng, cards: Readonly<Record<string, CardDef>>): BoardMinion[] {
  if (!board.some((m) => m.cardId === MEGAMIMIC_ID)) return board as BoardMinion[];
  const candidates = (mate ?? []).filter((m) => m.cardId !== MEGAMIMIC_ID && !!cards[m.cardId] && !cards[m.cardId]!.spell);
  if (candidates.length === 0) return board as BoardMinion[];
  return board.map((m) => {
    if (m.cardId !== MEGAMIMIC_ID) return m;
    const top = Math.max(...candidates.map((c) => c.health));
    const tied = candidates.filter((c) => c.health === top);
    const pick = tied.length === 1 ? tied[0]! : tied[rng.int(tied.length)]!;
    const copy = structuredClone(pick) as BoardMinion;
    delete copy.sourceUid;
    return copy;
  });
}
