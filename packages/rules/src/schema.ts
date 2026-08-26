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
  /** The Doc Bot queue a pending item was seeded from (its enforcement home). */
  sourceQueue?: string;
  /** Content ids this rule governs, when it is content-specific. */
  contentIds?: string[];
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
