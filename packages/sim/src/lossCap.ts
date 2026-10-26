/**
 * THE ROUND LOSS CAP, as a dependency-free module (2026-10-26). The table itself is unchanged; it lives here so the
 * Versus resolver's server bundle (`versus/server.ts`, which must never import the reducer's VALUES) caps a lost
 * round with the SAME function the lobby does (owner 2026-10-26: Versus uses the lobby's damage and cap).
 * `reducer.ts` re-exports it, so every existing `import { lossDamageCap } from './reducer'` is unchanged.
 */

/** Loss-damage cap by round — the most Resolve (Health) a single loss can cost, ramping up as the game escalates:
 *  5 (rounds 1–3), 10 (4–7), 15 (8–11), 20 (12–14), then UNCAPPED (full damage) from round 15 on (owner ask
 *  2026-10-02: "on turn 15 it should become uncapped"; it was 20 through round 15 before). The normal game's
 *  table only: a lobby with its own `lossCaps` (the Gauntlet) reads that instead, via `roundLossCap`. */
export function lossDamageCap(wave: number): number {
  return wave <= 3 ? 5 : wave <= 7 ? 10 : wave <= 11 ? 15 : wave <= 14 ? 20 : Infinity;
}
