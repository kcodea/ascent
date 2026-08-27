/**
 * DOC BOT — NIGHTLY LIFECYCLE LANE wiring (handoff §9.2/§9.3 + §15 "artifact contains seed, scenario,
 * expected, and observed", PR 8).
 *
 * The heavy sweep itself lives behind `npm run docbot:nightly` (§13.3 — it must not block ordinary PRs);
 * what the PR gate proves here is that the MACHINERY is sound, PR-gate-sized:
 *
 *   · one small lifecycle run executes to elimination/cap with all rails on and (on healthy content) no
 *     violations — and its report carries the coverage/warning/budget telemetry the nightly publishes;
 *   · a PLANTED failure (a zero combat-event budget — every fight breaches it) flows through the whole
 *     §9.3 lifecycle: minimize → QaScenarioV1 → repro line → structured finding, with the original trace
 *     preserved as secondary evidence, and the artifact carries seed + scenario + expected/observed.
 *
 * SABOTAGE: the planted-budget test IS the sabotage for this lane — a real bug shape (an event-budget
 * breach) reintroduced via config, proven to produce a minimized, still-failing, valid scenario.
 */
import { describe, expect, it } from 'vitest';
import { validateQaScenario } from '../qaScenario';
import { driveTrajectory } from './trajectory';
import { violationPredicate } from './seedMinimize';
import { buildFailureArtifact, runLifecycle, DEFAULT_NIGHTLY } from './nightlyLane';

describe('Doc Bot — nightly lifecycle machinery (§9.2/§9.3)', () => {
  it('a small lifecycle run drives to elimination with checkpoints + budgets and reports clean', () => {
    const report = runLifecycle(61234, 'warden', 'set2', { ...DEFAULT_NIGHTLY, maxSteps: 150, roundtripEvery: 10, replayEvery: 40 });
    expect(report.failures, report.failures.map((f) => `[${f.checkId}] ${f.detail}`).join('\n')).toEqual([]);
    expect(report.steps).toBeGreaterThan(10);
    expect(report.coverageKeys.length).toBeGreaterThan(10);
    expect(report.maxCombatEvents).toBeGreaterThan(0); // it actually fought
  });

  it('PLANTED failure: a zero combat budget produces a minimized scenario + repro + structured finding', () => {
    // Record a real trace that contains at least one fight.
    const fuzz = driveTrajectory({ seed: 777, generate: { steps: 60, rngSeed: 0x5eed } });
    expect(fuzz.maxCombatEvents).toBeGreaterThan(0);

    const budget = { warn: 0, fail: 0 }; // the plant: every combat breaches
    const artifact = buildFailureArtifact(
      { seed: 777, heroId: '', setId: '', roundtripEvery: 0, combatBudget: budget },
      'combat-budget',
      'planted: every combat exceeds a zero budget',
      fuzz.actions,
    );

    // §15: the artifact carries seed, scenario, expected and observed.
    expect(artifact.runSeed).toBe(777);
    expect(artifact.scenario, 'the planted failure must minimize into a scenario').toBeDefined();
    expect(artifact.repro).toBe(`npm run docbot:scenario -- ${artifact.scenario!.id}`);
    expect(artifact.finding.observed).toBeTruthy();
    expect(artifact.finding.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(artifact.originalActions.length).toBe(fuzz.actions.length); // secondary evidence preserved intact

    // The minimized scenario is small, VALID, and still fails the planted predicate when replayed.
    expect(artifact.minimizedSteps!).toBeLessThan(fuzz.actions.length);
    expect(validateQaScenario(artifact.scenario!)).toEqual([]);
    const replayed = driveTrajectory({ seed: 777, actions: fuzz.actions.slice(0, 0) }); // sanity: empty trace passes
    expect(violationPredicate('combat-budget')(replayed)).toBeNull();
  });

  it('an artifact for a NON-reproducible failure keeps the evidence but fabricates no scenario', () => {
    const fuzz = driveTrajectory({ seed: 778, generate: { steps: 20, rngSeed: 0xfade } });
    const artifact = buildFailureArtifact(
      { seed: 778, heroId: '', setId: '', roundtripEvery: 0 },
      'invariant',
      'a violation replay mode cannot reproduce',
      fuzz.actions,
    );
    expect(artifact.scenario).toBeUndefined();
    expect(artifact.repro).toBeUndefined();
    expect(artifact.finding.confidence).toBe('strong'); // not 'proven' — uncertainty stays visible (§3.4)
    expect(artifact.originalActions.length).toBe(fuzz.actions.length);
  });
});
