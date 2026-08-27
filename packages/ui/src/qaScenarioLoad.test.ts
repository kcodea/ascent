// @vitest-environment jsdom
/**
 * QA SCENARIO bridge (PR 2) — the store's import door: `loadQaScenario` enters Scene Builder mode with the
 * scenario's hydrated state, flagged `sandbox` (the write barrier every save/draft/upload path keys on),
 * re-pins a combat scenario's authored opponent, and rejects invalid or stale files WITHOUT touching the
 * store (§4.6: actionable validation, no production write path).
 *
 * The upload seams are mocked exactly as `bugScenarioLoad.test.ts` does, so importing the store stays an
 * offline no-op in tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRun, type RunState } from '@game/sim';
import { buildQaScenario, scenarioFileText } from './qaScenarioBridge';

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
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

import { useGame } from './store';

const scenarioTextFor = (run: RunState): string => scenarioFileText(buildQaScenario(run));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useGame.setState({ showTitle: false, presentationTx: null });
});

afterEach(() => {
  useGame.setState({ bugScenario: null });
});

describe('loadQaScenario', () => {
  it('rejects invalid payloads without touching the store', () => {
    const before = useGame.getState().run;
    const res = useGame.getState().loadQaScenario('{"schemaVersion":99}');
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('unsupported schemaVersion');
    expect(useGame.getState().run).toBe(before);
  });

  it('rejects a stale content id with the id named, without touching the store', () => {
    const run = createRun(11111);
    const scenario = buildQaScenario(run);
    const state = JSON.parse(scenario.state) as { shop: Array<{ cardId: string }> };
    state.shop[0]!.cardId = 'gone-card-999';
    const before = useGame.getState().run;
    const res = useGame.getState().loadQaScenario(JSON.stringify({ ...scenario, state: JSON.stringify(state) }));
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('gone-card-999');
    expect(useGame.getState().run).toBe(before);
  });

  it('imports a valid scenario into the sandbox: run entered, flagged sandbox, savedRun untouched', () => {
    const run = createRun(22222);
    const savedBefore = useGame.getState().savedRun;
    const res = useGame.getState().loadQaScenario(scenarioTextFor(run));
    expect(res).toEqual({ ok: true, errors: [] });
    const s = useGame.getState();
    expect(s.run.sandbox).toBe(true); // the load-bearing write barrier
    expect(s.run.seed).toBe(22222);
    expect(s.run.shop.map((c) => c.cardId)).toEqual(run.shop.map((c) => c.cardId));
    expect(s.showTitle).toBe(false);
    expect(s.savedRun).toBe(savedBefore); // the player's real Continue is never displaced
  });

  it('re-pins a combat scenario’s authored opponent for the state’s wave', () => {
    const base = createRun(33333);
    const opponent = {
      v: 1, wave: base.wave, heroId: 'warden', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass',
      power: 5, minions: [{ cardId: 'sandbag', attack: 0, health: 5, keywords: [] }], seed: 1, origin: 'self',
    };
    const run = { ...base, servedBoards: { [base.wave]: opponent } } as unknown as RunState;
    const res = useGame.getState().loadQaScenario(scenarioTextFor(run));
    expect(res.ok).toBe(true);
    const pinned = useGame.getState().run.servedBoards?.[base.wave];
    expect(pinned?.minions.map((m) => m.cardId)).toEqual(['sandbag']);
  });
});
