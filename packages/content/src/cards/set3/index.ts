import type { CardDef } from '@game/core';
import { SET3_CELESTIALS } from './celestials';

/**
 * ── SET 3 — scaffold only ───────────────────────────────────────────────────────────────────────────────
 *
 * Registered in `sets.ts` and selectable in the Scene Builder's set picker, so content can be played the
 * moment it exists — without flipping the global `enabled` switch and moving real runs onto it.
 *
 * Currently holds the CELESTIAL test units only (owner ask 2026-08-03) — three cards that prove the
 * Alignment + Orbit mechanics. See `celestials.ts`.
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
export const SET3_CARDS: readonly CardDef[] = [...SET3_CELESTIALS];
