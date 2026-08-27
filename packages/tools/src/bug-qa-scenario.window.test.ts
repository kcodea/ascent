/**
 * DOC BOT 2.0 WP C — bugs:repro × the rolling action window (§8.2 exact reproduction, tools side).
 *
 * The repro walk must: use the capsule's window when present (per-action verification lines in the report),
 * keep classifying 'reproduced' when every rail matches, classify 'drifted' — with the exact divergent
 * action named — when a rail is doctored, and leave pre-WP-C capsules (no window) on today's path.
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIG, createRun, hashRunState, reduce, serialize, setIdOf,
  type Action, type BugIncidentCapsule, type BugReportEnvelope, type RecordedActionWindow, type RunState,
} from '@game/sim';
import { qaScenarioRepro } from './bug-qa-scenario.lib';

/** The same greedy accepted-action driver bug-repro.lib.test uses, extended with the ring's rails. */
function recordRunWithRails(seed: number): { state: RunState; actions: Action[]; window: RecordedActionWindow[] } {
  let s = createRun(seed);
  const actions: Action[] = [];
  const window: RecordedActionWindow[] = [];
  const act = (a: Action): boolean => {
    const rngCursorBefore = s.rngCursor;
    const stateHashBefore = hashRunState(s);
    const next = reduce(s, a);
    if (next === s) return false;
    actions.push(a);
    window.push({ action: a, rngCursorBefore, stateHashBefore, stateHashAfter: hashRunState(next) });
    s = next;
    return true;
  };
  let steps = 0;
  while (steps++ < 200) {
    const settled = !s.questOffer && !s.discover && !s.chooseOne && !s.pendingTarget;
    if (settled && s.phase === 'recruit' && actions.length >= 6) break;
    if (s.questOffer) { act({ type: 'buyQuest', index: 0 }); continue; }
    if (s.discover) { act({ type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { act({ type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { act({ type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') { act({ type: 'resolveCombat' }); continue; }
    if (s.hand.length > 0 && s.board.length < CONFIG.boardMax && act({ type: 'play', uid: s.hand[0]!.uid })) continue;
    if (s.embers >= CONFIG.minionCost && s.shop.length > 0 && s.board.length + s.hand.length < CONFIG.boardMax && act({ type: 'buy', uid: s.shop[0]!.uid })) continue;
    if (!act({ type: 'faceOmen' })) break; // cross the turn boundary — a multi-wave window like a real run's
  }
  return { state: s, actions, window };
}

function makeEnvelope(state: RunState, actions: Action[], recentActions?: RecordedActionWindow[]): BugReportEnvelope {
  const capsule: BugIncidentCapsule = {
    runId: `${state.seed}:${state.heroId}`,
    seed: state.seed,
    heroId: state.heroId,
    mode: state.mode ?? 'ascent',
    setId: setIdOf(state),
    wave: state.wave,
    phase: state.phase,
    shopTier: state.tier,
    timerSecondsRemaining: null,
    serializedRun: serialize(state),
    actions,
    currentWaveFrames: [],
    previousWaveFrames: [],
    combat: null,
    ui: {
      selectedCardUid: null, selectedCardId: null, pendingTargetCardId: null,
      modalKind: null, draggingCardUid: null, viewport: { width: 1920, height: 1080, devicePixelRatio: 1 },
    },
    contextTruncated: [],
    ...(recentActions ? { recentActions } : {}),
  };
  return {
    schemaVersion: 1,
    reportId: 'bbbbbbbb-1111-2222-3333-444444444444',
    createdAt: '2026-08-27T00:00:00.000Z',
    description: 'The shop buff applied twice when I rolled',
    issueType: 'mechanics',
    context: capsule,
    client: {
      appVersion: '0.0.0-test', buildSha: 'testsha', contentRevision: 'set1+testsha', platform: 'web',
      userAgent: 'vitest', locale: 'en', accountUserId: null, playerName: null, sessionId: 's-test',
    },
  };
}

describe('bugs:repro × rolling window', () => {
  it('a faithful window verifies and the report says so (classification stays reproduced)', () => {
    const { state, actions, window } = recordRunWithRails(31);
    expect(window.length).toBeGreaterThanOrEqual(4);
    const outcome = qaScenarioRepro(makeEnvelope(state, actions, window.slice(-4)));
    expect(outcome.windowReplay?.applicable).toBe(true);
    expect(outcome.windowReplay?.ok).toBe(true);
    expect(outcome.classification).toBe('reproduced');
    expect(outcome.lines.some((l) => l.includes('window verified'))).toBe(true);
  });

  it('SABOTAGE: a doctored window rail classifies drifted and names the exact action', () => {
    const { state, actions, window } = recordRunWithRails(31);
    const tail = window.slice(-4);
    const doctored = tail.map((w, i) => (i === 2 ? { ...w, rngCursorBefore: (w.rngCursorBefore ?? 0) ^ 0x5555 } : w));
    const outcome = qaScenarioRepro(makeEnvelope(state, actions, doctored));
    expect(outcome.classification).toBe('drifted');
    expect(outcome.windowReplay?.divergence?.windowIndex).toBe(2);
    expect(outcome.windowReplay?.divergence?.actionIndex).toBe(actions.length - 4 + 2);
    expect(outcome.lines.some((l) => l.includes('EXACT REPLAY DIVERGED'))).toBe(true);
  });

  it('a pre-WP-C capsule (no window) keeps the old path untouched', () => {
    const { state, actions } = recordRunWithRails(31);
    const outcome = qaScenarioRepro(makeEnvelope(state, actions));
    expect(outcome.windowReplay).toBeUndefined();
    expect(outcome.classification).toBe('reproduced');
  });
});
