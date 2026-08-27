/**
 * BUG REPRO tests (blueprint §14.5) — recorded fixture envelopes built from a REAL tiny run (createRun +
 * reduce + serialize, the exact chain the in-game capture uses): recruit + combat incidents load, the
 * scenario exports, seeded drift is detected when one action is doctored, and reconstruction is faithful
 * for an undoctored capture.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG, createRun, reduce, serialize, setIdOf, type Action, type BugIncidentCapsule, type BugReportEnvelope, type RunState } from '@game/sim';
import { buildStarterTest, combatEventLines, reconstructFromSeed, reproEnvelope, validateContentIds } from './bug-repro.lib';

/** Drive a tiny deterministic run with the same greedy loop the replay harness uses, recording ONLY
 *  accepted (state-changing) actions — exactly what the reporter's capture stores. */
function recordRun(seed: number, untilCombat: boolean): { state: RunState; actions: Action[] } {
  let s = createRun(seed);
  const actions: Action[] = [];
  const act = (a: Action): boolean => {
    const before = s;
    s = reduce(s, a);
    if (s !== before) {
      actions.push(a);
      return true;
    }
    return false;
  };
  let steps = 0;
  while (steps++ < 500) {
    if (untilCombat && s.phase === 'combat' && s.lastCombat) break;
    const settled = !s.questOffer && !s.discover && !s.chooseOne && !s.pendingTarget;
    if (!untilCombat && settled && s.phase === 'recruit' && actions.length >= 3) break;
    if (s.questOffer) { act({ type: 'buyQuest', index: 0 }); continue; }
    if (s.discover) { act({ type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { act({ type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { act({ type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') { act({ type: 'resolveCombat' }); continue; }
    if (s.hand.length > 0 && s.board.length < CONFIG.boardMax) { act({ type: 'play', uid: s.hand[0]!.uid }); continue; }
    if (s.embers >= CONFIG.minionCost && s.shop.length > 0 && s.board.length + s.hand.length < CONFIG.boardMax && act({ type: 'buy', uid: s.shop[0]!.uid })) continue;
    if (!act({ type: 'faceOmen' })) break;
  }
  return { state: s, actions };
}

function makeEnvelope(state: RunState, actions: Action[]): BugReportEnvelope {
  const capsule: BugIncidentCapsule = {
    runId: `${state.seed}:${state.heroId}`,
    seed: state.seed,
    heroId: state.heroId,
    mode: state.mode ?? 'ascent',
    setId: setIdOf(state),
    wave: state.wave,
    phase: state.phase,
    shopTier: state.tier,
    timerSecondsRemaining: state.phase === 'recruit' ? 30 : null,
    serializedRun: serialize(state),
    actions,
    currentWaveFrames: [],
    previousWaveFrames: [],
    combat: state.lastCombat
      ? { result: state.lastCombat, visibleMomentIndex: null, visibleEventStep: null, replayDone: false, playbackSpeed: 1 }
      : null,
    ui: {
      selectedCardUid: null,
      selectedCardId: null,
      pendingTargetCardId: null,
      modalKind: null,
      draggingCardUid: null,
      viewport: { width: 1920, height: 1080, devicePixelRatio: 1 },
    },
    contextTruncated: [],
  };
  return {
    schemaVersion: 1,
    reportId: 'aaaaaaaa-1111-2222-3333-444444444444',
    createdAt: '2026-08-27T00:00:00.000Z',
    description: 'My minion did not attack the way its text says',
    issueType: 'mechanics',
    context: capsule,
    client: {
      appVersion: 'test',
      buildSha: 'testsha',
      contentRevision: `${capsule.setId}+testsha`,
      platform: 'web',
      userAgent: 'vitest',
      locale: 'en-US',
      accountUserId: null,
      playerName: null,
      sessionId: 's1',
    },
  };
}

describe('bugs:repro — recruit incident', () => {
  const { state, actions } = recordRun(7, false);
  const envelope = makeEnvelope(state, actions);

  it('loads a captured recruit incident: deserializes, validates content, summarizes', () => {
    const outcome = reproEnvelope(envelope);
    expect(outcome.run.wave).toBe(state.wave);
    expect(outcome.run.phase).toBe('recruit');
    expect(outcome.validation.contentRevisionMismatch).toBe(false);
    const text = outcome.lines.join('\n');
    expect(text).toContain('board (');
    expect(text).toContain('hand  (');
    expect(text).toContain('shop  (');
    expect(text).toContain('runes:');
    expect(text).toContain(`hero ${state.heroId}`);
  });

  it('reconstructs faithfully from seed + accepted actions (no drift on an undoctored capture)', () => {
    const r = reconstructFromSeed(envelope.context);
    expect(r.drift).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.actionsReplayed).toBe(actions.length);
  });

  it('detects seeded drift when one action is doctored — reporting the first mismatching index', () => {
    const doctored: BugIncidentCapsule = {
      ...envelope.context,
      actions: envelope.context.actions.map((a, i) =>
        i === 1 ? ({ type: 'buy', uid: 'uid-that-never-existed' } as Action) : a,
      ),
    };
    const r = reconstructFromSeed(doctored);
    expect(r.ok).toBe(false);
    expect(r.drift).not.toBeNull();
    // A bogus buy is rejected (or throws) in the real reducer → drift surfaces AT that action, never hidden.
    expect(['action_rejected', 'action_error']).toContain(r.drift!.kind);
    expect(r.drift!.actionIndex).toBe(1);
  });

  it('detects drift when the action log is truncated (final state cannot match)', () => {
    const truncated: BugIncidentCapsule = { ...envelope.context, actions: envelope.context.actions.slice(0, -1) };
    const r = reconstructFromSeed(truncated);
    expect(r.ok).toBe(false);
    expect(r.drift!.kind).toBe('final_state_mismatch');
    expect(r.drift!.mismatchedKeys!.length).toBeGreaterThan(0);
  });

  it('flags unknown content ids as a content-revision mismatch instead of crashing', () => {
    const run = { ...reproEnvelope(envelope).run };
    const withGhost: RunState = { ...run, board: [...run.board], ownedRunes: ['rune_that_never_shipped'] };
    withGhost.board[0] = { ...(run.board[0] ?? { uid: 'g', tribe: 'Beast', attack: 1, health: 1, keywords: [], golden: false, cardId: 'x' }), cardId: 'card_from_the_future' };
    const v = validateContentIds(withGhost, envelope.context);
    expect(v.contentRevisionMismatch).toBe(true);
    expect(v.unknownCardIds).toContain('card_from_the_future');
    expect(v.unknownRuneIds).toContain('rune_that_never_shipped');
  });

  it('produces a starter fixture as text with the placeholder assertion', () => {
    const fixture = buildStarterTest(envelope);
    expect(fixture).toContain('deserialize');
    expect(fixture).toContain('TODO(placeholder)');
    expect(fixture).toContain(`expect(run.wave).toBe(${state.wave})`);
    expect(fixture).toContain('untrusted claim');
  });
});

describe('bugs:repro — combat incident', () => {
  const { state, actions } = recordRun(7, true);
  const envelope = makeEnvelope(state, actions);

  it('the recorded run actually reached combat with an authoritative result', () => {
    expect(state.phase).toBe('combat');
    expect(state.lastCombat).toBeTruthy();
    expect(state.lastCombat!.events.length).toBeGreaterThan(0);
  });

  it('loads a captured combat incident and lists the captured event chains (replayed, not resimulated)', () => {
    const outcome = reproEnvelope(envelope);
    const text = outcome.lines.join('\n');
    expect(text).toContain(`captured combat: ${state.lastCombat!.events.length} events`);
    expect(text).toContain(`outcome: ${state.lastCombat!.result}`);
    // Every captured event is listed, indexed.
    expect(text).toContain(`#${state.lastCombat!.events.length - 1} `);
  });

  it('reconstruction through the real reducer reaches the same combat state', () => {
    const r = reconstructFromSeed(envelope.context);
    expect(r.drift).toBeNull();
    expect(r.ok).toBe(true);
  });

  it('combatEventLines separates chains at attacks', () => {
    const lines = combatEventLines(state.lastCombat!.events);
    expect(lines.length).toBeGreaterThanOrEqual(state.lastCombat!.events.length);
    expect(lines[0]).toContain('#0 ');
  });
});
