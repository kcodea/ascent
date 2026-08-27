/**
 * DOC BOT 2.0 WP C — EXACT WINDOW REPLAY: the per-action pinpoint + its sabotage proofs (§4.5).
 *
 * A fabricated capsule (driven through the REAL reducer, rails recorded exactly the way the ui ring buffer
 * records them — cursor read + hashRunState, nothing else) must replay with every rail matching; a DOCTORED
 * rail (wrong rngCursorBefore / wrong stateHashAfter) must make the replay report divergence at exactly the
 * doctored action. The QaScenarioV1 action-trail path gets the same treatment through `runQaScenario`.
 */
import { describe, expect, it } from 'vitest';
import { makeRng } from '@game/core';
import { CONFIG } from './config';
import { createRun, deserialize, serialize, type Action, type RunState } from './state';
import { reduce, reduceWithPresentation } from './reducer';
import { HEROES } from './heroes';
import {
  hashRunState,
  runQaScenario,
  validateQaScenario,
  type QaScenarioV1,
  type RecordedActionWindow,
} from './qaScenario';
import { exactWindowReplay } from './windowReplay';
import { nextFuzzAction } from './docbot/trajectory';
import type { BugIncidentCapsule } from './bugReport';

const HERO = HEROES[0]!.id;
const SEED = 20260827;

/** Drive a run VERBATIM (no wave pin — `exactWindowReplay` replays verbatim too) and record the ring rails
 *  for every ACCEPTED action, exactly as the ui ring buffer does. */
function driveCapsule(): { capsule: BugIncidentCapsule; windowSize: number } {
  let s = createRun(SEED, HERO, 'ascent', CONFIG.defaultLine);
  const rng = makeRng(1234);
  const accepted: Action[] = [];
  const window: RecordedActionWindow[] = [];
  for (let i = 0; i < 30 && s.phase !== 'gameover'; i++) {
    const a = nextFuzzAction(s, rng);
    const rngCursorBefore = s.rngCursor;
    const stateHashBefore = hashRunState(s);
    const next = reduce(s, a);
    if (next === s) continue; // the ring records ACCEPTED actions only, like replayActions
    accepted.push(a);
    window.push({ action: a, rngCursorBefore, stateHashBefore, stateHashAfter: hashRunState(next) });
    s = next;
  }
  const windowSize = Math.min(5, window.length);
  const capsule: BugIncidentCapsule = {
    runId: `${SEED}:${HERO}`,
    seed: SEED,
    heroId: HERO,
    mode: 'ascent',
    setId: s.setId ?? 'set1',
    wave: s.wave,
    phase: s.phase,
    shopTier: s.tier,
    timerSecondsRemaining: null,
    serializedRun: serialize(s),
    actions: accepted,
    currentWaveFrames: [],
    previousWaveFrames: [],
    combat: null,
    ui: {
      selectedCardUid: null, selectedCardId: null, pendingTargetCardId: null,
      modalKind: null, draggingCardUid: null, viewport: { width: 0, height: 0, devicePixelRatio: 1 },
    },
    contextTruncated: [],
    recentActions: window.slice(-windowSize),
  };
  return { capsule, windowSize };
}

