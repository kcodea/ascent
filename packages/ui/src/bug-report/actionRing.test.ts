/**
 * DOC BOT 2.0 WP C — the always-on rolling action window (ring buffer) tests.
 *
 * The ring must: record ONLY accepted actions with rails that recompute exactly (same hashRunState both
 * sides); mutate nothing it observes; cap at ACTION_RING_SIZE; scope snapshots to one run; ride into the
 * capture path as a cloned, frozen, OPTIONAL capsule field; and be the trim ladder's next rung after the
 * previous wave's frames.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIG, createRun, hashRunState, reduce, serialize,
  type Action, type BugReportEnvelope, type RunState,
} from '@game/sim';
import { ACTION_RING_SIZE, recordActionEntry, resetActionRing, snapshotActionWindow } from './actionRing';
import { captureIncidentCapsule, type BugCaptureSource } from './bugReportCapture';
import { BUG_MAX_BODY_BYTES, trimEnvelope } from './bugReportUpload';

const drive = (seed: number, steps: number): { states: RunState[]; actions: Action[] } => {
  let s = createRun(seed);
  const states: RunState[] = [s];
  const actions: Action[] = [];
  const tryAct = (a: Action): void => {
    const next = reduce(s, a);
    recordActionEntry(s, a, next, null); // exactly the commit-path call
    if (next !== s) { actions.push(a); states.push(next); s = next; }
  };
  for (let i = 0; i < steps; i++) {
    if (s.questOffer) { tryAct({ type: 'buyQuest', index: 0 }); continue; }
    if (s.discover) { tryAct({ type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { tryAct({ type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { tryAct({ type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.embers >= CONFIG.minionCost && s.shop.length > 0) { tryAct({ type: 'buy', uid: s.shop[0]!.uid }); continue; }
    if (s.hand.length > 0 && s.board.length < CONFIG.boardMax) { tryAct({ type: 'play', uid: s.hand[0]!.uid }); continue; }
    tryAct({ type: 'roll' }); // eventually rejected when broke — exercising the rejected-action path
  }
  return { states, actions };
};

beforeEach(() => resetActionRing());

describe('actionRing', () => {
  it('records accepted actions only, with rails that recompute exactly', () => {
    const { states, actions } = drive(41, 12);
    const runId = `${states[0]!.seed}:${states[0]!.heroId}`;
    const window = snapshotActionWindow(runId);
    expect(window.length).toBe(actions.length);
    window.forEach((w, i) => {
      expect(w.action).toEqual(actions[i]);
      expect(w.rngCursorBefore).toBe(states[i]!.rngCursor);
      expect(w.stateHashBefore).toBe(hashRunState(states[i]!));
      expect(w.stateHashAfter).toBe(hashRunState(states[i + 1]!));
    });
  });

  it('recording is observational — the states it reads are byte-identical afterwards', () => {
    const s = createRun(42);
    const a: Action = { type: 'roll' };
    const next = reduce(s, a);
    const beforeBytes = serialize(s);
    const afterBytes = serialize(next);
    recordActionEntry(s, a, next, null);
    expect(serialize(s)).toBe(beforeBytes);
    expect(serialize(next)).toBe(afterBytes);
  });

  it(`caps at ${ACTION_RING_SIZE} entries and scopes snapshots per run`, () => {
    const { states: s1 } = drive(43, ACTION_RING_SIZE + 20);
    const runId1 = `${s1[0]!.seed}:${s1[0]!.heroId}`;
    expect(snapshotActionWindow(runId1).length).toBeLessThanOrEqual(ACTION_RING_SIZE);
    // A second run's entries push the first run's out of its snapshot (contiguous-tail scoping).
    const { states: s2 } = drive(44, 4);
    const runId2 = `${s2[0]!.seed}:${s2[0]!.heroId}`;
    expect(snapshotActionWindow(runId2).length).toBeGreaterThan(0);
    expect(snapshotActionWindow(runId1).length).toBe(0);
  });

  it('the capture path embeds a cloned, frozen window; ring churn never reaches the capsule', () => {
    const { states } = drive(45, 8);
    const run = states[states.length - 1]!;
    const source: BugCaptureSource = {
      run,
      replayActions: [],
      replayFrames: [],
      inspect: null,
      showLeaderboard: false, showRankings: false, showRecentGames: false, showCareer: false,
      showBook: false, showBalance: false, showPatchNotes: false,
      combatSpeed: 1,
    };
    const capsule = captureIncidentCapsule(source);
    expect(capsule.recentActions?.length).toBeGreaterThan(0);
    expect(Object.isFrozen(capsule.recentActions)).toBe(true);
    expect(Object.isFrozen(capsule.recentActions![0])).toBe(true);
    const recorded = capsule.recentActions!.length;
    drive(45, 3); // more ring churn after capture
    expect(capsule.recentActions!.length).toBe(recorded);
  });

  it('a menu-less fresh session (empty ring) captures a capsule WITHOUT the field — old shape preserved', () => {
    const run = createRun(46);
    const source: BugCaptureSource = {
      run, replayActions: [], replayFrames: [], inspect: null,
      showLeaderboard: false, showRankings: false, showRecentGames: false, showCareer: false,
      showBook: false, showBalance: false, showPatchNotes: false, combatSpeed: 1,
    };
    expect('recentActions' in captureIncidentCapsule(source)).toBe(false);
  });

  it('the trim ladder drops recentActions (recorded in contextTruncated) after previousWaveFrames', () => {
    const { states } = drive(47, 6);
    const run = states[states.length - 1]!;
    const source: BugCaptureSource = {
      run, replayActions: [], replayFrames: [], inspect: null,
      showLeaderboard: false, showRankings: false, showRecentGames: false, showCareer: false,
      showBook: false, showBalance: false, showPatchNotes: false, combatSpeed: 1,
    };
    const capsule = captureIncidentCapsule(source);
    expect(capsule.recentActions?.length).toBeGreaterThan(0);
    const envelope: BugReportEnvelope = {
      schemaVersion: 1,
      reportId: 'cccccccc-1111-2222-3333-444444444444',
      createdAt: '2026-08-27T00:00:00.000Z',
      description: 'trim ladder test',
      issueType: 'other',
      context: capsule,
      client: {
        appVersion: '0', buildSha: '0', contentRevision: 'set1+0', platform: 'web',
        userAgent: 'vitest', locale: 'en', accountUserId: null, playerName: null, sessionId: 's',
      },
    };
    // A budget sized between "everything minus the window" and "everything": the ladder must shed
    // previousWaveFrames (already empty here) then the window, and record both drops it actually made.
    const full = JSON.stringify(envelope).length;
    const withoutWindow = full - JSON.stringify(capsule.recentActions).length;
    const trimmed = trimEnvelope(envelope, withoutWindow + 8);
    expect(trimmed).not.toBeNull();
    expect(trimmed!.context.recentActions).toBeUndefined();
    expect(trimmed!.context.contextTruncated).toContain('recentActions');
    // …and an under-limit envelope is returned untouched, window intact.
    const untouched = trimEnvelope(envelope, BUG_MAX_BODY_BYTES);
    expect(untouched!.context.recentActions?.length).toBe(capsule.recentActions!.length);
  });
});
