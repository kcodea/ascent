/**
 * DOC BOT 2.0 WP F — anomaly findings → the owner's SITTING-2 question deck (owner-review-pipeline.md;
 * the conventionQuestions.ts pattern, reused verbatim in spirit).
 *
 * Every surviving anomaly (post floor + dedup) becomes ONE pending question card at the fly-through
 * language bar (owner 2026-08-27): one short statement (≤ 30 words before the micro-tail), one concrete
 * example with verbatim printed text, the compact ✓/✕/✎ click tail. The statement states WHAT WAS OBSERVED
 * and WHAT EACH CLICK MEANS on its face — the owner could not tell what the copy card was asking
 * (2026-08-28, q-interact2-2ad14500: "I do not understand this ask"), so the two competing readings are no
 * longer left for the reader to reconstruct out of `recommendation`. Cards land as pending rules through
 * the EXISTING registry mechanism — the docbot-interactions CLI runs the shared seed hygiene (decisions
 * survive; rejects tombstone) and writes `packages/rules/src/registry/pendingInteractions.generated.ts`.
 *
 * THE DECK SHIPS DORMANT: nothing here schedules a sitting — the main session does. Approving a card
 * writes one decision; the anomaly's fingerprint keys the id, so a re-run neither duplicates a decided
 * card nor loses an undecided one. Class discipline (§9.7/§4.3): these cards ask, they never assert — the
 * competing interpretations ride in `currentBehaviour`/`recommendation`.
 */
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import type { GameRule, RuleEnforcement } from '@game/rules'; // type-only: erased at build, never bundles the registry
import type { AnomalyDetectorId, AnomalyFinding } from './anomalyOracle';

export const INTERACTION_QUEUE = 'docbot.interactions';

/** Inline enforcement every interaction card carries: the interaction sweep re-alarms when the measured
 *  pair behaviour drifts from whatever the owner rules. Survives regeneration (always stamped). */
const INTERACTION_ENFORCEMENT: RuleEnforcement = { kind: 'oracle', refs: ['interactionSweep'] };

// The owner's fly-through bar (2026-08-27): one compact tail, identical everywhere.
const CLICK_TAIL = ' — ✓ yes · ✕ no (say why) · ✎ your wording';

const plain = (t?: string): string => (t ?? '').replace(/\*\*/g, '');
const nameOf = (id: string): string => CARD_INDEX[id]?.name ?? RUNE_INDEX[id]?.name ?? id;
const textOf = (id: string): string => plain(CARD_INDEX[id]?.text ?? (RUNE_INDEX[id] as { text?: string } | undefined)?.text);

/** contentIds on a GameRule must resolve in CARD_INDEX / RUNE_INDEX / QUEST_DEFS (registry integrity) —
 *  hero:<id> and other namespaced ids ride the prose instead. */
const resolvable = (ids: readonly string[]): string[] =>
  ids.filter((id) => !!CARD_INDEX[id] || !!RUNE_INDEX[id]).sort();

/**
 * ONE short sentence, ≤30 words: WHAT WAS OBSERVED, then what each click MEANS (owner feedback 2026-08-28 on
 * q-interact2-2ad14500 — "I do not understand this ask"). The old template named a detector's abstraction
 * ("per-instance state the contract never states as riding") and left the reader to reconstruct the two
 * competing readings from the recommendation field; every card now says the observation and the ✓/✕ meaning
 * on its face. The rules.test.ts ratchet counts the words BEFORE the first em-dash, which is where the
 * compact click tail begins — so this string must stay one plain sentence pair.
 */
