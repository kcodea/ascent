/**
 * DOC BOT 2.0 WP D — the reusable DIFFERENTIAL + METAMORPHIC harness pair (blueprint §9.2/§9.3).
 *
 * `runVariantDiff` is the §9.2 differential primitive: one measurement taken twice — base fixture and a
 * controlled variant (plain vs gilded, rune absent vs present, multiplier 1 vs 2) — with the relation the
 * caller expects ('equal' for no-op laws, 'times' for declared factors). It never interprets the game; the
 * measure functions run the REAL engine and the harness only compares numbers (§4.1).
 *
 * The three §9.3 metamorphic laws ship as generic checks over that primitive:
 *  · irrelevant-reorder-invariance — permuting inert bystanders must not change an unrelated measurement;
 *  · non-applicable-rune-no-op     — arming a rune whose family cannot touch the effect must change nothing;
 *  · gilded-delta-satisfaction     — a gilded body must satisfy its contract's declared multiply factor.
 *
 * Everything is injectable (the measurements are plain closures), so the sabotage suite can doctor one side
 * and prove each law flips to a violation without consulting the engine twice (§4.5).
 */

export type MetamorphicLawId =
  | 'irrelevant-reorder-invariance'
  | 'non-applicable-rune-no-op'
  | 'gilded-delta-satisfaction'
  | 'multiplier-resolution-only'; // R-AVWIN-07's face: progress counting never moves under a resolution multiplier

export type VariantRelation = { kind: 'equal' } | { kind: 'times'; factor: number };

export interface VariantDiffResult {
  base: number;
  variant: number;
  relation: VariantRelation;
  ok: boolean;
}

/** §9.2 — run base and variant, compare under the declared relation. Deterministic given deterministic
 *  measure closures (every driver seeds its rng). */
export function runVariantDiff(
  base: () => number,
  variant: () => number,
  relation: VariantRelation = { kind: 'equal' },
): VariantDiffResult {
  const b = base();
  const v = variant();
  const ok = relation.kind === 'equal' ? v === b : v === b * relation.factor;
  return { base: b, variant: v, relation, ok };
}

export interface MetamorphicCheck {
  law: MetamorphicLawId;
  contractId: string;
  /** What was measured and what the variant changed — one human-verifiable line. */
  detail: string;
  diff: VariantDiffResult;
  /** Rule ids this law leans on, when one exists (R-MULT-01, R-AVWIN-07, …). */
  ruleIds?: string[];
}

export const checkMetamorphic = (
  law: MetamorphicLawId,
  contractId: string,
  detail: string,
  base: () => number,
  variant: () => number,
  relation: VariantRelation = { kind: 'equal' },
  ruleIds?: string[],
): MetamorphicCheck => ({
  law, contractId, detail,
  diff: runVariantDiff(base, variant, relation),
  ...(ruleIds ? { ruleIds } : {}),
});
