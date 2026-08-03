import type { CardDef } from '@game/core';

/**
 * ── HENCHMEN — hero-bound recruits (owner spec 2026-08-03) ─────────────────────────────────────────────
 *
 * A henchman is a MINION like any other — Shouts, Echoes, whatever its design calls for — with three rules
 * that make it a mechanic rather than a card:
 *
 *  1. **Every hero has one, specific to that hero.** The link lives on `HeroDef.henchman` (`@game/sim`),
 *     which names the card id and its STARTING Gold cost.
 *  2. **It is never offered in shops** (unless a future card explicitly says so). Henchmen live in this
 *     GLOBAL registry — the same doctrine as tokens: reachable only through the thing that names them (the
 *     hero), so they can never leak into a set's drawable pool. They are deliberately NOT part of any
 *     `SETS.*.own` list.
 *  3. **Its cost falls every round, keyed to the round's result** — WIN −3 Gold, LOSS −2 Gold — until it
 *     hits 0. The decay is tracked on the run (`henchmanDiscount`), not the card, so the printed card stays
 *     pure data. Recruiting is once per run (`buyHenchman` in the reducer).
 *
 * Likely the SET-3 mechanic, but the system is deliberately CROSS-SET — like Fi's errand or the Runesmith's
 * forge, heroes that interact with it can appear in any set. That is why the registry is global rather than
 * a set-3 file: a hero carries its henchman wherever it plays.
 *
 * The real roster lands here as it's designed. `hm_test_squire` below is a PLACEHOLDER wired to the Warden
 * (a `wip` hero withheld from the picker), so the whole loop is playable in the Scene Builder — and pinned
 * by tests — without touching a live hero.
 */
export const HENCHMEN: readonly CardDef[] = [
  {
    // PLACEHOLDER — proves the loop (hero link → cost decay → recruit-to-hand). Replace with the real
    // roster; keep it wired to a `wip` hero until henchmen ship.
    id: 'hm_test_squire',
    name: 'Test Squire',
    tribe: 'neutral',
    tier: 1,
    attack: 3,
    health: 3,
    keywords: [],
    henchman: true,
    effects: [],
    text: '**Henchman.** Placeholder body — the real roster replaces this.',
  },
];
