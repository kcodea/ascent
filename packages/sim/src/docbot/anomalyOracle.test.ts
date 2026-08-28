/**
 * DOC BOT 2.0 WP F — the ANOMALY ORACLE gate lane (blueprint §9.7/§4.3/§4.5).
 *
 * Gates:
 *  · class discipline (§9.7) — every emitted anomaly is `questionable-interaction` with >= 2 competing
 *    interpretations; NOTHING the oracle emits can carry a verified class, whatever the input;
 *  · the confidence floor (WP A noise control) — below-floor detectors are SUPPRESSED into a visible
 *    count, and lowering the floor releases them (suppression is a dial, not a deletion);
 *  · fingerprint dedup — the same structural anomaly emitted twice is ONE finding;
 *  · determinism (§4.4);
 *  · sabotage (§4.5) — a PLANTED anomaly of each executable detector class is DETECTED: a doctored
 *    multiplier diff, a reorder-sensitive trace, an over-cap summon count, and unstated copy state.
 */
import { describe, expect, it } from 'vitest';
import { allContracts } from '@game/rules/contracts';
import { stableStringify } from '../qaScenario';
import { runAnomalyOracle, RULED_MULTIPLIER_FAMILIES } from './anomalyOracle';
import { runInteractionSweep, type InteractionRun } from './interactionSweep';

const CONTRACTS = allContracts();
const SWEEP = runInteractionSweep({ contracts: CONTRACTS, candidateCap: 3 });
const ORACLE = runAnomalyOracle({ runs: SWEEP.runs, contracts: CONTRACTS });

/** A synthetic covered run to plant anomalies on — the oracle judges traces, not provenance. */
const plantedBase: InteractionRun = {
  family: 'death-x-echo', tier: 'pair', members: ['wolvesden'], verdict: 'covered',
  evidence: 'planted fixture', comboKeys: ['combo:channel:death+trigger:onDeath'],
};

describe('anomaly oracle (§9.7) — the live sweep', () => {
  it('every anomaly is questionable-interaction with competing interpretations — NEVER verified (§4.3)', () => {
    expect(ORACLE.findings.length).toBeGreaterThan(0); // the unruled-multiplier detector has real subjects today
    for (const f of ORACLE.findings) {
      expect(f.class).toBe('questionable-interaction');
      expect(f.severity).toBe('question');
      expect(f.status).toBe('needs-ruling');
      expect(f.competingInterpretations?.length ?? 0, `${f.id} lacks competing interpretations`).toBeGreaterThanOrEqual(2);
    }
  });

  it('is deterministic (§4.4)', () => {
    const again = runAnomalyOracle({ runs: SWEEP.runs, contracts: CONTRACTS });
    expect(stableStringify(again)).toBe(stableStringify(ORACLE));
  });

  it('fingerprints are unique after dedup', () => {
    const fps = ORACLE.findings.map((f) => f.fingerprint);
    expect(new Set(fps).size).toBe(fps.length);
  });

  it('the confidence floor suppresses visibly, and lowering it releases (a dial, not a deletion)', () => {
    // The default floor ('strong') suppresses the two uncertain detectors (unattributed stamps + silent
    // shapes) — visible as counts, never silence.
    expect(ORACLE.suppressedTotal).toBe(Object.values(ORACLE.suppressedByDetector).reduce((a, b) => a + b, 0));
    const lowered = runAnomalyOracle({ runs: SWEEP.runs, contracts: CONTRACTS, confidenceFloor: 'uncertain' });
    expect(lowered.suppressedTotal).toBe(0);
    expect(lowered.findings.length).toBeGreaterThanOrEqual(ORACLE.findings.length);
  });

  it('the unruled-multiplier worklist detector fires on real content and spares the ruled families', () => {
    const unruled = ORACLE.findings.filter((f) => f.detector === 'unruled-multiplier-composition');
    expect(unruled.length, 'the endOfTurn/startOfCombat multiplier cards carry no composition ruling yet — Sitting-2 material').toBeGreaterThanOrEqual(1);
    for (const fam of RULED_MULTIPLIER_FAMILIES) {
      expect(unruled.some((f) => f.summary.includes(`[${fam}]`)), `ruled family '${fam}' flagged as unruled`).toBe(false);
    }
  });
});

describe('anomaly oracle — planted anomalies (§4.5 sabotage: each detector proves it can fire)', () => {
  it('a doctored multiplier diff is detected (multiplier-factor-divergence)', () => {
    const planted: InteractionRun = {
      ...plantedBase, family: 'trigger-x-multiplier', members: ['wolvesden', 'sylus'], verdict: 'failed',
      measurement: { base: 3, variant: 3, expectedFactor: 2 },
    };
    const r = runAnomalyOracle({ runs: [planted], contracts: CONTRACTS });
    const f = r.findings.find((x) => x.detector === 'multiplier-factor-divergence');
    expect(f).toBeDefined();
    expect(f!.class).toBe('questionable-interaction');
  });

  it('a reorder-sensitive trace is detected (irrelevant-change-sensitivity)', () => {
    const planted: InteractionRun = { ...plantedBase, trace: { reorderDelta: 2 } };
    const r = runAnomalyOracle({ runs: [planted], contracts: CONTRACTS });
    expect(r.findings.some((x) => x.detector === 'irrelevant-change-sensitivity')).toBe(true);
  });

  it('an over-cap summon count is detected (extreme-resource-outlier)', () => {
    const planted: InteractionRun = { ...plantedBase, trace: { summonCounts: { footman: 12 } } };
    const r = runAnomalyOracle({ runs: [planted], contracts: CONTRACTS });
    expect(r.findings.some((x) => x.detector === 'extreme-resource-outlier')).toBe(true);
  });

  it('unstated copy state is detected (copied-source-unexpected-state)', () => {
    const planted: InteractionRun = {
      ...plantedBase, family: 'copy-x-counter', members: ['hero:xerox', 'wolvesden'],
      trace: { copyState: { golden: true, counters: { summonBonus: 3 } } },
    };
    const r = runAnomalyOracle({ runs: [planted], contracts: CONTRACTS });
    const f = r.findings.find((x) => x.detector === 'copied-source-unexpected-state');
    expect(f, 'wolvesden states no copySubject.rides — the planted riding state must flag').toBeDefined();
  });

  it('planting the same anomaly twice yields ONE finding (fingerprint dedup)', () => {
    const planted: InteractionRun = { ...plantedBase, trace: { summonCounts: { footman: 12 } } };
    const r = runAnomalyOracle({ runs: [planted, { ...planted }], contracts: CONTRACTS });
    expect(r.findings.filter((x) => x.detector === 'extreme-resource-outlier').length).toBe(1);
  });

  it('no input can produce a verified class: even extreme planted evidence stays a question', () => {
    const planted: InteractionRun = {
      ...plantedBase, family: 'trigger-x-multiplier', verdict: 'failed',
      measurement: { base: 1, variant: 100, expectedFactor: 2 },
      trace: { reorderDelta: 99, summonCounts: { footman: 99 } },
    };
    const r = runAnomalyOracle({ runs: [planted], contracts: CONTRACTS, confidenceFloor: 'uncertain' });
    expect(r.findings.length).toBeGreaterThanOrEqual(3);
    for (const f of r.findings) {
      expect(f.class).toBe('questionable-interaction');
      expect(f.severity).toBe('question');
    }
  });
});
