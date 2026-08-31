import type { CardDef } from '@game/core';
import { SET3_CELESTIALS } from './celestials';
import { SET3_EQUIPMENT } from './equipment';
import { SET3_KOBOLDS } from './kobolds';

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
export const SET3_CARDS: readonly CardDef[] = [...SET3_CELESTIALS, ...SET3_EQUIPMENT, ...SET3_KOBOLDS];
