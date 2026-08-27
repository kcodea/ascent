/**
 * DOC BOT 2.0 WP F — anomaly findings → the owner's SITTING-2 question deck (owner-review-pipeline.md;
 * the conventionQuestions.ts pattern, reused verbatim in spirit).
 *
 * Every surviving anomaly (post floor + dedup) becomes ONE pending question card at the fly-through
 * language bar (owner 2026-08-27): one short statement (≤ 30 words before the micro-tail), one concrete
 * example with verbatim printed text, the compact ✓/✕/✎ click tail. Cards land as pending rules through
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
import type { AnomalyFinding } from './anomalyOracle';

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

/** ≤30 words, one sentence — trim the detector prose to the bar, never past sense. */
const shortStatement = (detector: string, members: string[]): string => {
  const who = members.slice(0, 2).map(nameOf).join(' + ') || 'this interaction';
  switch (detector) {
    case 'multiplier-factor-divergence':
      return `${who}: the measured multiplier fold deviates from the declared factor — is the deviation intended?`;
    case 'irrelevant-change-sensitivity':
      return `${who}: board position changes this effect's output though its text states no position — intended?`;
    case 'copied-source-unexpected-state':
      return `${who}: a copy carries per-instance state the card's contract never states as riding — intended?`;
    case 'extreme-resource-outlier':
      return `${who}: one fight produced summons beyond the board cap — looping resolution or legitimate churn?`;
    case 'unruled-multiplier-composition':
      return `${who}: no ruling states how its multiplier families compose (stacking, cross-card collapse, phase symmetry) — rule it like Battlecry/Echo/Rally?`;
    default:
      return `${who}: structurally suspicious interaction behaviour needs a ruling.`;
  }
};

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
        ? { recommendation: `Reading A: ${interpretations[0].interpretation}. Reading B: ${interpretations[1]?.interpretation ?? '(none)'} — approve endorses Reading A.` }
        : {}),
      cardText: exemplar
        ? `${nameOf(exemplar)}: "${textOf(exemplar)}"`
        : `(no printed card text — the subjects are ${f.contentIds.join(', ') || 'system-level'})`,
      example: f.observed !== undefined
        ? `Measured: ${typeof f.observed === 'string' ? f.observed : JSON.stringify(f.observed)} where the structural expectation was ${typeof f.expected === 'string' ? f.expected : JSON.stringify(f.expected)}.`
        : f.summary,
      sourceQueue: INTERACTION_QUEUE,
      ...(resolvable(f.contentIds).length ? { contentIds: resolvable(f.contentIds) } : {}),
      enforcement: INTERACTION_ENFORCEMENT,
    });
  }
  return rules;
}
