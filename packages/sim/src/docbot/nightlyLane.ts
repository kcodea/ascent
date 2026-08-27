/**
 * DOC BOT — NIGHTLY FULL-LIFECYCLE LANE (handoff §9.2 + §13.3, PR 8).
 *
 * The long-horizon lane the PR gate must never pay for: complete deterministic runs to elimination (or the
 * step cap), across several seeds/heroes/sets, with every §9.2 rail active:
 *
 *   · save/restore checkpoints — serialize→deserialize round-trip + normalized diff, restored state ADOPTED
 *     (`driveTrajectory.roundtripEvery`), so the rest of the run also proves the restored copy continues;
 *   · periodic replay reconstruction — the recorded action trace is re-executed from `createRun` and the
 *     reconstructed normalized state must match the live one (the replay-integrity rail);
 *   · conservation/invariant checks + explosion budgets + combat event budgets, every step;
 *   · an 8-seat lobby sweep through the real `createLobby → runLobby` loop (bot seats), asserting the
 *     structural lobby laws (termination, complete placements, elimination monotonicity).
 *
 * On a failure this module does the §9.3 lifecycle: minimize (greedy drop-one through the SAME checks),
 * fold into a `QaScenarioV1`, print the exact repro line, keep the original seed/trace as secondary
 * evidence, and emit a structured `DocbotFinding` (§12) — all packaged as one artifact object the CLI
 * writes to disk. This lane is NOT wired into the PR gate (`ci.yml` untouched); `nightly.yml` runs it on a
 * schedule and uploads the artifacts.
 */
import { SETS } from '@game/content';
import { stableStringify } from '../qaScenario';
import type { QaScenarioV1 } from '../qaScenario';
import { normalizeRunState } from '../qaScenario';
import type { Action } from '../state';
import { HEROES } from '../heroes';
import { createLobby, runLobby, standings } from '../lobby/lobby';
import { botSeat } from '../lobby/seats';
import { makeFinding, type DocbotFinding } from './findings';
import { driveTrajectory, type CombatBudget, type DriveOutcome } from './trajectory';
import { minimizeFailure, specToScenario, scenarioRepro, violationPredicate, type TrajectorySpec } from './seedMinimize';

export interface NightlyConfig {
  /** How many lifecycle runs (seeds are derived deterministically from the base). */
  runs: number;
  seedBase: number;
  /** Step cap per run — the stalemate backstop, generous enough to reach elimination in ordinary play. */
  maxSteps: number;
  roundtripEvery: number;
  replayEvery: number;
  /** How many 8-seat bot lobbies to sweep. */
  lobbies: number;
}

export const DEFAULT_NIGHTLY: NightlyConfig = {
  runs: 6,
  seedBase: 60_000,
  maxSteps: 400,
  roundtripEvery: 20,
  replayEvery: 80,
  lobbies: 4,
};

export interface NightlyFailure {
  runSeed: number;
  heroId: string;
  setId: string;
  checkId: string;
  detail: string;
  /** The minimized reusable scenario (§9.3) — absent when replay could not reproduce the failure. */
  scenario?: QaScenarioV1;
  repro?: string;
  minimizedSteps?: number;
  /** Secondary evidence: the ORIGINAL full trace, always preserved. */
  originalActions: Action[];
  finding: DocbotFinding;
}

export interface NightlyRunReport {
  seed: number;
  heroId: string;
  setId: string;
  steps: number;
  wave: number;
  endedBy: DriveOutcome['endedBy'];
  maxCombatEvents: number;
  warnings: string[];
  failures: NightlyFailure[];
  /** Semantic coverage keys this run reached (rolled up into the nightly total). */
  coverageKeys: string[];
}

export interface NightlyReport {
  config: NightlyConfig;
  runs: NightlyRunReport[];
  lobbyFailures: DocbotFinding[];
  /** Union of semantic coverage keys the whole nightly reached (§16's "nightly coverage keys" metric). */
  coverageKeys: string[];
  ok: boolean;
}

const heroRoster = (): string[] => HEROES.filter((h) => !h.wip).map((h) => h.id).sort();
const setRoster = (): string[] => Object.keys(SETS).filter((id) => SETS[id as keyof typeof SETS].own.length > 0).sort();

/** Build the failure package for one flagged check: minimize → scenario → repro → finding. */
export function buildFailureArtifact(
  base: { seed: number; heroId: string; setId: string; roundtripEvery: number; combatBudget?: CombatBudget },
  checkId: string,
  detail: string,
  originalActions: readonly Action[],
): NightlyFailure {
  // '' means "createRun's default" — normalized to undefined so a defaulted fuzz trace replays identically.
  const spec: TrajectorySpec = { seed: base.seed, heroId: base.heroId || undefined, setId: base.setId || undefined, actions: originalActions, roundtripEvery: base.roundtripEvery, combatBudget: base.combatBudget };
  const minimized = minimizeFailure(spec, violationPredicate(checkId));
  const scenarioId = `nightly-s${base.seed}-${checkId}`;
  const scenario = minimized
    ? specToScenario(minimized.spec, {
        id: scenarioId,
        title: `nightly ${checkId} failure — seed ${base.seed} (${base.heroId}, ${base.setId})`,
        source: 'generated',
        notes: `minimized from ${originalActions.length} to ${minimized.spec.actions.length} actions; ${minimized.detail}`,
      })
    : undefined;
  const finding = makeFinding({
    lane: 'nightly-lifecycle',
    severity: 'error',
    confidence: minimized ? 'proven' : 'strong',
    title: `nightly ${checkId} failure (seed ${base.seed})`,
    summary: minimized?.detail ?? detail,
    contentIds: [],
    ruleIds: [],
    expectationKind: checkId,
    expected: null,
    observed: { seed: base.seed, heroId: base.heroId, setId: base.setId, checkId, detail },
    ...(scenario ? { scenarioId, reproduction: scenarioRepro(scenarioId) } : {}),
  });
  return {
    runSeed: base.seed,
    heroId: base.heroId,
    setId: base.setId,
    checkId,
    detail,
    ...(scenario ? { scenario, repro: scenarioRepro(scenarioId), minimizedSteps: minimized!.spec.actions.length } : {}),
    originalActions: [...originalActions],
    finding,
  };
}

