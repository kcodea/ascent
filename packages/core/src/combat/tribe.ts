import type { CardDef, Tribe } from '../types';

/**
 * Does a CARD DEFINITION belong to `tribe`? The one def-level predicate for combat code — primary tribe,
 * secondary tribe, or an all-types card (Paragon, Lab Experiment: `universalTribe`). A raw `def.tribe === t`
 * misses the second tribe and the all-types cards (owner ruling 2026-08-26); the tribe-predicate ratchet fails
 * a file that grows one. For a BODY use the arena's `isTribe` (it also folds in combat-added tribes).
 */
export function defIsTribe(def: CardDef | undefined, tribe: Tribe): boolean {
  if (!def) return false;
  if (def.universalTribe) return true;
  return def.tribe === tribe || def.tribe2 === tribe;
}
