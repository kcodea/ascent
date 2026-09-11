import type { CardDef } from '@game/core';
import { SET3_CELESTIALS } from './celestials';
import { SET3_EQUIPMENT } from './equipment';
import { SET3_KOBOLDS } from './kobolds';
import { SET3_NEUTRAL } from './neutral';
import { SET3_SPIRITS, REVELER_IDS } from './spirits';
export { SET3_SPELLS } from './spells';
export { SET3_DWARVES } from './dwarves';
export { SET3_UNDEAD } from './undead';

/**
 * ── SET 3 — scaffold only ───────────────────────────────────────────────────────────────────────────────
 *
 * Registered in `sets.ts` and selectable in the Scene Builder's set picker, so content can be played the
 * moment it exists — without flipping the global `enabled` switch and moving real runs onto it.
 *
 * Currently holds the EQUIP minions only. The Celestial tribe that lived here was archived on 2026-08-28
 * ("extremely and completely re-worked — leaving set 3 empty of minions now"), so `celestials.ts` is an empty
 * roster waiting for the rework, and `equipment.ts` carries the Equipment vertical slice.
 *
 * When cards arrive, they go in SIBLING FILES here (`kobolds.ts`, `beasts.ts`, …) and get opted into
 * `SETS.set3.own` in declaration order, exactly as set 2 does. Two rules from `sets.ts` that matter most:
 *
 *  - **Never append set-3 cards to a set-1/set-2 tribe file.** A set's pool ORDER and SIZE are load-bearing
 *    (shop draws are `rng.int(pool.length)` over it), so authoring set 3 in its own files is what keeps it
 *    from perturbing the other sets' seeds.
 *  - **Only DRAWABLE cards belong in a set.** Tokens stay global — they're reachable only through a card
 *    that names them, so they can never leak across sets.
 *
 * An empty set draws an empty shop. That is expected here, not a bug: the Scene Builder prints its pool
 * counts and warns "this set has no cards yet" precisely so it reads as scaffolding.
 */
// The Dwarves (`dwarves.ts`, 2026-09-09) are deliberately NOT folded in here: `SETS.set3.own` places them AFTER
// the carried-over set-2 Kobolds, because appending to this list would insert them ahead of those Kobolds and
// reseed every set-3 shop. The manifest spells the order out; this list stays the pre-Dwarf prefix.
export const SET3_CARDS: readonly CardDef[] = [...SET3_CELESTIALS, ...SET3_EQUIPMENT, ...SET3_KOBOLDS];

/** Set 3's own NEUTRALS (2026-09-09) — appended after the Undead in `SETS.set3.own`, never folded into
 *  `SET3_CARDS`, for the same positions-never-move reason as the Dwarves and Undead. */
export { SET3_NEUTRAL };
/** Set 3's SPIRITS (2026-09-09, a new tribe) — appended after the Neutrals in `SETS.set3.own`. */
export { SET3_SPIRITS, REVELER_IDS };
