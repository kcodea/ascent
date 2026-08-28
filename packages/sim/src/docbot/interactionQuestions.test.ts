/**
 * DOC BOT 2.0 WP F — the SITTING-2 CARD TEMPLATE (interactionQuestions.ts).
 *
 * The owner's 2026-08-28 decision on q-interact2-2ad14500 was, verbatim, "I do not understand this ask" —
 * an INSTRUMENT failure, not a content one: the card named a detector's abstraction ("per-instance state the
 * card's contract never states as riding") and left the two competing readings to be reconstructed out of
 * the recommendation field. This suite pins the rewritten bar, per detector, INDEPENDENTLY of whatever the
 * live deck currently holds (today: nothing — every Sitting-2 card was decided and its cause fixed, so
 * rules.test.ts's format assertions over INTERACTION_PENDING pass vacuously and would not catch a
 * regression here).
 *
 * Every generated card must state, on its face:
 *   · WHAT WAS OBSERVED — in plain words, no oracle vocabulary required;
 *   · what ✓ MEANS and what ✕ MEANS — the two competing readings, spelled out;
 *   · the compact ✓/✕/✎ click tail, at the fly-through bar (≤ 30 words before the micro-tail).
 * Plus one concrete example, the exemplar's verbatim printed text, and its enforcement pin.
 */
import { describe, expect, it } from 'vitest';
import { allContracts } from '@game/rules/contracts';
import { runAnomalyOracle, type AnomalyDetectorId } from './anomalyOracle';
import { buildInteractionQuestions, INTERACTION_QUEUE } from './interactionQuestions';
import type { InteractionRun } from './interactionSweep';

const CONTRACTS = allContracts();

/** One planted run per EXECUTABLE detector — the deck must read well for each shape, not just the one the
 *  live sweep happens to raise this week. */
const plantedBase: InteractionRun = {
  family: 'death-x-echo', tier: 'pair', members: ['wolvesden'], verdict: 'covered',
  evidence: 'planted fixture', comboKeys: ['combo:channel:death+trigger:onDeath'],
};

const PLANTED: Array<{ detector: AnomalyDetectorId; run: InteractionRun }> = [
  {
    detector: 'multiplier-factor-divergence',
    run: { ...plantedBase, family: 'trigger-x-multiplier', members: ['wolvesden', 'sylus'], verdict: 'failed', measurement: { base: 3, variant: 3, expectedFactor: 2 } },
  },
  { detector: 'irrelevant-change-sensitivity', run: { ...plantedBase, trace: { reorderDelta: 2 } } },
  {
    detector: 'copied-source-unexpected-state',
    run: { ...plantedBase, family: 'copy-x-counter', members: ['hero:xerox', 'wolvesden'], trace: { copyState: { golden: true, counters: { summonBonus: 3 } } } },
  },
  { detector: 'extreme-resource-outlier', run: { ...plantedBase, trace: { summonCounts: { footman: 12 } } } },
];

/** The ratchet's own word count, replicated: everything before the first em-dash, which is where the
 *  compact click tail begins (rules.test.ts, "the fly-through bar"). */
const words = (statement: string): number =>
  (statement.split('—')[0] ?? statement).trim().split(/\s+/).filter(Boolean).length;

const cardsFor = (run: InteractionRun) =>
  buildInteractionQuestions(runAnomalyOracle({ runs: [run], contracts: CONTRACTS }).findings);

describe('Sitting-2 card template — every anomaly card stands alone (owner feedback 2026-08-28)', () => {
  for (const { detector, run } of PLANTED) {
    it(`${detector}: states the observation, both click meanings, and stays at the fly-through bar`, () => {
      const cards = cardsFor(run);
      const card = cards.find((c) => c.evidence.some((e) => e.ref === `${INTERACTION_QUEUE}:${detector}`));
      expect(card, `no card generated for detector '${detector}'`).toBeDefined();
      const c = card!;
      // The format bar the ratchet enforces.
      expect(c.id).toMatch(/^q-interact2-[0-9a-f]{8}$/);
      expect(c.status).toBe('needs-ruling');
      expect(words(c.statement), `${c.id} is over the fly-through bar: "${c.statement}"`).toBeLessThanOrEqual(30);
      expect(c.statement).toContain('✓ yes');
      expect(c.statement).toContain('✕ no');
      expect(c.statement).toContain('✎');
      // …and the NEW half: what was observed, and what each click means, on the card's face.
      expect(c.statement, `${c.id} never says what ✓ means`).toContain('✓ =');
      expect(c.statement, `${c.id} never says what ✕ means`).toContain('✕ =');
      // The statement is a plain sentence about the observation before it explains the clicks.
      const observed = c.statement.split('✓ =')[0]!.trim();
      expect(observed.length, `${c.id} states no observation before the click meanings`).toBeGreaterThan(20);
      // Self-contained: printed text, a concrete example, current behaviour, evidence, queue, enforcement.
      expect(c.cardText).toBeTruthy();
      expect(c.example, `${c.id} has no concrete example`).toBeTruthy();
      expect(c.currentBehaviour).toBeTruthy();
      expect(c.sourceQueue).toBe(INTERACTION_QUEUE);
      expect(c.enforcement?.kind).toBe('oracle');
      // The competing readings ride the recommendation in click terms, never as "Reading A/B" jargon.
      expect(c.recommendation, `${c.id} carries no reading pair`).toContain('✓ approve =');
      expect(c.recommendation).toContain('✕ reject =');
    });
  }

  it('the statement and the recommendation agree about what ✓ means (the 2026-08-28 inversion)', () => {
    // Before the rewrite these disagreed: the statement offered ✓ as "intended" while the recommendation
    // said approve endorsed the BUG reading — an unanswerable card. The board-wide convention is that ✓
    // approves the measured behaviour, so the intended reading must be the ✓ half everywhere.
    const copy = cardsFor(PLANTED.find((p) => p.detector === 'copied-source-unexpected-state')!.run)[0]!;
    expect(copy.statement).toContain('✓ = intended');
    expect(copy.recommendation!.split('✕ reject =')[0], 'the ✓ half must be the intended reading').toContain('intended');
    expect(copy.recommendation!.split('✕ reject =')[1], 'the ✕ half must be the bug reading').toContain('bug');
  });

  it('a long two-member subject still fits the bar (the name budget is real)', () => {
    // The widest subject the template can face today: two multi-word content names.
    const cards = cardsFor({ ...plantedBase, family: 'trigger-x-multiplier', members: ['uron', 'zyff'], verdict: 'failed', measurement: { base: 1, variant: 3, expectedFactor: 2 } });
    expect(cards.length).toBe(1);
    expect(words(cards[0]!.statement), cards[0]!.statement).toBeLessThanOrEqual(30);
  });

  it('is deterministic and question-only (the deck never asserts)', () => {
    const once = JSON.stringify(PLANTED.flatMap(({ run }) => cardsFor(run)));
    const twice = JSON.stringify(PLANTED.flatMap(({ run }) => cardsFor(run)));
    expect(twice).toBe(once);
    for (const { run } of PLANTED) for (const c of cardsFor(run)) expect(c.status).toBe('needs-ruling');
  });
});
