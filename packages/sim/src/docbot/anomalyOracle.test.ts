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
  it('the live sweep is CLEAN as of 2026-08-28 — every anomaly it used to raise was RULED, not silenced', () => {
    // The Sitting-2 deck's three cards were all decided on 2026-08-28: the exact-copy card by fixing the
    // incomplete contract (q-interact2-2ad14500), the two composition cards by the ruling that became
    // R-MULT-02. Both causes were removed, so the oracle finds nothing on live content — and every detector
    // is proven still able to fire by the planted cases below. This assertion is a CANARY, not a target: a
    // new anomaly appearing here is expected and healthy (it becomes a Sitting card), so update the count
    // with the story — never by loosening the detectors.
    expect(ORACLE.findings.map((f) => f.title)).toEqual([]);
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

  it('the unruled-multiplier worklist detector spares the ruled families — and every live family is now ruled', () => {
    const unruled = ORACLE.findings.filter((f) => f.detector === 'unruled-multiplier-composition');
    for (const fam of RULED_MULTIPLIER_FAMILIES) {
      expect(unruled.some((f) => f.summary.includes(`[${fam}]`)), `ruled family '${fam}' flagged as unruled`).toBe(false);
    }
    // The owner's Sitting-2 APPROVALS of 2026-08-28 (q-interact2-32aa654f / faeb3c44 → R-MULT-02) took
    // endOfTurn and startOfCombat off this worklist, which empties it against today's content. The detector
    // keeps its teeth: the planted case below proves it still fires on an genuinely unruled family.
    expect(unruled.map((f) => f.title), 'every declared multiplier family on live content now carries a ruled composition law').toEqual([]);
    // …and this is a RULING, not a suppression: nothing about this detector was floored away.
    expect(ORACLE.suppressedByDetector['unruled-multiplier-composition'] ?? 0).toBe(0);
  });

  it('the unruled-multiplier detector still fires on a family with no ruling (it was ruled, not silenced)', () => {
    const planted = { ...CONTRACTS[0]!, contentId: 'planted-multiplier', multiplier: { families: ['orbit'], extra: 1, stacks: false } };
    const r = runAnomalyOracle({ runs: [], contracts: [planted] });
    const unruled = r.findings.filter((f) => f.detector === 'unruled-multiplier-composition');
    expect(unruled.length, 'an unruled family must still reach the Sitting deck').toBe(1);
    expect(unruled[0]!.summary).toContain('[orbit]');
  });

  // OWNER RULING 2026-08-28 (q-interact2-2ad14500): "a xerox copy should be an exact copy, so identical in
  // every way." The live copy probe (hero:xerox copying a gilded, improved Kennelmaster) used to raise a
  // copied-source-unexpected-state anomaly because kennel's contract stated only the summonBonus channel as
  // riding. The CONTRACT was fixed (gilding + every card-owned property now stated) — so the anomaly is gone
  // BECAUSE THE CLAIM IS NOW TRUE, not because a floor swallowed it.
  it('the exact-copy anomaly is gone for the RIGHT reason — contract states the rides, nothing suppressed', () => {
    const copyAnomalies = ORACLE.findings.filter((f) => f.detector === 'copied-source-unexpected-state');
    expect(copyAnomalies.map((f) => f.title), 'no copy anomaly survives on the live sweep').toEqual([]);
    expect(ORACLE.suppressedByDetector['copied-source-unexpected-state'] ?? 0,
      'and none was suppressed below the floor — the detector ran and found nothing').toBe(0);
    // The probe genuinely ran: the sweep measured a copy carrying gilding + a counter.
    const copyRun = SWEEP.runs.find((r) => r.family === 'copy-x-counter' && r.trace?.copyState);
    expect(copyRun?.trace?.copyState, 'the copy probe must still be measuring a gilded, progressed subject')
      .toMatchObject({ golden: true });
    // And the detector still fires for a subject whose contract does NOT state the rides (wolvesden).
    const planted = runAnomalyOracle({
      runs: [{ ...plantedBase, family: 'copy-x-counter', members: ['hero:xerox', 'wolvesden'], trace: { copyState: { golden: true } } }],
      contracts: CONTRACTS,
    });
    expect(planted.findings.some((f) => f.detector === 'copied-source-unexpected-state'), 'the detector keeps its teeth').toBe(true);
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
      expect(f.status).toBe('needs-ruling');
      expect(f.competingInterpretations?.length ?? 0, `${f.id} lacks competing interpretations`).toBeGreaterThanOrEqual(2);
    }
  });
});
