/**
 * TEST FIXTURES for the damage formation (imported by the style suites only; nothing in the app imports this). The
 * old style tests described a blow as "parts" (the tier first, then the survivors); these turn that shape into the
 * formation the runners take now, and give the formation's length for a plan's `leadIn`.
 */
import type { FormationData } from './damageFormation';
import { FORMATION_DEFAULTS, formationPlan, type FormationConfig } from './formationConfig';

/** `[heroTier, ...minionTiers]` + the blow that lands -> the formation (capped when the parts sum past it). */
export function formationOf(values: readonly number[], total: number, from: { x: number; y: number } = { x: 600, y: 500 }): FormationData {
  const [hero = 0, ...minions] = values;
  const full = values.reduce((s, v) => s + v, 0);
  return {
    hero: values.length ? { value: hero } : null,
    minions: minions.map((value, i) => ({ value, at: { x: from.x + i * 120, y: from.y } })),
    full: Math.max(full, total),
    total,
    cap: full > total ? total : null,
  };
}

/** The formation's length for `[heroTier, ...minionTiers]` (a plan's `leadIn`), at the shipped defaults. */
export function leadInOf(values: readonly number[], reduced = false, capped = false, c: FormationConfig = FORMATION_DEFAULTS): number {
  return formationPlan({ minions: Math.max(0, values.length - 1), hero: values.length > 0, capped, reduced }, c).endAt;
}
