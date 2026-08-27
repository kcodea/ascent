/**
 * DOC BOT — SEED / TRAJECTORY MINIMIZATION (handoff §9.3, PR 8).
 *
 * When fuzz or lifecycle testing finds a failure, a 250-step random trace is true but useless evidence.
 * This module shrinks it into the smallest action sequence that still fails, then folds it into a
 * `QaScenarioV1` with the exact reproduction command — while the ORIGINAL seed + trace are preserved by
 * the caller as secondary evidence (the nightly artifact carries both).
 *
 * Algorithm: greedy drop-one to a fixpoint. Each pass tries removing every action index in order,
 * re-driving the REMAINING actions in replay mode through the same `driveTrajectory` checks that flagged
 * the failure; a removal that preserves the failure sticks. Passes repeat until no single removal
 * preserves it — which IS 1-minimality: at the fixpoint, dropping ANY single remaining action makes the
 * failure vanish (`seedMinimize.test.ts` asserts this directly, and sabotage-proves the predicate is
 * actually consulted). Fully deterministic: replay mode generates nothing, so the same spec + predicate
 * minimize to the same byte-identical result every time.
 *
 * The predicate sees the whole `DriveOutcome` (final state, violations, budgets), never a message string —
 * so a minimizer target is a structural condition, not prose matching.
 */
import { deserialize, serialize, type Action } from '../state';
import { runQaScenario, type QaExpectation, type QaScenarioV1 } from '../qaScenario';
import { driveTrajectory, pinCurrentWave, type CombatBudget, type DriveOptions, type DriveOutcome } from './trajectory';

export interface TrajectorySpec {
  seed: number;
  heroId?: string;
  setId?: string;
  actions: readonly Action[];
  /** Carried into every replay so checkpoint-sourced failures ('roundtrip') reproduce identically. */
  roundtripEvery?: number;
  /** Carried likewise so 'combat-budget' failures reproduce (and so tests can PLANT one via a 0 budget). */
  combatBudget?: CombatBudget;
}

/** Returns a failure DETAIL when the outcome still fails, or null when it passes. */
export type FailurePredicate = (outcome: DriveOutcome) => string | null;

/** The standard predicate family: "a violation of this check family is present" — the nightly's targets. */
export const violationPredicate = (checkId: string): FailurePredicate => (o) =>
  o.violations.find((v) => v.checkId === checkId)?.detail ?? null;

const replay = (spec: TrajectorySpec, actions: readonly Action[]): DriveOutcome =>
  driveTrajectory({
    seed: spec.seed,
    heroId: spec.heroId,
    setId: spec.setId,
    actions,
    roundtripEvery: spec.roundtripEvery,
    combatBudget: spec.combatBudget,
  } satisfies DriveOptions);

export interface MinimizeResult {
  /** The minimized spec — same seed/hero/set, the shortest surviving action list. */
  spec: TrajectorySpec;
  /** The failure detail the minimized trajectory still produces. */
  detail: string;
  /** Total replays spent (the budget the caller can report). */
  replays: number;
  /** Fixpoint proof: no single further removal preserved the failure. */
  oneMinimal: boolean;
}

/**
 * Greedy drop-one minimization to a fixpoint. Returns null when the ORIGINAL spec does not fail the
 * predicate (nothing to minimize — the caller's failure was not reproducible in replay mode, which is
 * itself a finding: report it, never fabricate a scenario).
 */
export function minimizeFailure(spec: TrajectorySpec, failsWith: FailurePredicate, maxReplays = 5000): MinimizeResult | null {
  let replays = 1;
  let detail = failsWith(replay(spec, spec.actions));
  if (detail === null) return null;

  let actions = [...spec.actions];
  let progress = true;
  while (progress && replays < maxReplays) {
    progress = false;
    for (let i = 0; i < actions.length && replays < maxReplays; i++) {
      const candidate = [...actions.slice(0, i), ...actions.slice(i + 1)];
      replays++;
      const d = failsWith(replay(spec, candidate));
      if (d !== null) {
        actions = candidate;
        detail = d;
        progress = true;
        i--; // the next action shifted into this slot — retry the same index
      }
    }
  }
  return {
    spec: { ...spec, actions },
    detail: detail!,
    replays,
    oneMinimal: !progress, // the last full pass removed nothing — 1-minimal (false only on budget exhaustion)
  };
}

export interface ScenarioFromSpecOptions {
  id: string;
  title: string;
  source?: QaScenarioV1['source'];
  expectations?: QaExpectation[];
  notes?: string;
}

/**
 * Fold a (minimized) trajectory into ONE QaScenarioV1: every action but the last is replayed into the
 * embedded state; the last action is the scenario's action. The reproduction line is the checked-in CLI.
 * The runner's hermetic wave pin is applied before serializing, so the fixture replays the same fight.
 */
export function specToScenario(spec: TrajectorySpec, opts: ScenarioFromSpecOptions): QaScenarioV1 {
  const prefix = spec.actions.slice(0, Math.max(0, spec.actions.length - 1));
  const last = spec.actions[spec.actions.length - 1];
  const outcome = replay(spec, prefix);
  const state = deserialize(serialize(outcome.final)); // the same door the runner hydrates through
  pinCurrentWave(state);
  const parsed = JSON.parse(serialize(state)) as { seed: number; setId?: string };
  return {
    schemaVersion: 1,
    id: opts.id,
    title: opts.title,
    source: opts.source ?? 'generated',
    seed: parsed.seed,
    setId: parsed.setId ?? 'set1',
    mode: 'recruit',
    state: serialize(state),
    ...(last ? { action: last } : {}),
    ...(opts.expectations ? { expectations: opts.expectations } : {}),
    metadata: { ...(opts.notes ? { notes: opts.notes } : {}) },
  };
}

/** The exact local reproduction command for an emitted scenario file (§9.3 step 4). */
export const scenarioRepro = (id: string): string => `npm run docbot:scenario -- ${id}`;

/** Convenience: emit + immediately verify a minimized scenario still VALIDATES and runs (its expectations,
 *  if any, are the caller's business — a minimized failure scenario usually ships with none and lets the
 *  finding carry expected/observed instead). */
export function scenarioRoundtripOk(scenario: QaScenarioV1): boolean {
  return runQaScenario(scenario).validationErrors.length === 0;
}
