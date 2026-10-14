import type { CardDef } from '@game/core';
import { SET4_BEASTS } from './beasts';
import { SET4_CELESTIALS } from './celestials';
export { SET4_SPELLS } from './spells';

/**
 * ── SET 4 — scaffold (owner 2026-10-13) ─────────────────────────────────────────────────────────────────
 *
 * Registered in `sets.ts` DISABLED and selectable in the Scene Builder's set picker, exactly as Set 3 was
 * started, so its cards can be played the moment they exist without moving a real run onto it.
 *
 * Its cards: the SELF-DAMAGE Beasts (Hawg, Apua, Eatah, Alan) and, since the 2026-10-14 swap (owner: "move
 * celestials to set 4 along with their runes etc. remove them from set 3. move our current set 4 dragons to set
 * 3."), the CELESTIALS and the Starform (`celestials.ts`) with their two tribe spells (`spells.ts`: Star Crash and
 * Black Hole). The Whisper Dragons and their Whispers moved to `cards/set3/` in the same swap. Every id is unchanged.
 *
 * New cards go in SIBLING FILES here and are APPENDED to `SET4_CARDS` (or after it in `SETS.set4.own`): a set's pool
 * order and size are load-bearing for its seeds.
 */
export const SET4_CARDS: readonly CardDef[] = [...SET4_BEASTS, ...SET4_CELESTIALS];
export { SET4_BEASTS, SET4_CELESTIALS };
