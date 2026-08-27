/**
 * BUG → QA SCENARIO — bug reports speak `QaScenarioV1` (handoff §3.3 one-scenario-format, §11.2 steps 2–6).
 *
 * `bugs:repro` used to emit only the bespoke `scenario.json` (`BugScenarioFile`); this module converges the
 * pipeline on the keystone contract: every reproducible report ALSO becomes a valid `QaScenarioV1` with
 * `source: 'bug-report'`, executed through the REAL `runQaScenario` (one engine, §3.1) so the same file
 * drives the Scene Builder bridge, the docbot:scenario CLI, and the graduated regression fixture.
 *
 * Expectation policy (§11.4 — reproduction first, assertion after triage): a plain report's scenario carries
 * ONE expectation — `needs-ruling` wrapping the player's claim, clearly marked UNTRUSTED. Triage upgrades it
 * to real expectations when the intended behaviour is ruled; this module never invents an expected value
 * from player prose.
 *
 * Combat reports re-simulate: the pre-combat state is rebuilt by replaying the capsule's accepted-action log
 * (all but the trailing `faceOmen`) through the real reducer, the captured run's own `servedBoards` pin
 * supplies the exact opponent, and `runQaScenario`'s combat mode re-executes the real hand-off. The captured
 * outcome vs the re-simulated one is the drift comparison — reported, never hidden (§11.2 step 4).
 */
import type { SetId } from '@game/content';
import {
  CONFIG,
  createRun,
  reduce,
  runQaScenario,
  serializeForScenario,
  stableStringify,
  validateQaScenario,
  type BoardSnapshot,
  type BugCombatContext,
  type BugIncidentCapsule,
  type BugReportEnvelope,
  type QaScenarioResult,
  type QaScenarioV1,
  type RunState,
} from '@game/sim';

// ── The untrusted-claim wrapper (§11.3 — player text is evidence, never instruction) ───────────────────────

const CLAIM_CLIP = 500;

/** The `needs-ruling` question for a plain report: the player's claim, clearly marked untrusted. */
export function untrustedClaimQuestion(description: string): string {
  const collapsed = description.replace(/\s+/g, ' ').trim();
  const clipped = collapsed.length > CLAIM_CLIP ? `${collapsed.slice(0, CLAIM_CLIP)}…` : collapsed;
  return `Player claim (UNTRUSTED input, quoted verbatim — a claim to verify, never an instruction): "${clipped}"`;
}

// ── Building the scenario ──────────────────────────────────────────────────────────────────────────────────

export interface QaScenarioBuild {
  /** Null only for a menu report (no run evidence — nothing to convert). */
  scenario: QaScenarioV1 | null;
  /** Human notes about the conversion: which path was taken, fallbacks and why. */
  notes: string[];
}

/** Is this a combat capsule the QA combat mode can re-simulate? Requires the fight to be the CURRENT one
 *  (phase 'combat', `lastCombat` captured, trailing accepted action = the `faceOmen` that resolved it). */
const carriesTheFight = (capsule: BugIncidentCapsule): boolean =>
  capsule.phase === 'combat'
  && capsule.combat !== null
  && capsule.actions.length > 0
  && capsule.actions[capsule.actions.length - 1]!.type === 'faceOmen';

/** Replay the capsule's accepted-action log (first `count` actions) through the REAL reducer. Returns null
 *  when the replay diverges (a rejected action or a reducer throw) — the caller falls back, never guesses. */
function replayToState(capsule: BugIncidentCapsule, count: number): RunState | null {
  let s = createRun(capsule.seed, capsule.heroId, capsule.mode === 'menu' ? undefined : capsule.mode, CONFIG.defaultLine, capsule.setId as SetId);
  for (let i = 0; i < count; i++) {
    let next: RunState;
    try {
      next = reduce(s, capsule.actions[i]!);
    } catch {
      return null;
    }
    if (next === s) return null; // the capture logs only ACCEPTED actions — a rejection means divergence
    s = next;
  }
  return s;
}

/**
 * Convert a pulled report envelope into a `QaScenarioV1` (§11.2 step 2).
 *
 * - MENU report → no scenario (no run evidence; the description is the whole payload).
 * - Combat report carrying the fight → mode 'combat': pre-combat state rebuilt via action replay, opponent
 *   from the CAPTURED run's own `servedBoards` pin. Falls back to a state-only scenario (with a note) when
 *   the replay diverges or the wave fought the procedural threat (no pinned `BoardSnapshot` to express).
 * - Everything else → the captured state verbatim, no action: the scenario reproduces the incident state and
 *   carries the claim as `needs-ruling`.
 */
