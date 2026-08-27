/**
 * BUG REPRO tests (blueprint §14.5) — recorded fixture envelopes built from a REAL tiny run (createRun +
 * reduce + serialize, the exact chain the in-game capture uses): recruit + combat incidents load, the
 * scenario exports, seeded drift is detected when one action is doctored, and reconstruction is faithful
 * for an undoctored capture.
 */
import { describe, expect, it } from 'vitest';
import { CONFIG, createRun, reduce, runQaScenario, serialize, setIdOf, snapshotBoard, validateQaScenario, type Action, type BoardSnapshot, type BugIncidentCapsule, type BugReportEnvelope, type RunState } from '@game/sim';
import { buildStarterTest, combatEventLines, reconstructFromSeed, reproEnvelope, validateContentIds } from './bug-repro.lib';
import { buildQaScenarioFromEnvelope, compareCapturedCombat, qaScenarioRepro, untrustedClaimQuestion } from './bug-qa-scenario.lib';

/** Drive a tiny deterministic run with the same greedy loop the replay harness uses, recording ONLY
 *  accepted (state-changing) actions — exactly what the reporter's capture stores. `pinBoard` pre-pins the
 *  first wave's opponent (a restored run's shape), so a combat capture can fight a REAL BoardSnapshot
 *  instead of the procedural threat. */