/** One lifecycle run: fuzz to elimination with all rails, then package every distinct failed check. */
export function runLifecycle(seed: number, heroId: string, setId: string, cfg: NightlyConfig): NightlyRunReport {
  const outcome = driveTrajectory({
    seed,
    heroId,
    setId,
    generate: { steps: cfg.maxSteps, rngSeed: 0x717e + seed },
    roundtripEvery: cfg.roundtripEvery,
    collectCoverage: true,
  });

  const failures: NightlyFailure[] = [];
  const seenChecks = new Set<string>();
  for (const v of outcome.violations) {
    if (seenChecks.has(v.checkId)) continue; // one artifact per check family per run — dedupe the flood
    seenChecks.add(v.checkId);
    failures.push(buildFailureArtifact({ seed, heroId, setId, roundtripEvery: cfg.roundtripEvery }, v.checkId, v.detail, outcome.actions));
  }

  // Replay reconstruction (§9.2): re-execute the recorded trace from scratch — WITH the same checkpoint
  // cadence, because the live trajectory adopted its restored states — and diff the normalized finals.
  if (cfg.replayEvery > 0 && outcome.actions.length > 0 && failures.length === 0) {
    const reconstructed = driveTrajectory({ seed, heroId, setId, actions: outcome.actions, roundtripEvery: cfg.roundtripEvery });
    if (normalizeRunState(reconstructed.final) !== normalizeRunState(outcome.final)) {
      const detail = `replay reconstruction diverged from the live run after ${outcome.actions.length} actions`;
      failures.push(buildFailureArtifact({ seed, heroId, setId, roundtripEvery: cfg.roundtripEvery }, 'replay-reconstruction', detail, outcome.actions));
    }
  }

  return {
    seed,
    heroId,
    setId,
    steps: outcome.steps,
    wave: outcome.final.wave,
    endedBy: outcome.endedBy,
    maxCombatEvents: outcome.maxCombatEvents,
    warnings: outcome.warnings,
    failures,
    coverageKeys: outcome.coverageKeys ?? [],
  };
}

/** The lobby structural sweep: full bot lobbies through the real loop, laws asserted, findings on breach. */
export function runLobbySweep(cfg: NightlyConfig): DocbotFinding[] {
  const findings: DocbotFinding[] = [];
  const heroes = heroRoster();
  for (let i = 0; i < cfg.lobbies; i++) {
    const lobbySeed = cfg.seedBase + 7 * i + 3;
    const seats = Array.from({ length: 8 }, (_, k) => botSeat(lobbySeed * 100 + k, heroes[(i + k) % heroes.length]!, `bot${k}`));
    const s = runLobby(createLobby(lobbySeed, seats));
    const order = standings(s);
    const problems: string[] = [];
    if (order.length !== 8) problems.push(`standings has ${order.length} seats`);
    const placements = order.map((x) => x.placement).filter((p): p is number => typeof p === 'number');
    if (placements.length !== 8) problems.push(`only ${placements.length}/8 seats carry a final placement`);
    if (!placements.includes(1)) problems.push('no seat placed 1st');
    const alive = order.filter((x) => x.alive).length;
    if (alive > 1 && s.round - 1 < s.rules.maxRounds) problems.push(`${alive} seats alive but the lobby stopped before maxRounds`);
    for (const p of problems) {
      findings.push(makeFinding({
        lane: 'nightly-lobby',
        severity: 'error',
        confidence: 'proven',
        title: `lobby law violated (seed ${lobbySeed})`,
        summary: p,
        contentIds: [],
        ruleIds: [],
        expectationKind: 'lobby-law',
        expected: null,
        observed: { lobbySeed, problem: p },
      }));
    }
  }
  return findings;
}

/** The whole nightly: lifecycle runs + lobby sweep, one report. Deterministic for a given config. */
export function runNightly(cfg: NightlyConfig = DEFAULT_NIGHTLY): NightlyReport {
  const heroes = heroRoster();
  const sets = setRoster();
  const runs: NightlyRunReport[] = [];
  const coverage = new Set<string>();
  for (let i = 0; i < cfg.runs; i++) {
    const seed = cfg.seedBase + i * 977;
    const report = runLifecycle(seed, heroes[i % heroes.length]!, sets[i % sets.length]!, cfg);
    for (const k of report.coverageKeys) coverage.add(k);
    runs.push(report);
  }
  const lobbyFailures = runLobbySweep(cfg);
  return {
    config: cfg,
    runs,
    lobbyFailures,
    coverageKeys: [...coverage].sort(),
    ok: runs.every((r) => r.failures.length === 0) && lobbyFailures.length === 0,
  };
}

/** Byte-stable serialization of the report (artifact body). */
export const nightlyReportJson = (r: NightlyReport): string => JSON.stringify(JSON.parse(stableStringify(r)), null, 2);
