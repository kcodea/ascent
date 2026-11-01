import type { CardDef } from '@game/core';
import { DUOS_DRAGONS } from './dragons';
import { DUOS_NEUTRAL, DUOS_NEUTRAL_DISCOVER_PASS } from './neutral';
import { DUOS_SPELLS, DUOS_SPELLS_BATCH2, DUOS_SPELLS_DISCOVER_PASS } from './spells';
import { DUOS_BEASTS } from './beasts';
import { DUOS_DWARVES } from './dwarves';
import { DUOS_KOBOLDS } from './kobolds';
import { DUOS_DEMONS } from './demons';
import { DUOS_WHISPERS } from './whispers';

/**
 * ── DUOS-ONLY CARDS (owner design 2026-10-30, R-DUOS-CARDS-01) ─────────────────────────────────────────────
 *
 * Minions and Shop Spells that exist only in a DUOS run (Versus Duos and Ranked Duos). They sit OUTSIDE every set
 * manifest: `duosPoolFor(setId)` (sets.ts) appends them to a set's resolved pool, in this order, when their tribe is
 * one of that set's tribes (owner 2026-10-30: "this is for set 2 right now. but cards that sit in tribes in both will
 * carry into set 3/4 etc"). Neutrals and spells join every set. A non-Duos run never sees one.
 *
 * ADDING A CARD: put it in this directory's file for its tribe (one file per tribe: `dragons.ts`, `beasts.ts`, …;
 * create the file the first time a tribe gets one), mark it `duos: true`, and APPEND it to `DUOS_CARDS` below (pool
 * order seeds the Duos Shop). Team effects use the primitives in `sim/duosTeam.ts` (see that header and the
 * `ascent-content` skill).
 */
export const DUOS_CARDS: readonly CardDef[] = [
  ...DUOS_NEUTRAL, ...DUOS_DRAGONS, ...DUOS_SPELLS,
  // Batch A (owner design 2026-10-30): the first Duos cards of these tribes.
  ...DUOS_BEASTS, ...DUOS_DWARVES, ...DUOS_KOBOLDS, ...DUOS_DEMONS,
  // The Discover + pass batch (2026-10-30): Matchmaker, CueBee, Disco.
  ...DUOS_NEUTRAL_DISCOVER_PASS, ...DUOS_SPELLS_DISCOVER_PASS,
  // Duos batch 2 (owner picks 2026-11-01): Double Down, Upgrade Assist.
  ...DUOS_SPELLS_BATCH2,
];
export { DUOS_DRAGONS, DUOS_NEUTRAL, DUOS_SPELLS, DUOS_BEASTS, DUOS_DWARVES, DUOS_KOBOLDS, DUOS_DEMONS };
/** Duos Whispers (CueBee's Pass): granted, never drawable, so NOT in `DUOS_CARDS` (its spells join the Shop pool). */
export { DUOS_WHISPERS };
