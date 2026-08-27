/**
 * DOC BOT 2.0 VERTICAL SLICE — triangle auto-corroboration (owner-review-pipeline.md §2).
 *
 * A MACHINE verdict, computed per run, never hand-stamped and never auto-promoted to 'approved' (§23):
 * an 'extracted' contract advances to 'corroborated' when every probed field agrees with the engine
 * (0 comparator mismatches on ≥1 observation) and no defect/anomaly finding cites it. A
 * wording-recommendation does NOT block corroboration — §11.4 wording advice is about clarity, not text
 * fidelity; the three triangle legs still agree semantically. Anything with a mismatch or a
 * defect/questionable finding demotes to 'needs-review' with the evidence attached — exactly the
 * questionnaire's "text says X, code does Y" card. Contracts already carrying an owner ruling
 * ('approved'/'exception') keep their status; corroboration only moves 'extracted'.
 */
import { checkContract, type ContentContract, type ContractMismatch, type ContractObservation, type ContractReviewStatus } from './contentContract';
import type { DocbotFinding } from '../findings';

const BLOCKING_CLASSES = new Set(['verified-mechanical-bug', 'verified-text-defect', 'questionable-interaction']);

export interface CorroborationVerdict {
  contractId: string;
  /** The status this run's evidence supports (input status for non-'extracted' contracts). */
  status: ContractReviewStatus;
  probed: boolean;
  mismatches: ContractMismatch[];
  blockingFindingIds: string[];
}

export function corroborate(
  contracts: readonly ContentContract[],
  observations: readonly ContractObservation[],
  findings: readonly DocbotFinding[],
): CorroborationVerdict[] {
  return contracts.map((c) => {
    const mismatches = checkContract(c, observations);
    const probed = observations.some((o) => o.contractId === c.contentId);
    const blockingFindingIds = findings
      .filter((f) => (f.contractIds ?? []).includes(c.contentId) && f.class !== undefined && BLOCKING_CLASSES.has(f.class))
      .map((f) => f.id);
    const status: ContractReviewStatus = c.reviewStatus !== 'extracted'
      ? c.reviewStatus
      : mismatches.length > 0 || blockingFindingIds.length > 0
        ? 'needs-review'
        : probed
          ? 'corroborated'
          : 'extracted';
    return { contractId: c.contentId, status, probed, mismatches, blockingFindingIds };
  });
}