describe('WP C exact window replay', () => {
  it('a faithful capsule window replays with every rail matching', () => {
    const { capsule, windowSize } = driveCapsule();
    expect(windowSize).toBeGreaterThan(2);
    const r = exactWindowReplay(capsule);
    expect(r.applicable).toBe(true);
    expect(r.divergence).toBeUndefined();
    expect(r.ok, r.lines.join(' · ')).toBe(true);
  });

  it('a capsule WITHOUT the window is honestly not applicable (pre-WP-C path untouched)', () => {
    const { capsule } = driveCapsule();
    const stripped = { ...capsule, recentActions: undefined };
    const r = exactWindowReplay(stripped);
    expect(r.applicable).toBe(false);
  });

  it('SABOTAGE: a doctored rngCursorBefore pinpoints divergence at exactly that action', () => {
    const { capsule, windowSize } = driveCapsule();
    const idx = Math.min(2, windowSize - 1);
    const doctored: BugIncidentCapsule = {
      ...capsule,
      recentActions: capsule.recentActions!.map((w, i) => (i === idx ? { ...w, rngCursorBefore: (w.rngCursorBefore ?? 0) + 1 } : w)),
    };
    const r = exactWindowReplay(doctored);
    expect(r.applicable).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.divergence?.windowIndex).toBe(idx);
    expect(r.divergence?.actionIndex).toBe(capsule.actions.length - windowSize + idx);
    expect(r.divergence?.rail).toBe('rng-cursor-before');
  });

  it('SABOTAGE: a doctored stateHashAfter pinpoints divergence at exactly that action', () => {
    const { capsule, windowSize } = driveCapsule();
    const idx = windowSize - 1;
    const doctored: BugIncidentCapsule = {
      ...capsule,
      recentActions: capsule.recentActions!.map((w, i) => (i === idx ? { ...w, stateHashAfter: 'deadbeef' } : w)),
    };
    const r = exactWindowReplay(doctored);
    expect(r.ok).toBe(false);
    expect(r.divergence?.windowIndex).toBe(idx);
    expect(r.divergence?.rail).toBe('state-hash-after');
  });
});

// ── The QaScenarioV1 action-trail path ─────────────────────────────────────────────────────────────────────

/** Record a trail hermetically (pin-then-record per action — the runner's documented recorder contract). */
function buildTrailScenario(): QaScenarioV1 {
  const seed = 777001;
  const s0 = createRun(seed);
  const checkpoint = serialize(s0);
  let s: RunState = deserialize(checkpoint);
  const rng = makeRng(55);
  const trail: RecordedActionWindow[] = [];
  for (let i = 0; i < 20 && trail.length < 6 && s.phase !== 'gameover'; i++) {
    if (!(s.wave in (s.servedBoards ?? {}))) s.servedBoards = { ...(s.servedBoards ?? {}), [s.wave]: null };
    const a = nextFuzzAction(s, rng);
    const rngCursorBefore = s.rngCursor;
    const stateHashBefore = hashRunState(s);
    const { state: next } = reduceWithPresentation(s, a, true);
    if (next === s) continue;
    trail.push({ action: a, rngCursorBefore, stateHashBefore, stateHashAfter: hashRunState(next) });
    s = next;
  }
  return {
    schemaVersion: 1,
    id: 'wpc-trail-test',
    title: 'WP C action trail — exact shop reproduction through the runner',
    source: 'generated',
    seed,
    setId: s0.setId ?? 'set1',
    mode: 'recruit',
    state: checkpoint,
    actions: trail,
    expectations: [{ kind: 'invariant', id: 'embers-non-negative' }],
  };
}

describe('WP C QaScenarioV1 action trail', () => {
  it('validates, replays exactly, and reports no divergence', () => {
    const scenario = buildTrailScenario();
    expect(scenario.actions!.length).toBeGreaterThan(2);
    expect(validateQaScenario(scenario)).toEqual([]);
    const r = runQaScenario(scenario);
    expect(r.firstDivergence, r.summary).toBeUndefined();
    expect(r.ok, r.summary).toBe(true);
  });

  it('SABOTAGE: a doctored trail hash fails the run and names the exact action', () => {
    const scenario = buildTrailScenario();
    const idx = 1;
    scenario.actions = scenario.actions!.map((w, i) => (i === idx ? { ...w, stateHashAfter: '00000000' } : w));
    const r = runQaScenario(scenario);
    expect(r.ok).toBe(false);
    expect(r.firstDivergence?.actionIndex).toBe(idx);
    expect(r.firstDivergence?.rail).toBe('state-hash-after');
  });

  it('the validator refuses action+actions together, and a combat-mode trail', () => {
    const scenario = buildTrailScenario();
    const both = { ...scenario, action: { type: 'roll' } as Action };
    expect(validateQaScenario(both).some((e) => e.includes('mutually exclusive'))).toBe(true);
    const combat = { ...scenario, mode: 'combat' as const };
    expect(validateQaScenario(combat).some((e) => e.includes('faceOmen hand-off'))).toBe(true);
  });
});
