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

/**
 * Does a combat BODY count as `tribe`? Its printed + folded tribes (`tribe`, `tribe2`, where combat folds an Anomaly
 * Reactor added type), its per-instance All mark (`universalTribe`), or an All-types CardDef (`def`). Neutral is never
 * a type, so an All-types body is not "a neutral". R-ALL-TYPES-EVERYWHERE-01 (owner 2026-10-21): the raw
 * `m.tribe === t || m.tribe2 === t` checks this replaced missed All-types bodies.
 */
export function bodyIsTribe(
  m: { tribe?: string; tribe2?: string; universalTribe?: boolean },
  tribe: string,
  def?: CardDef,
): boolean {
  if (m.tribe === tribe || m.tribe2 === tribe) return true;
  return tribe !== 'neutral' && (!!m.universalTribe || !!def?.universalTribe);
}
