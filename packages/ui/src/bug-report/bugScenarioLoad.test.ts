// @vitest-environment jsdom
/**
 * BUG REPORTER (PR 4) — the store's scenario load: enters Scene Builder mode with the captured run, writes
 * NOTHING (saves, replay drafts, fight-result / run-end uploads), plays through the REAL reducer, and loads
 * a content-revision mismatch read-only (§13 last row).
 *
 * The upload seams are partially mocked so "never called" is observable; everything else (identity, queue)
 * stays real — the same offline no-ops every other store-importing test runs with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun, type BoardCard, type RunState } from '@game/sim';
import { captureIncidentCapsule, type BugCaptureSource } from './bugReportCapture';
import { BUG_SCENARIO_KIND } from './bugScenario';

vi.mock('../remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    recordFightResult: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});

import { useGame } from '../store';
import { uploadBoards, uploadRunHistory, uploadRunTelemetry, uploadVictory, recordFightResult } from '../remoteBoards';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function captureSource(run: RunState): BugCaptureSource {
  return {
    run,
    replayActions: [],
    replayFrames: [],
    inspect: null,
    showLeaderboard: false,
    showRankings: false,
    showRecentGames: false,
    showCareer: false,
    showBook: false,
    showBalance: false,
    showPatchNotes: false,
    combatSpeed: 1,
  };
}

function scenarioJsonFor(run: RunState): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: BUG_SCENARIO_KIND,
    reportId: 'r-load-test',
    description: 'The shop offered the same minion five times in a row.',
    issueType: 'other',
    capsule: captureIncidentCapsule(captureSource(run)),
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useGame.setState({ bugScenario: null, showTitle: false, replaying: false, presentationTx: null });
});

afterEach(() => {
  useGame.setState({ bugScenario: null });
});

describe('loadBugScenario', () => {
  it('rejects invalid payloads without touching the store', () => {
    const before = useGame.getState().run;
    const res = useGame.getState().loadBugScenario('{"kind":"nope"}');
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(useGame.getState().run).toBe(before);
    expect(useGame.getState().bugScenario).toBeNull();
  });

  it('enters Scene Builder mode with the captured run, flagged sandbox, keeping its original mode', () => {
    const run = createRun(31337); // mode 'ascent' — NOT practice: the sandbox flag, not the mode, is the write barrier
    const res = useGame.getState().loadBugScenario(scenarioJsonFor(run));
    expect(res).toEqual({ ok: true, errors: [] });
    const s = useGame.getState();
    expect(s.run.sandbox).toBe(true);
    expect(s.run.mode).toBe('ascent');
    expect(s.run.seed).toBe(31337);
    expect(s.run.shop.map((c) => c.cardId)).toEqual(run.shop.map((c) => c.cardId));
    expect(s.bugScenario?.reportId).toBe('r-load-test');
    expect(s.bugScenario?.readOnly).toBe(false);
    expect(s.showTitle).toBe(false);
  });

  it('the loaded run accepts a real action (roll) through the real reducer', () => {
    const run = createRun(90210);
    useGame.getState().loadBugScenario(scenarioJsonFor(run));
    const before = useGame.getState().run;
    useGame.getState().dispatch({ type: 'roll' });
    const after = useGame.getState().run;
    expect(after).not.toBe(before); // the reducer produced a new state — the action was accepted
    expect(after.embers).toBe(before.embers - 1); // a Refresh costs 1 Gold
    expect(after.sandbox).toBe(true); // the sandbox flag survives reduction
    expect(useGame.getState().replayActions).toEqual([{ type: 'roll' }]);
  });

  it('writes NO save while loading, playing, or finishing — and no uploads on a run-end', async () => {
    const run = createRun(555); // ascent mode: pre-guard, a finish from this run WOULD have uploaded
    run.resolve = 1;
    run.armor = 0; // no armor to absorb the hit
    run.board = []; // an empty board loses wave 1, and 1 Resolve makes that loss the run's end
    useGame.getState().loadBugScenario(scenarioJsonFor(run));
    expect(localStorage.getItem('ascent.save')).toBeNull();

    useGame.getState().dispatch({ type: 'roll' });
    useGame.getState().dispatch({ type: 'faceOmen' });
    expect(useGame.getState().run.phase).toBe('combat');
    expect(useGame.getState().run.lastCombat?.result).toBe('lose');
    useGame.getState().dispatch({ type: 'resolveCombat' });
    expect(useGame.getState().run.phase).toBe('gameover'); // the run-end block's condition WAS reached…

    await sleep(30); // …its uploads are deferred a tick — let any (wrongly) scheduled work run
    expect(vi.mocked(recordFightResult)).not.toHaveBeenCalled();
    expect(vi.mocked(uploadBoards)).not.toHaveBeenCalled();
    expect(vi.mocked(uploadVictory)).not.toHaveBeenCalled();
    expect(vi.mocked(uploadRunTelemetry)).not.toHaveBeenCalled();
    expect(vi.mocked(uploadRunHistory)).not.toHaveBeenCalled();
    expect(localStorage.getItem('ascent.save')).toBeNull(); // phase changes never autosaved the sandbox

    // The explicit mid-turn flush is guarded too.
    useGame.getState().flushSave();
    expect(localStorage.getItem('ascent.save')).toBeNull();
  });

  it('loads a content-revision mismatch READ-ONLY: panel data set, banner armed, run untouched (§13)', () => {
    const run = createRun(777);
    const ghost: BoardCard = {
      uid: 'ghost1', cardId: 'card_deleted_in_this_build', tribe: 'neutral',
      attack: 1, health: 1, keywords: [], golden: false,
    };
    run.board = [ghost];
    const before = useGame.getState().run;
    const res = useGame.getState().loadBugScenario(scenarioJsonFor(run));
    expect(res.ok).toBe(true); // the FILE is valid — the mismatch is a display state, not a rejection
    const s = useGame.getState();
    expect(s.run).toBe(before); // the broken run is never entered (it would die on a CARD_INDEX deref)
    expect(s.bugScenario?.readOnly).toBe(true);
    expect(s.bugScenario?.missingCardIds).toEqual(['card_deleted_in_this_build']);
    expect(localStorage.getItem('ascent.save')).toBeNull();
  });

  it('clearBugScenario drops the report and leaves the run alone', () => {
    const run = createRun(31338);
    useGame.getState().loadBugScenario(scenarioJsonFor(run));
    const loaded = useGame.getState().run;
    useGame.getState().clearBugScenario();
    expect(useGame.getState().bugScenario).toBeNull();
    expect(useGame.getState().run).toBe(loaded);
  });
});
