// @vitest-environment jsdom
/**
 * STAGE BUILDER store (DEV): the draft / round / dirty state, the Title launch, and the two-way sync between the
 * selected round and the Scene Builder sandbox's pinned opponent board. Store-only, like `sceneBuilderLaunch.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_INDEX, cardRevision, type GauntletStage } from '@game/content';

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

const plain = Object.values(CARD_INDEX).find((c) => !c.spell && (c.keywords ?? []).length === 0)!;

const fixture = (): GauntletStage => ({
  number: 1, name: 'Test', opponentName: 'Tester', status: 'draft', runes: {},
  rounds: Array.from({ length: 10 }, (_, i) => ({
    // Rounds 1–2 hold a board; round 3 onward is empty (a draft stage may hold empty rounds).
    board: i < 2 ? [{ cardId: plain.id, attack: 1 + i, health: 2 + i, cardVersion: 'old' }] : [],
  })),
});

vi.mock('./stageBuilderApi', () => ({
  loadStage: vi.fn(async () => fixture()),
  saveStage: vi.fn(async () => ({ ok: true as const, path: 'stages/01-demons.json' })),
}));

import { useGame } from '../store';
import { setEnemyStats } from '../sandboxEdit';
import { saveStage } from './stageBuilderApi';
import { useStageBuilder } from './stageBuilderStore';

const sb = () => useStageBuilder.getState();
const run = () => useGame.getState().run;
const pin = () => run().servedBoards?.[run().wave];

describe('Stage Builder store', () => {
  beforeEach(async () => {
    localStorage.clear();
    useStageBuilder.getState().close(true);
    vi.mocked(saveStage).mockClear();
    await useGame.getState().startStageBuilder(1);
  });

  it('startStageBuilder opens a sandbox with round 1 pinned as the rig-authored foe', () => {
    expect(run().sandbox).toBe(true);
    expect(sb().open).toBe(true);
    expect(sb().stageNumber).toBe(1);
    expect(sb().round).toBe(1);
    expect(run().sandboxFoeWave).toBe(run().wave);
    expect(pin()!.minions).toEqual([{ cardId: plain.id, attack: 1, health: 2 }]);
  });

  it('selectRound re-pins the chosen round', () => {
    sb().selectRound(2);
    expect(sb().round).toBe(2);
    expect(pin()!.minions[0]).toMatchObject({ attack: 2, health: 3 });
    expect(run().sandboxFoeWave).toBe(run().wave);
  });

  it('an empty round clears the pin and says so', () => {
    sb().selectRound(3);
    expect(pin()).toBeUndefined();
    expect(run().sandboxFoeWave).toBeUndefined();
    expect(sb().status).toMatch(/Round 3 is empty/);
  });

  it('editDraft marks the round dirty and re-pins', () => {
    expect(sb().dirtyRounds()).toEqual([]);
    sb().editDraft((s) => ({ ...s, rounds: s.rounds.map((r, i) => (i === 0 ? { ...r, board: [{ ...r.board[0]!, attack: 9 }] } : r)) }));
    expect(sb().dirtyRounds()).toEqual([1]);
    expect(pin()!.minions[0]!.attack).toBe(9);
    sb().editDraft((s) => ({ ...s, opponentName: 'Renamed' }));
    expect(sb().dirtyRounds()).toEqual([0, 1]);
  });

  it('a tavern-row edit of the pin flows back into the draft (subscription + syncFromPin)', () => {
    const edited = setEnemyStats(pin()!, 0, { attack: 7, health: 8 });
    const live = run();
    useGame.setState({ run: { ...live, servedBoards: { ...live.servedBoards, [live.wave]: edited }, sandboxFoeWave: live.wave } });
    expect(sb().draft!.rounds[0]!.board[0]).toMatchObject({ attack: 7, health: 8 });
    expect(sb().dirtyRounds()).toEqual([1]);
    // Our own pin write did not bounce back as a sync: the pin is still the tavern's object.
    expect(pin()).toBe(edited);
    // syncFromPin on an unchanged pin is a no-op.
    const before = sb().draft;
    sb().syncFromPin();
    expect(sb().draft).toBe(before);
  });

  it('a new wave (after a fight) re-pins the selected round at that wave', () => {
    sb().selectRound(2);
    const live = run();
    useGame.setState({ run: { ...live, wave: live.wave + 1 } });
    expect(run().sandboxFoeWave).toBe(live.wave + 1);
    expect(pin()!.wave).toBe(live.wave + 1);
    expect(pin()!.minions[0]).toMatchObject({ attack: 2, health: 3 });
  });

  it('save refuses an invalid draft with the validateStage issue', async () => {
    sb().editDraft((s) => ({ ...s, rounds: s.rounds.map((r, i) => (i === 0 ? { ...r, board: [{ ...r.board[0]!, cardId: 'no_such_card' }] } : r)) }));
    await sb().save();
    expect(saveStage).not.toHaveBeenCalled();
    expect(sb().status).toContain("unknown card 'no_such_card'");
    expect(sb().dirtyRounds()).toEqual([1]);
  });

  it('save stamps card versions, writes, and clears dirty', async () => {
    sb().editDraft((s) => ({ ...s, opponentName: 'Renamed' }));
    await sb().save();
    expect(saveStage).toHaveBeenCalledTimes(1);
    const written = vi.mocked(saveStage).mock.calls[0]![0];
    expect(written.opponentName).toBe('Renamed');
    expect(written.rounds[0]!.board[0]!.cardVersion).toBe(cardRevision(plain));
    expect(sb().dirtyRounds()).toEqual([]);
    expect(sb().saved).toEqual(written);
  });

  it('close while dirty stays open; close(true) closes', () => {
    sb().editDraft((s) => ({ ...s, opponentName: 'Renamed' }));
    sb().close();
    expect(sb().open).toBe(true);
    expect(sb().status).toMatch(/unsaved/i);
    sb().close(true);
    expect(sb().open).toBe(false);
    expect(sb().draft).toBeNull();
  });

  it('the game leaving the sandbox closes the builder, so a later plain Scene Builder launch pins nothing', () => {
    // Dirty on purpose: the sandbox run it edited is gone, so the close is forced (nothing left to confirm against).
    sb().editDraft((s) => ({ ...s, opponentName: 'Renamed' }));
    const live = run();
    useGame.setState({ run: { ...live, sandbox: undefined } });
    expect(sb().open).toBe(false);
    expect(sb().draft).toBeNull();
    useGame.getState().startSceneBuilder('warden');
    expect(run().sandbox).toBe(true);
    expect(run().sandboxFoeWave).toBeUndefined();
    expect(pin()).toBeUndefined();
  });

  it('discard restores the saved copy and re-pins it', () => {
    sb().editDraft((s) => ({ ...s, rounds: s.rounds.map((r, i) => (i === 0 ? { ...r, board: [{ ...r.board[0]!, attack: 9 }] } : r)) }));
    sb().discard();
    expect(sb().dirtyRounds()).toEqual([]);
    expect(pin()!.minions[0]!.attack).toBe(1);
  });

  it('selectStage refuses while dirty unless forced', async () => {
    sb().editDraft((s) => ({ ...s, opponentName: 'Renamed' }));
    await sb().selectStage(2);
    expect(sb().stageNumber).toBe(1);
    expect(sb().status).toMatch(/unsaved/i);
    await sb().selectStage(2, true);
    expect(sb().stageNumber).toBe(2);
    expect(sb().dirtyRounds()).toEqual([]);
  });
});