const shortStatement = (detector: string, members: string[]): string => {
  const who = members.slice(0, 2).map(nameOf).join(' + ') || 'this interaction';
  switch (detector) {
    case 'multiplier-factor-divergence':
      return `${who}: the fold missed the card's promised factor. ✓ = right as measured; ✕ = the multiplier is dropped`;
    case 'irrelevant-change-sensitivity':
      return `${who}: moving it between inert neighbours changed its output. ✓ = it really is positional; ✕ = a positional leak`;
    case 'copied-source-unexpected-state':
      return `${who}: the copy came out carrying the original's own instance state. ✓ = intended, copies carry it; ✕ = the copy carries too much`;
    case 'extreme-resource-outlier':
      return `${who}: one fight summoned more bodies than a board holds. ✓ = churn as slots free; ✕ = resolution is looping`;
    case 'unruled-multiplier-composition':
      return `${who}: nothing states how two of these multipliers combine. ✓ = fold like Shouts (best-of across cards); ✕ = needs its own rule`;
    default:
      return `${who}: this interaction behaves in a way no rule covers. ✓ = correct as-is; ✕ = wrong (say what you expected)`;
  }
};

/** One CONCRETE example in plain words: what was measured against what was expected. Never the finding's
 *  internal vocabulary alone — the card must stand alone for a reader who has never seen the oracle. */
const plainExample = (f: AnomalyFinding): string => {
  if (f.observed === undefined) return f.summary;
  const obs = typeof f.observed === 'string' ? f.observed : JSON.stringify(f.observed);
  const exp = typeof f.expected === 'string' ? f.expected : JSON.stringify(f.expected);
  return `What the probe recorded: ${obs}. What the card/contract implied instead: ${exp}.`;
};

/**
 * WHICH competing reading the ✓ click endorses, per detector — so the card's authored "✓ = …" text and the
 * recommendation can never disagree (they did, before 2026-08-28: the statement said ✓ meant "intended"
 * while the recommendation said ✓ endorsed the bug reading, which is exactly the kind of thing that makes a
 * card unanswerable). The board-wide convention holds here: ✓ APPROVE means the measured behaviour is ruled
 * CORRECT, ✕ REJECT means it is a bug. Detector F's readings are authored in that order already; every other
 * detector lists the bug reading first, so the intended reading is its second.
 */
const APPROVE_ENDORSES: Partial<Record<AnomalyDetectorId, 0 | 1>> = { 'unruled-multiplier-composition': 0 };
const approveIndex = (detector: AnomalyDetectorId): 0 | 1 => APPROVE_ENDORSES[detector] ?? 1;

/** Build the Sitting-2 deck from anomaly findings. Pure and deterministic: ids key on the finding
 *  fingerprint, output sorted by id. */
export function buildInteractionQuestions(anomalies: readonly AnomalyFinding[]): GameRule[] {
  const rules: GameRule[] = [];
  for (const f of [...anomalies].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (f.class !== 'questionable-interaction') continue; // the deck carries questions only, by construction
    const detector = f.detector;
    const exemplar = f.contentIds.find((id) => !!CARD_INDEX[id] || !!RUNE_INDEX[id]);
    const interpretations = f.competingInterpretations ?? [];
    rules.push({
      id: `q-interact2-${f.fingerprint}`,
      title: f.title,
      statement: shortStatement(detector, f.contentIds) + CLICK_TAIL,
      domain: detector === 'unruled-multiplier-composition' ? 'multipliers' : 'triggers',
      status: 'needs-ruling',
      evidence: [{ kind: 'docbot-scan', ref: `${INTERACTION_QUEUE}:${detector}` }],
      currentBehaviour: f.summary,
      ...(interpretations[0]
        ? {
          recommendation: `✓ approve = ${interpretations[approveIndex(detector)]?.interpretation ?? interpretations[0].interpretation}. `
            + `✕ reject = ${interpretations[1 - approveIndex(detector)]?.interpretation ?? '(no competing reading recorded)'}.`,
        }
        : {}),
      cardText: exemplar
        ? `${nameOf(exemplar)}: "${textOf(exemplar)}"`
        : `(no printed card text — the subjects are ${f.contentIds.join(', ') || 'system-level'})`,
      example: plainExample(f),
      sourceQueue: INTERACTION_QUEUE,
      ...(resolvable(f.contentIds).length ? { contentIds: resolvable(f.contentIds) } : {}),
      enforcement: INTERACTION_ENFORCEMENT,
    });
  }
  return rules;
}