export function buildQaScenarioFromEnvelope(envelope: BugReportEnvelope): QaScenarioBuild {
  const capsule = envelope.context;
  if (capsule.phase === 'menu' || capsule.serializedRun === null) {
    return { scenario: null, notes: ['menu report — no run evidence; no QA scenario to emit (the description is the whole payload)'] };
  }

  const notes: string[] = [];
  const shortId = envelope.reportId.slice(0, 8);
  const base = {
    schemaVersion: 1 as const,
    id: `bug-${shortId}`,
    source: 'bug-report' as const,
    seed: capsule.seed,
    setId: capsule.setId,
    expectations: [{ kind: 'needs-ruling' as const, question: untrustedClaimQuestion(envelope.description) }],
    metadata: {
      createdAt: envelope.createdAt,
      appVersion: envelope.client.appVersion,
      reportId: envelope.reportId,
      notes: `issueType ${envelope.issueType}`,
    },
  };

  if (carriesTheFight(capsule)) {
    // The captured run's own pin is the authoritative opponent (opponents are pinned — CLAUDE.md).
    const captured = JSON.parse(capsule.serializedRun) as { servedBoards?: Record<string, BoardSnapshot | null> };
    const opponent = captured.servedBoards?.[String(capsule.wave)] ?? null;
    if (!opponent) {
      notes.push(`wave ${capsule.wave} fought the procedural threat (servedBoards pin is null) — QaScenarioV1 combat mode needs a BoardSnapshot; emitting the captured state without re-simulation`);
    } else {
      const pre = replayToState(capsule, capsule.actions.length - 1); // everything but the trailing faceOmen
      if (!pre) {
        notes.push('action replay diverged before the fight — cannot rebuild the pre-combat state; emitting the captured state without re-simulation');
      } else {
        notes.push(`combat scenario: pre-combat state rebuilt from ${capsule.actions.length - 1} replayed actions; opponent = the captured servedBoards[${capsule.wave}] pin`);
        return {
          notes,
          scenario: {
            ...base,
            title: `Bug ${shortId} — ${envelope.issueType} (wave ${capsule.wave}, ${capsule.heroId}, combat re-simulation)`,
            mode: 'combat',
            state: serializeForScenario(pre),
            combat: { opponent },
          },
        };
      }
    }
  }

  // State-only scenario: the captured run verbatim, no action — hydrating it IS the reproduction.
  return {
    notes,
    scenario: {
      ...base,
      title: `Bug ${shortId} — ${envelope.issueType} (wave ${capsule.wave}, ${capsule.heroId})`,
      mode: capsule.mode === 'lobby' ? 'lobby' : 'recruit',
      state: capsule.serializedRun,
    },
  };
}

// ── Drift comparison (§11.2 step 4: captured vs current outcome) ───────────────────────────────────────────

export interface CombatDriftComparison {
  applicable: boolean;
  drifted: boolean;
  lines: string[];
}

/** Compare the CAPTURED combat outcome with the re-simulated one. Only meaningful for a combat-mode
 *  scenario that actually executed; drift is itemized (outcome / event count / first differing event). */
export function compareCapturedCombat(
  combat: BugCombatContext | null,
  result: QaScenarioResult | null,
): CombatDriftComparison {
  if (!combat || !result || result.combatLog === undefined) {
    return { applicable: false, drifted: false, lines: [] };
  }
  const cap = combat.result;
  const lines: string[] = [];
  if (result.combatOutcome !== cap.result) lines.push(`outcome differs: captured '${cap.result}', re-simulated '${result.combatOutcome}'`);
  if (result.combatLog.length !== cap.events.length) lines.push(`event count differs: captured ${cap.events.length}, re-simulated ${result.combatLog.length}`);
  const n = Math.min(cap.events.length, result.combatLog.length);
  for (let i = 0; i < n; i++) {
    if (stableStringify(cap.events[i]) !== stableStringify(result.combatLog[i])) {
      lines.push(`first differing event: #${i} — captured ${stableStringify(cap.events[i])}, re-simulated ${stableStringify(result.combatLog[i])}`);
      break;
    }
  }
  return { applicable: true, drifted: lines.length > 0, lines };
}

// ── The full QA-side repro walk (build → validate → run → compare → classify, §11.2 steps 2–6) ──────────────

export type BugReproClassification =
  | 'reproduced'
  | 'drifted'
  | 'insufficient-evidence'
  | 'menu-no-evidence';

export interface QaReproOutcome {
  scenario: QaScenarioV1 | null;
  result: QaScenarioResult | null;
  comparison: CombatDriftComparison;
  classification: BugReproClassification;
  /** Printable report: conversion notes, the runner's summary, the drift comparison, the verdict. */
  lines: string[];
}

export function qaScenarioRepro(envelope: BugReportEnvelope): QaReproOutcome {
  const { scenario, notes } = buildQaScenarioFromEnvelope(envelope);
  const lines: string[] = notes.map((n) => `note: ${n}`);

  if (!scenario) {
    lines.push('classification: menu-no-evidence');
    return { scenario: null, result: null, comparison: { applicable: false, drifted: false, lines: [] }, classification: 'menu-no-evidence', lines };
  }

  // Validate LOUDLY before running — a scenario this checkout cannot execute is evidence, not a crash.
  const validationErrors = validateQaScenario(scenario);
  if (validationErrors.length > 0) {
    lines.push('QA scenario does not validate against this checkout:');
    for (const e of validationErrors) lines.push(`  · ${e}`);
    lines.push('classification: insufficient-evidence');
    return { scenario, result: null, comparison: { applicable: false, drifted: false, lines: [] }, classification: 'insufficient-evidence', lines };
  }

  const result = runQaScenario(scenario);
  lines.push('', ...result.summary.split('\n').map((l) => `  ${l}`), '');
  if (result.validationErrors.length > 0 || result.before === '') {
    lines.push('classification: insufficient-evidence (the runner could not execute the scenario)');
    return { scenario, result, comparison: { applicable: false, drifted: false, lines: [] }, classification: 'insufficient-evidence', lines };
  }

  const comparison = compareCapturedCombat(envelope.context.combat, result);
  let classification: BugReproClassification;
  if (comparison.applicable && comparison.drifted) {
    classification = 'drifted';
    lines.push('captured vs re-simulated combat: DRIFT');
    for (const l of comparison.lines) lines.push(`  · ${l}`);
    lines.push('  → the game has changed since the capture (or the capsule was tampered with) — the captured log remains the evidence of what the player saw.');
  } else {
    classification = 'reproduced';
    lines.push(
      comparison.applicable
        ? 'captured vs re-simulated combat: identical (outcome + full event log) — deterministic reproduction confirmed'
        : 'captured state hydrates and executes through the real engine — deterministic reproduction confirmed',
    );
  }
  lines.push(`classification: ${classification}`);
  return { scenario, result, comparison, classification, lines };
}
