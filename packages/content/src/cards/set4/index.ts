import type { CardDef } from '@game/core';
import { SET4_DRAGONS } from './dragons';
import { SET4_BEASTS } from './beasts';
export { SET4_WHISPERS } from './whispers';

/**
 * ── SET 4 — scaffold (owner 2026-10-13) ─────────────────────────────────────────────────────────────────
 *
 * Registered in `sets.ts` DISABLED and selectable in the Scene Builder's set picker, exactly as Set 3 was
 * started, so its cards can be played the moment they exist without moving a real run onto it.
 *
 * Its first cards: the WHISPER Dragons (Galas, Tolan, Tamby, Whisp) and the SELF-DAMAGE Beasts (Hawg, Apua, Eatah,
 * Alan). The two Whispers (Tome, Runebind) are granted spells, not drawable cards: like every Gift they stay OUT of
 * the manifest and resolve through the global `CARD_INDEX`.
 *
 * New cards go in SIBLING FILES here and are APPENDED to `SET4_CARDS` (or after it in `SETS.set4.own`): a set's pool
 * order and size are load-bearing for its seeds. No art is wired; every card uses the missing-art placeholder.
 */
export const SET4_CARDS: readonly CardDef[] = [...SET4_DRAGONS, ...SET4_BEASTS];
export { SET4_DRAGONS, SET4_BEASTS };
