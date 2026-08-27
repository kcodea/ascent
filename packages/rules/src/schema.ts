/**
 * THE RULEBOOK SCHEMA — the owner's Complete Rulebook blueprint (Codex, 2026-06-29), first increment.
 *
 * The registry exists to break Doc Bot's one remaining circularity: every Doc Bot lane compares the
 * implementation to itself (a control body, its own params, a second run). A rule here is a statement of
 * INTENT with an explicit approval status — the implementation can never approve it, only conform to it.
 *
 * Doctrine (from the blueprint, non-negotiable):
 *  · Evidence supports a candidate; evidence never approves it. Only an owner decision approves.
 *  · Undefined behaviour is `needs-ruling`, never silently inferred correct.
 *  · Rule ids are stable and never recycled.
 */

export type RuleStatus = 'approved' | 'needs-ruling' | 'revised' | 'rejected';

export type RuleDomain =
  | 'foundation' | 'actions' | 'economy' | 'categories' | 'targeting' | 'copying' | 'gilding'
  | 'triggers' | 'multipliers' | 'ordering' | 'combat' | 'summoning' | 'keywords' | 'auras'
  | 'randomness' | 'persistence' | 'heroes' | 'runes' | 'gifts' | 'text';

export interface RuleEvidence {
  /** Where this came from: an owner handoff, a Doc Bot scan, a fix PR, a code comment. */
  kind: 'owner-handoff' | 'owner-chat' | 'docbot-scan' | 'fix-pr' | 'code' | 'test' | 'card-text';
  /** A locator a human can follow — a path, a PR number, a scan + item id. */
  ref: string;
  /** The load-bearing sentence, quoted, when one exists. */
  quote?: string;
}

/**
 * ENFORCEMENT — how an approved ruling is machine-checked (the §10.3 closed loop: every decision becomes
 * an executable contract or an explicit classification).
 *  · `scenario` / `property` — refs are repo-relative test-file paths; a ref that doesn't exist on disk
 *    fails the registry integrity test (anti-rot: a deleted pin un-enforces its rule LOUDLY).
 *  · `oracle`   — refs are lane names from `ENFORCEMENT_LANES` (a Doc Bot scan/registry that re-alarms if
 *    the pinned behaviour drifts); unknown lane names fail loudly the same way.
 *  · `manual`   — valid ONLY for genuinely visual/design rulings; requires `reason`.
 */
export type EnforcementKind = 'scenario' | 'oracle' | 'property' | 'manual';

export interface RuleEnforcement {
  kind: EnforcementKind;
  /** Test-file paths (scenario/property) or lane names (oracle). May be empty only for `manual`. */
  refs: string[];
  /** Required for `manual`: why this ruling genuinely cannot carry an executable probe. */
  reason?: string;
  /** ISO date the refs were last confirmed to pin the ruling (set when a human/agent actually checked). */
  lastVerifiedAt?: string;
}

export interface GameRule {
  /** Stable, never recycled. Approved rules: `R-<DOMAIN>-<NN>`. Pending queue items: `q-<queue>-<item>`. */
  id: string;
  title: string;
  /** The owner-readable statement of intent. For pending items this is the QUESTION, phrased so that
   *  "approve" endorses the recommendation. */
  statement: string;
  domain: RuleDomain;
  status: RuleStatus;
  evidence: RuleEvidence[];
  /** What the implementation does TODAY — so a decision is made against facts, not memory. */
  currentBehaviour?: string;
  /** Claude's recommendation. Approving a pending item adopts it; revising replaces it with the note. */
  recommendation?: string;
  /** The printed text of the card/rune/power in question, verbatim — every card must stand alone
   *  (owner format feedback 2026-08-26: "i have no idea what the rune does without looking it up"). */
  cardText?: string;
  /** One concrete example of the situation being ruled on. */
  example?: string;
  /** The Doc Bot queue a pending item was seeded from (its enforcement home). */
  sourceQueue?: string;
  /** Content ids this rule governs, when it is content-specific. */
  contentIds?: string[];
  /** How this rule is machine-checked. Hand-authored rules declare it inline; generated (pending) rules
   *  get theirs from `RULE_ENFORCEMENT` in enforcement.ts so it survives re-seeding. An approved/revised
   *  rule with NO enforcement lands in the approved-but-unenforced queue (ratcheted in enforcement.test.ts). */
  enforcement?: RuleEnforcement;
}

/** An owner decision recorded by the Rulebook Triage board (or by hand). Keyed by rule id. */
export interface RuleDecision {
  decision: 'approve' | 'revise' | 'reject';
  /** Required for `revise`: the owner's wording that replaces the recommendation. */
  note?: string;
  decidedAt: string;
}

export type DecisionMap = Record<string, RuleDecision>;

/** A rule's effective status once decisions are folded in. */
export function effectiveStatus(rule: GameRule, decisions: DecisionMap): RuleStatus {
  const d = decisions[rule.id];
  if (!d) return rule.status;
  return d.decision === 'approve' ? 'approved' : d.decision === 'revise' ? 'revised' : 'rejected';
}
