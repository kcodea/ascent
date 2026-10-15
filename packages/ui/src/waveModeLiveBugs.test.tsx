// @vitest-environment jsdom
/**
 * THE OLD WAVE MODE'S LEFTOVERS MUST NOT RUN IN LIVE PLAY (owner 2026-10-14: "there are remnants of the old wave
 * based mode that you can outright remove... make sure it doesnt break our lobby/versus modes though").
 *
 * R-LEDGER-01: a lobby fight never writes the retired per-board `board_results` ledger. The store used to credit
 * every non-practice fight to `nextOpponent(run)`, the wave-first POOL pick the reducer pins into `servedBoards`,
 * which a lobby never fights (it fights the paired seat). The pin is planted here with an id so the old path
 * would have fired.
 *
 * R-ENDSCREEN-01: a lobby, tutorial or Gauntlet end screen never runs the retired course screen's work: no
 * `replayRun` re-simulation of the action log, no build tags, no Line verdict.
 *
 * The upload seams and those three sim helpers are spies; the reducer, the lobby and the screens are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordFightResult = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
    // A tripwire: the export is gone, so if anything re-imports a ledger writer by this name it binds to this spy.
    recordFightResult,
  };
});

const simSpies = vi.hoisted(() => ({ replayRun: vi.fn(), buildTags: vi.fn(), lineResult: vi.fn() }));
vi.mock('@game/sim', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@game/sim')>();
  return {
    ...mod,
    replayRun: (...a: Parameters<typeof mod.replayRun>) => { simSpies.replayRun(); return mod.replayRun(...a); },
    buildTags: (...a: Parameters<typeof mod.buildTags>) => { simSpies.buildTags(); return mod.buildTags(...a); },
    lineResult: (...a: Parameters<typeof mod.lineResult>) => { simSpies.lineResult(); return mod.lineResult(...a); },
  };
});

import { snapshotBoard } from '@game/sim';
import { useGame } from './store';
import { EndScreen } from './EndScreen';
import { mount, type Mounted } from './renderedText.mount';

let m: Mounted | null = null;

beforeEach(() => {
  localStorage.clear();
  recordFightResult.mockClear();
  for (const f of Object.values(simSpies)) f.mockClear();
});
afterEach(() => { m?.unmount(); m = null; });

describe('R-LEDGER-01: a lobby fight writes no board_results row', () => {
  it('a ranked lobby fight never credits the pinned pool board', () => {
    useGame.setState({ pendingMode: 'lobby' });
    useGame.getState().pickHero('warden');
    const run = useGame.getState().run;
    expect(run.lobby, 'a ranked game is a lobby').toBeTruthy();
    // Plant the wave's pool pin WITH an id, exactly what the old ledger keyed on.
    const pin = { ...snapshotBoard(run), id: 'pool-board-nobody-fought' };
    useGame.setState({ run: { ...run, servedBoards: { ...(run.servedBoards ?? {}), [run.wave]: pin } } });
    useGame.getState().dispatch({ type: 'faceOmen' });
    expect(useGame.getState().run.lastCombat, 'the fight resolved').toBeTruthy();
    expect(recordFightResult).not.toHaveBeenCalled();
  });
});

describe('R-ENDSCREEN-01: live end screens skip the retired course screen work', () => {
  it('a lobby end screen never re-simulates the run or grades a Line', () => {
    useGame.setState({ pendingMode: 'lobby' });
    useGame.getState().pickHero('warden');
    const run = useGame.getState().run;
    useGame.setState({ run: { ...run, phase: 'gameover' }, replayActions: [{ type: 'roll' }, { type: 'faceOmen' }] });
    m = mount(<EndScreen won={false} />);
    expect(m.container.textContent ?? '', 'the lobby screen rendered').not.toBe('');
    expect(simSpies.replayRun).not.toHaveBeenCalled();
    expect(simSpies.buildTags).not.toHaveBeenCalled();
    expect(simSpies.lineResult).not.toHaveBeenCalled();
  });
});
