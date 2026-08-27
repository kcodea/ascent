/**
 * DOC BOT 2.0 WP C — EXACT REPORT REPLAY from the rolling action window (blueprint §8.2).
 *
 * A bug capsule that carries `recentActions` (the always-on ring buffer's last-N accepted actions, each with
 * its observational rails: rng cursor before, state hash before/after) can be verified PER ACTION instead of
 * only whole-history: the prefix of the capsule's full action log is rebuilt through the real reducer, then
 * every windowed action is replayed with its recorded rails checked as it lands — the FIRST divergent action
 * is reported precisely (which action, which rail, recorded vs observed). This upgrades the old
 * reconstruct-from-seed drift check ("the histories differ somewhere") into a pinpoint.
 *
 * Shared by `bugs:repro` (tools) and the dev report panel (ui), so both read the SAME verdict from the same
 * code. The replay is VERBATIM — the same plain accepted-action replay `bugs:repro` already performs (no
 * hermetic wave pin): the recorded rails came from the LIVE run, so the reproduction must walk the same
 * reducer paths (including its own opponent-serving boundary) to be comparable. A divergence can therefore
 * mean the game changed OR the environment did (e.g. a served board this checkout's pool doesn't have) —
 * the verdict says WHERE it diverged; classifying WHY stays with triage, never guessed here. Capsules
 * without the field are simply `applicable: false` — every pre-WP-C report keeps today's path untouched.
 */
import type { SetId } from '@game/content';
import { CONFIG } from './config';
import { createRun, type RunState } from './state';
import { reduce } from './reducer';
import { hashRunState, stableStringify, type RecordedActionWindow } from './qaScenario';
import type { BugIncidentCapsule } from './bugReport';

export interface WindowReplayDivergence {
  /** Index into the capsule's FULL action log (absolute), and into the window (relative). */
  actionIndex: number;
  windowIndex: number;
  actionType: string;
  rail: 'rng-cursor-before' | 'state-hash-before' | 'state-hash-after' | 'action-rejected';
  expected: string;
  observed: string;
}

export interface WindowReplayResult {
  /** False when the capsule carries no usable window (menu report, pre-WP-C capsule, or a window that is
   *  not a tail of the action log) — the caller falls back to the whole-history path. */
  applicable: boolean;
  /** Applicable AND the prefix rebuilt AND every recorded rail matched. */
  ok: boolean;
  divergence?: WindowReplayDivergence;
  /** Printable evidence: what was rebuilt, what was verified, where it diverged. */
  lines: string[];
}

const notApplicable = (line: string): WindowReplayResult => ({ applicable: false, ok: false, lines: [line] });

export function exactWindowReplay(capsule: BugIncidentCapsule): WindowReplayResult {
  const window: RecordedActionWindow[] | undefined = capsule.recentActions;
  if (capsule.phase === 'menu' || capsule.serializedRun === null) {
    return notApplicable('menu report — no run evidence, exact window replay not applicable');
  }
  if (!window?.length) {
    return notApplicable('capsule carries no rolling action window (pre-WP-C client) — whole-history path applies');
  }
  const total = capsule.actions.length;
  const start = total - window.length;
  if (start < 0) return notApplicable(`window (${window.length}) is longer than the action log (${total}) — capsule inconsistent, falling back`);
  // The window must BE the tail of the accepted-action log (both are recorded at the same commit chokepoint).
  for (let i = 0; i < window.length; i++) {
    if (stableStringify(window[i]!.action) !== stableStringify(capsule.actions[start + i])) {
      return notApplicable(`window entry ${i} does not match action log entry ${start + i} — capsule inconsistent, falling back`);
    }
  }

  const lines: string[] = [];
  let s = createRun(capsule.seed, capsule.heroId, capsule.mode === 'menu' ? undefined : capsule.mode, CONFIG.defaultLine, capsule.setId as SetId);

  // Rebuild the PREFIX (everything before the window) — plain accepted-action replay, like bugs:repro's path.
  for (let i = 0; i < start; i++) {
    let next: RunState;
    try {
      next = reduce(s, capsule.actions[i]!);
    } catch (e) {
      return { applicable: true, ok: false, lines: [...lines, `prefix replay threw at action #${i} (${capsule.actions[i]!.type}): ${(e as Error).message}`] };
    }
    if (next === s) {
      return { applicable: true, ok: false, lines: [...lines, `prefix replay diverged at action #${i} (${capsule.actions[i]!.type}): recorded as accepted, reducer rejected it`] };
    }
    s = next;
  }
  lines.push(`prefix rebuilt: ${start} actions replayed from seed ${capsule.seed}`);

  // Verify the WINDOW, rail by rail. First mismatch is THE divergence; verification stops there (later
  // mismatches would be downstream noise of the first).
  let divergence: WindowReplayDivergence | undefined;
  for (let i = 0; i < window.length && !divergence; i++) {
    const w = window[i]!;
    const abs = start + i;
    const flag = (rail: WindowReplayDivergence['rail'], expected: string, observed: string): void => {
      divergence = { actionIndex: abs, windowIndex: i, actionType: w.action.type, rail, expected, observed };
    };
    if (w.rngCursorBefore !== undefined && s.rngCursor !== w.rngCursorBefore) {
      flag('rng-cursor-before', String(w.rngCursorBefore), String(s.rngCursor));
      break;
    }
    if (w.stateHashBefore !== undefined) {
      const h = hashRunState(s);
      if (h !== w.stateHashBefore) { flag('state-hash-before', w.stateHashBefore, h); break; }
    }
    let next: RunState;
    try {
      next = reduce(s, w.action);
    } catch (e) {
      flag('action-rejected', 'accepted', `threw: ${(e as Error).message}`);
      break;
    }
    if (next === s) { flag('action-rejected', 'accepted', 'rejected (reducer returned the same state)'); break; }
    s = next;
    if (w.stateHashAfter !== undefined) {
      const h = hashRunState(s);
      if (h !== w.stateHashAfter) flag('state-hash-after', w.stateHashAfter, h);
    }
  }

  if (divergence) {
    lines.push(`EXACT REPLAY DIVERGED at action #${divergence.actionIndex} (${divergence.actionType}), window entry ${divergence.windowIndex}, rail ${divergence.rail}: recorded ${divergence.expected}, observed ${divergence.observed}`);
    return { applicable: true, ok: false, divergence, lines };
  }
  lines.push(`window verified: ${window.length} actions replayed with every recorded rail matching (rng cursor + state hashes)`);
  return { applicable: true, ok: true, lines };
}
