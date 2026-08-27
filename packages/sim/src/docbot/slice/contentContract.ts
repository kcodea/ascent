/**
 * DOC BOT 2.0 — ContentContract v0 (VERTICAL SLICE — blueprint §6.3 / §19; docs/docbot2/*).
 *
 * PROTOTYPE, deliberately quarantined under docbot/slice/: the schema WP B freezes will be informed by the
 * schema-friction report this slice produces (work-package-plan.md, stage VS exit gate) — expect fields
 * here to move when packages/rules/src/contracts/ lands. Everything beyond identity is OPTIONAL, per the
 * WP A decision ("optional-everything beyond identity").
 *
 * A contract is a statement of INTENT, independent of the implementation (§4.2): the amounts and shapes
 * below were hand-read from printed card text + owner rulings (@game/rules), NOT from the factory params
 * being tested — the contract oracle would otherwise only prove the code agrees with itself.
 *
 * `reviewStatus` (owner-review-pipeline.md §2):
 *   'extracted'    — a draft (hand-authored or tooled); visibly unreviewed (§4.2).
 *   'needs-review' — a triangle leg disagreed; queued for the owner with the mismatch attached.
 *   'corroborated' — MACHINE verdict: contract ≡ runtime trace ≡ displayed text, all legs agreeing.
 *                    NEVER auto-promoted to 'approved' (§23) — a violation of a merely-corroborated
 *                    contract caps at 'questionable-interaction' classification.
 *   'approved'     — an explicit owner ruling covers the contract's load-bearing claims (cite ruleIds).
 *   'exception'    — owner-sanctioned deviation from a family convention.
 */
import { stableStringify, type JsonValue } from '../../qaScenario';

export type ContractReviewStatus = 'extracted' | 'needs-review' | 'corroborated' | 'approved' | 'exception';

export type ContractContentType = 'minion' | 'spell' | 'rune' | 'hero-power' | 'token';

/** When/where the object acts. `event` uses the content schema's trigger vocabulary where one exists. */
export interface TriggerContractV0 {
  event: string;
  phase: 'shop' | 'combat' | 'both';
  /** Threshold triggers (Avenge N): how many qualifying events arm one resolution. */
  threshold?: number;
  note?: string;
}

/** One effect the object is approved to produce. All fields optional — state only what the text/rulings
 *  actually claim; the oracle checks exactly the stated fields and reports the rest as unprobed. */
export interface EffectContractV0 {
  kind: string;
  /** Magnitudes, plain vs gilded, as JSON the oracle can compare structurally. */
  amount?: { plain: JsonValue; gilded?: JsonValue };
  /** Target cardinality + scope ('leftmost-friendly-echo', '2-other-friendly', 'all-shop-minions'…). */
  targets?: { count: number; scope: string };
  /** Summoned/generated card identity + counts. */
  summons?: { cardId: string; count: { plain: number; gilded?: number } };
  note?: string;
}

/** Copy semantics, in the R-COPY-01/02 vocabulary. */
export interface CopyPolicyContractV0 {
  mode: 'plain' | 'exact';
  /** What the ruled mode implies rides along (exact) or is shed (plain) — prose, for the review card. */
  note?: string;
}

/** Trigger-multiplier semantics (Sylus/Zyff/Rune of Fury shapes). `resolutionOnly` restates R-AVWIN-07:
 *  the multiplier re-runs resolution, never progress counting. */
export interface MultiplierContractV0 {
  families: string[];
  extra: number;
  stacks: boolean;
  resolutionOnly?: boolean;
}

export interface ContentContract {
  /** Identity — the only required fields. */
  contentId: string;
  contentType: ContractContentType;
  revision: number;
  reviewStatus: ContractReviewStatus;

  setIds?: string[];
  tribes?: string[];
  keywords?: string[];
  tags?: string[];
  triggers?: TriggerContractV0[];
  effects?: EffectContractV0[];
  /** The gilded difference as one comparable statement (most slice cards: '×2 magnitude/count'). */
  gildedDelta?: { kind: 'multiply' | 'other'; factor?: number; description: string };
  persistence?: Array<'combat-only' | 'permanent' | 'run-wide' | 'this-turn'>;
  copyPolicy?: CopyPolicyContractV0;
  multiplier?: MultiplierContractV0;
  /** The printed text, verbatim (the displayed-text leg of the triangle). */
  textContract?: { text: string; goldenText?: string };
  relatedRuleIds?: string[];
  notes?: string;
}

// ── The comparator (the generic half of the contract oracle) ───────────────────────────────────────────────

/** One engine measurement, addressed at a contract field by dotted path. Probes RECORD; they never judge —
 *  the comparator owns expected-vs-observed so a sabotaged (doctored) contract fails without re-probing. */
export interface ContractObservation {
  contractId: string;
  /** Dotted path into the ContentContract ('effects.0.summons.count.plain', 'copyPolicy.mode', …). */
  path: string;
  observed: JsonValue;
  /** How the number was measured — fixture + counted evidence, one human-verifiable line. */
  evidence: string;
}

export interface ContractMismatch {
  contractId: string;
  path: string;
  expected: JsonValue;
  observed: JsonValue;
  evidence: string;
}

const valueAtPath = (root: unknown, path: string): unknown => {
  let v: unknown = root;
  for (const seg of path.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[seg];
  }
  return v;
};

/** Compare every observation against the contract it addresses. A path the contract does not state is a
 *  mismatch too (expected undefined→null) — an observation of an unstated field means the contract is
 *  incomplete, which must surface, not pass (§4.3). */
export function checkContract(contract: ContentContract, observations: readonly ContractObservation[]): ContractMismatch[] {
  const mismatches: ContractMismatch[] = [];
  for (const o of observations.filter((x) => x.contractId === contract.contentId)) {
    const expected = (valueAtPath(contract, o.path) ?? null) as JsonValue;
    if (stableStringify(expected) !== stableStringify(o.observed)) {
      mismatches.push({ contractId: contract.contentId, path: o.path, expected, observed: o.observed, evidence: o.evidence });
    }
  }
  return mismatches;
}
