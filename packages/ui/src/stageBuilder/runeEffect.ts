import { runeCombatModsFor } from '@game/sim';

/**
 * Does a rune do anything for an AUTHORED Gauntlet opponent? That opponent has no recruit phase, so only a rune
 * that leaves a combat modifier acts for it (`runeCombatModsFor`); a shop-only rune (Gold, refreshes, Discovers,
 * End of Turn) does nothing and the Stage Builder greys it out.
 *
 * "Leaves a modifier" = some field of the mods is DEFINED. `questCombatMods` returns an object literal that names
 * every field, most as `undefined`, so a bare `Object.keys(...).length` would call every rune active.
 *
 * Memoized per rune id in a module Map: each call builds a scratch run. The first full pass over every rune
 * (364 runes) measured ~25 ms under node on 2026-09-29 — far under a frame budget for a one-off, so the panel
 * computes it synchronously rather than in idle chunks.
 */
const cache = new Map<string, boolean>();

export function runeActsForOpponent(id: string): boolean {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const mods: object = runeCombatModsFor([id]);
  const acts = Object.values(mods).some((v) => v !== undefined);
  cache.set(id, acts);
  return acts;
}
