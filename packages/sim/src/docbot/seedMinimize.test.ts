/**
 * DOC BOT — SEED MINIMIZATION (handoff §9.3 + §15 "failure minimizer preserves the failure", PR 8).
 *
 * The minimizer is proven against a SYNTHETIC PLANTED FAILURE (§3.5): a predicate the test injects
 * ("the run reached wave ≥ 3") that only a subset of a 120-step random trace actually causes. The proofs:
 *
 *   · the minimized trajectory STILL fails the predicate (preservation — the §15 requirement);
 *   · it is 1-MINIMAL: dropping ANY single remaining action makes the predicate pass, checked directly,
 *     not trusted from the fixpoint flag;
 *   · minimization is deterministic (same spec + predicate → identical minimized action list);
 *   · a passing spec minimizes to null (the minimizer never fabricates a failure);
 *   · the minimized spec folds into a VALID QaScenarioV1 whose repro line is the checked-in CLI.
 *
 * SABOTAGE: with the predicate inverted to never-fail, `minimizeFailure` returned null (no fabrication);
 * with the drop-one loop doctored to skip re-checking (always "keep the removal"), the 1-minimality and
 * preservation assertions both went red for the intended reason.
 */
import { describe, expect, it } from 'vitest';
import { validateQaScenario } from '../qaScenario';
import { driveTrajectory, type DriveOutcome } from './trajectory';
import { minimizeFailure, specToScenario, scenarioRepro, type TrajectorySpec } from './seedMinimize';

/** The planted failure: "this trajectory reached wave 3+" — only wave-advancing actions matter, so a
 *  random 120-step trace minimizes hard (everything but the combat loop drops out). */
const reachedWave3 = (o: DriveOutcome): string | null => (o.final.wave >= 3 ? `reached wave ${o.final.wave}` : null);

const SEED = 4242;

function plantedSpec(): TrajectorySpec {
  const fuzz = driveTrajectory({ seed: SEED, generate: { steps: 120, rngSeed: 0xabc }, roundtripEvery: 0 });
  expect(fuzz.final.wave, 'the planted trace must actually reach wave 3 for the test to mean anything').toBeGreaterThanOrEqual(3);
  return { seed: SEED, actions: fuzz.actions };
}

describe('Doc Bot — trajectory minimization (§9.3)', () => {
  it('greedy drop-one preserves the planted failure and reaches true 1-minimality', () => {
    const spec = plantedSpec();
    const result = minimizeFailure(spec, reachedWave3);
    expect(result, 'the original spec fails the predicate, so minimization must produce a result').not.toBeNull();
    const { spec: min, oneMinimal } = result!;

    // Preservation: the minimized trace still fails.
    expect(reachedWave3(driveTrajectory({ seed: SEED, actions: min.actions }))).not.toBeNull();
    // It shrank (a 120-step random trace is nowhere near minimal for "reach wave 3").
    expect(min.actions.length).toBeLessThan(spec.actions.length);
    expect(oneMinimal).toBe(true);
    // 1-minimality, checked DIRECTLY: dropping any single remaining action loses the failure.
    for (let i = 0; i < min.actions.length; i++) {
      const dropped = [...min.actions.slice(0, i), ...min.actions.slice(i + 1)];
      expect(
        reachedWave3(driveTrajectory({ seed: SEED, actions: dropped })),
        `dropping action ${i} (${min.actions[i]!.type}) should lose the failure at a true fixpoint`,
      ).toBeNull();
    }
  });

  it('is deterministic: the same spec + predicate minimize to the identical action list', () => {
    const spec = plantedSpec();
    const a = minimizeFailure(spec, reachedWave3)!;
    const b = minimizeFailure(spec, reachedWave3)!;
    expect(JSON.stringify(b.spec.actions)).toBe(JSON.stringify(a.spec.actions));
    expect(b.replays).toBe(a.replays);
  });

  it('returns null when the original spec does not fail — a failure is never fabricated', () => {
    const spec = plantedSpec();
    expect(minimizeFailure(spec, () => null)).toBeNull();
  });

  it('folds a minimized spec into a VALID QaScenarioV1 with the checked-in repro command', () => {
    const spec = plantedSpec();
    const min = minimizeFailure(spec, reachedWave3)!;
    const scenario = specToScenario(min.spec, { id: 'test-minimized-wave3', title: 'planted wave-3 failure, minimized' });
    expect(validateQaScenario(scenario)).toEqual([]);
    expect(scenario.action, 'the last minimized action rides the envelope; the rest folded into state').toBeDefined();
    expect(scenarioRepro(scenario.id)).toBe('npm run docbot:scenario -- test-minimized-wave3');
  });
});