function recordRun(seed: number, untilCombat: boolean, pinBoard?: BoardSnapshot): { state: RunState; actions: Action[] } {
  let s = createRun(seed);
  if (pinBoard) s = { ...s, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: pinBoard } };
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

  it('produces a starter fixture that graduates the bug into a QA scenario fixture (§11.4)', () => {
    const fixture = buildStarterTest(envelope);
    expect(fixture).toContain('runQaScenario');
    expect(fixture).toContain('parseQaScenario');
    expect(fixture).toContain('qa-scenario.json');
    expect(fixture).toContain('TODO(placeholder)');
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

describe('bugs:repro — MENU report (no run evidence, owner ask 2026-08-27)', () => {
  const { state, actions } = recordRun(7, false);
  const envelope = makeEnvelope(state, actions);
  const menuEnvelope: BugReportEnvelope = {
    ...envelope,
    context: {
      ...envelope.context,
      runId: 'menu', seed: 0, heroId: 'none', mode: 'menu', wave: 0, phase: 'menu', shopTier: 0,
      serializedRun: null, actions: [], currentWaveFrames: [], previousWaveFrames: [], combat: null,
      timerSecondsRemaining: null,
    },
  };

  it('reproEnvelope refuses with "menu report — no run evidence", never a crash', () => {
    expect(() => reproEnvelope(menuEnvelope)).toThrowError(/menu report — no run evidence/);
  });

  it('reconstructFromSeed reports the same, without touching createRun', () => {
    const r = reconstructFromSeed(menuEnvelope.context);
    expect(r.ok).toBe(false);
    expect(r.actionsReplayed).toBe(0);
    expect(r.drift?.error).toContain('menu report — no run evidence');
  });

  it('qaScenarioRepro declines a menu report: no scenario, menu-no-evidence classification', () => {
    const qa = qaScenarioRepro(menuEnvelope);
    expect(qa.scenario).toBeNull();
    expect(qa.classification).toBe('menu-no-evidence');
  });
});

// ── PR 9: bug reports speak QaScenarioV1 (§3.3 one scenario format, §11.2 classification) ──────────────────

describe('bugs → QaScenarioV1 — recruit report', () => {
  const { state, actions } = recordRun(7, false);
  const envelope = makeEnvelope(state, actions);

  it('emits a valid QaScenarioV1 (source bug-report) that validateQaScenario accepts', () => {
    const { scenario } = buildQaScenarioFromEnvelope(envelope);
    expect(scenario).not.toBeNull();
    expect(scenario!.source).toBe('bug-report');
    expect(scenario!.mode).toBe('recruit');
    expect(scenario!.seed).toBe(state.seed);
    expect(scenario!.metadata?.reportId).toBe(envelope.reportId);
    expect(validateQaScenario(scenario)).toEqual([]);
  });

  it('round-trips through the REAL runQaScenario: hydrates, executes, surfaces the claim as needs-ruling', () => {
    const { scenario } = buildQaScenarioFromEnvelope(envelope);
    const result = runQaScenario(scenario!);
    expect(result.validationErrors).toEqual([]);
    expect(result.ok).toBe(true);
    // Reproduction first, assertion after triage (§11.4): the ONLY expectation is the untrusted claim.
    expect(result.needsRuling).toHaveLength(1);
    expect(result.needsRuling[0]).toContain('UNTRUSTED');
    expect(result.needsRuling[0]).toContain(envelope.description);
    expect(qaScenarioRepro(envelope).classification).toBe('reproduced');
  });

  it('SABOTAGE: a doctored emitted scenario fails validation loudly, never silently', () => {
    const { scenario } = buildQaScenarioFromEnvelope(envelope);
    // Doctored seed — the envelope no longer matches its own serialized state.
    const seedDoctored = { ...scenario!, seed: scenario!.seed + 1 };
    const seedErrors = validateQaScenario(seedDoctored);
    expect(seedErrors.length).toBeGreaterThan(0);
    expect(seedErrors.join(' ')).toContain('seed mismatch');
    // Doctored content — the state references a card this build has never shipped.
    const parsed = JSON.parse(scenario!.state) as { board: Array<{ cardId: string }> };
    parsed.board = [...parsed.board];
    parsed.board[0] = { ...(parsed.board[0] ?? { cardId: 'x' }), cardId: 'card_from_the_future' };
    const cardDoctored = { ...scenario!, state: JSON.stringify(parsed) };
    const cardErrors = validateQaScenario(cardDoctored);
    expect(cardErrors.join(' ')).toContain("unknown card id 'card_from_the_future'");
  });
});

describe('bugs → QaScenarioV1 — combat report (re-simulation + drift, §11.2 step 4)', () => {
  // The opponent must be a REAL pinned BoardSnapshot for combat mode to be expressible — snapshot a second
  // deterministic run's wave-1 board and pre-pin it, the exact shape a restored run carries.
  const opponent: BoardSnapshot = snapshotBoard(recordRun(11, false).state);
  const { state, actions } = recordRun(7, true, opponent);
  const envelope = makeEnvelope(state, actions);

  it('the capture actually fought the pinned board', () => {
    expect(state.phase).toBe('combat');
    expect(actions[actions.length - 1]!.type).toBe('faceOmen');
    expect((state.servedBoards ?? {})[state.wave]).toBe(opponent);
  });

  it('emits a combat-mode scenario carrying the captured servedBoards pin as combat.opponent', () => {
    const { scenario, notes } = buildQaScenarioFromEnvelope(envelope);
    expect(scenario).not.toBeNull();
    expect(scenario!.mode).toBe('combat');
    expect(scenario!.combat?.opponent.minions.map((m) => m.cardId)).toEqual(opponent.minions.map((m) => m.cardId));
    expect(notes.join(' ')).toContain('pre-combat state rebuilt');
    expect(validateQaScenario(scenario)).toEqual([]);
  });

  it('re-simulates through the real engine and RECONCILES with the captured outcome (reproduced)', () => {
    const qa = qaScenarioRepro(envelope);
    expect(qa.classification).toBe('reproduced');
    expect(qa.comparison.applicable).toBe(true);
    expect(qa.comparison.drifted).toBe(false);
    expect(qa.result?.combatOutcome).toBe(state.lastCombat!.result);
    expect(qa.result?.combatLog?.length).toBe(state.lastCombat!.events.length);
  });

  it('SABOTAGE: a doctored captured outcome reports DRIFT, not silence', () => {
    const doctored: BugReportEnvelope = {
      ...envelope,
      context: {
        ...envelope.context,
        combat: {
          ...envelope.context.combat!,
          result: {
            ...envelope.context.combat!.result,
            result: envelope.context.combat!.result.result === 'win' ? 'lose' : 'win',
          },
        },
      },
    };
    const qa = qaScenarioRepro(doctored);
    expect(qa.classification).toBe('drifted');
    expect(qa.comparison.drifted).toBe(true);
    expect(qa.lines.join('\n')).toContain('outcome differs');
  });

  it('compareCapturedCombat itemizes a doctored event (first differing index), never hides it', () => {
    const qa = qaScenarioRepro(envelope);
    const doctoredCombat = {
      ...envelope.context.combat!,
      result: {
        ...envelope.context.combat!.result,
        events: envelope.context.combat!.result.events.map((e, i) => (i === 0 ? { ...e, doctored: true } : e)),
      },
    };
    const cmp = compareCapturedCombat(doctoredCombat, qa.result);
    expect(cmp.drifted).toBe(true);
    expect(cmp.lines.join(' ')).toContain('first differing event: #0');
  });
});

describe('untrustedClaimQuestion', () => {
  it('marks the claim untrusted, collapses whitespace, clips long prose', () => {
    const q = untrustedClaimQuestion('line one\n\n  line two');
    expect(q).toContain('UNTRUSTED');
    expect(q).toContain('"line one line two"');
    expect(untrustedClaimQuestion('x'.repeat(2000)).length).toBeLessThan(700);
  });
});
