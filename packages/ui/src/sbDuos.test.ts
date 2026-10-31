// @vitest-environment jsdom
/**
 * THE SCENE BUILDER'S PLACEHOLDER TEAMMATE, through the store (DEV, owner ask 2026-10-31, R-SB-DUOS-01): the Duos toggle
 * builds a Duos-style rig run, the teammate is made for it, a drag pass reaches them, the tuner's "teammate passes to
 * you" lands on your run through `receivePass`, the view swap puts their run on screen and back, and End Turn on their
 * screen takes you home instead of ending a turn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  };
});

import { CARD_INDEX } from '@game/content';
import type { BoardCard } from '@game/sim';
import { useGame } from './store';
import { installSbDuos, sbMatePasses, sbMateRun, sbMateSells, sbMyRun, uninstallSbDuos, useSbDuos } from './sbDuos';
import { enterTeammateView } from './versus/teammateView';
import { localMate, useLocalMate } from './versus/localMate';
import { duosPassRefusal } from './versus/duosPassUi';
import { useSpectate } from './versus/spectate';

const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const plainId = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1 && !c.duos && c.effects.length === 0)!.id;
const card = (id: string, uid: string): BoardCard => {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};

describe('Scene Builder Duos (R-SB-DUOS-01)', () => {
  beforeEach(() => {
    localStorage.clear();
    useGame.setState({ sbRules: 'god', sbBotLevel: 1, sbDuos: false });
  });
  afterEach(() => uninstallSbDuos());

  it('the toggle relaunches the rig as a Duos-style run; off, the run has no Duos state', () => {
    useGame.getState().startSceneBuilder('warden', 'set2');
    expect(useGame.getState().run.duos).toBeUndefined();
    useGame.getState().setSbDuos(true);
    const run = useGame.getState().run;
    expect(run.sandbox).toBe(true);
    expect(run.duos).toEqual({ outbox: [], received: [], refused: [] });
    expect(run.pool['duo_hitchhiker']).toBeGreaterThan(0);
    expect(localStorage.getItem('ascent.sb.duos')).toBe('1');
  });

  it('passes both ways through the local channel, and the view swap shows their run', async () => {
    useGame.setState({ sbDuos: true });
    useGame.getState().startSceneBuilder('warden', 'set2');
    installSbDuos();
    expect(localMate()).not.toBeNull();
    const mate0 = sbMateRun()!;
    expect(mate0.duos).toBeDefined();
    expect(useLocalMate.getState().mate?.hero).toBe(mate0.heroId);

    // My drag pass (the reducer's `passCard`, as Recruit dispatches it) reaches the teammate.
    useGame.setState({ run: { ...useGame.getState().run, hand: [card(plainId, 'mine1')] } });
    expect(duosPassRefusal(useGame.getState().run, 'mine1')).toBeNull();
    useGame.getState().dispatch({ type: 'passCard', uid: 'mine1' });
    await flush();
    expect(sbMateRun()!.hand.map((c) => c.passKey)).toEqual(['p1:0']);
    expect(useGame.getState().run.hand).toHaveLength(0);

    // The tuner: the teammate passes me a Duos card, through their own pass and my `receivePass`.
    sbMatePasses({ kind: 'card', cardId: 'duo_hitchhiker' });
    await flush();
    const got = useGame.getState().run.hand.find((c) => c.cardId === 'duo_hitchhiker');
    expect(got?.passKey).toBe('p2:0');
    expect(sbMateRun()!.duos!.outbox).toHaveLength(1);

    // The teammate sells a minion: my run hears it (a `sold` team effect landed).
    sbMateSells(plainId);
    await flush();
    expect(useGame.getState().run.duos!.received).toEqual(['p2:0', 'p2:1']);

    // View their board: their run is in the store, mine held aside, the teammate view's key-hold on.
    const mine = useGame.getState().run;
    enterTeammateView();
    expect(useSbDuos.getState().viewing).toBe(true);
    expect(useGame.getState().run.seed).toBe(mate0.seed);
    expect(useSpectate.getState().teammate).toBe(true);
    expect(sbMyRun()).toBe(mine);
    // End Turn on their screen never ends a turn: it takes me back to my own board.
    useGame.getState().dispatch({ type: 'faceOmen' });
    expect(useSbDuos.getState().viewing).toBe(false);
    expect(useGame.getState().run).toBe(mine);
    expect(useGame.getState().run.phase).toBe('recruit');
    expect(useSpectate.getState().teammate).toBe(false);
  });

  it('a manual pass is refused up front when the teammate hand is full (the portrait says why)', () => {
    useGame.setState({ sbDuos: true });
    useGame.getState().startSceneBuilder('warden', 'set2');
    installSbDuos();
    const mate = sbMateRun()!;
    useSbDuos.setState({ other: { ...mate, hand: Array.from({ length: 10 }, (_, i) => card(plainId, `h${i}`)) } });
    useGame.setState({ run: { ...useGame.getState().run, hand: [card(plainId, 'mine1')] } });
    expect(duosPassRefusal(useGame.getState().run, 'mine1')).toBe('Their hand is full');
  });

  it('turning Duos off drops the teammate and the seam', () => {
    useGame.setState({ sbDuos: true });
    useGame.getState().startSceneBuilder('warden', 'set2');
    installSbDuos();
    expect(sbMateRun()).not.toBeNull();
    uninstallSbDuos();
    expect(localMate()).toBeNull();
    expect(sbMateRun()).toBeNull();
    expect(useLocalMate.getState().mate).toBeNull();
  });
});
