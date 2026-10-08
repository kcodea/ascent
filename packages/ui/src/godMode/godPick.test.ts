// packages/ui/src/godMode/godPick.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createLobbyRun, reduce, makeGodModeRun, GOD_MODE_MAX_ROUNDS, type Action, type BoardSnapshot, type RunState } from '@game/sim';
import { godEndTurnNeedsPick, godPanelLocked, runGodPick, type GodPickDeps, type GodPromptState } from './godPick';

const god = (): RunState => ({
  ...makeGodModeRun(createLobbyRun(7, 'warden', { maxRounds: GOD_MODE_MAX_ROUNDS }, 'practice', { opponents: 'players', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribes: [], godMode: true })),
  phase: 'recruit',
});
const dummies = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'warden', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 7,
  minions: Array.from({ length: 7 }, () => ({ cardId: 'sandbag', attack: 0, health: 1, keywords: [] })),
  seed: 1, origin: 'self',
});

/** A tiny harness over a plain run: `fight` is the real End Turn (`faceOmen` through the reducer). */
function harness(run: RunState, findBoard: GodPickDeps['findBoard']) {
  const box = { run, prompts: [] as GodPromptState[] };
  const fight = vi.fn(() => { box.run = reduce(box.run, { type: 'faceOmen' } as Action); });
  const deps: GodPickDeps = {
    getRun: () => box.run, setRun: (r) => { box.run = r; }, findBoard, setId: () => 'set3',
    setPrompt: (p) => { box.prompts.push(p); }, remember: () => {}, fight,
  };
  return { box, deps, fight };
}

describe('God Mode End Turn wiring', () => {
  it('End Turn opens the prompt in God Mode until a pick has pinned the foe; never outside God Mode', () => {
    expect(godEndTurnNeedsPick({ godMode: true }, false)).toBe(true);
    expect(godEndTurnNeedsPick({ godMode: true }, true)).toBe(false);
    expect(godEndTurnNeedsPick({ godMode: undefined }, false)).toBe(false);
  });

  it('a pick pins the board (servedBoards[wave] + sandboxFoeWave) and the fight starts against it', async () => {
    const run = god();
    const board = dummies(run.wave);
    const { box, deps, fight } = harness(run, async () => board);
    expect(await runGodPick(3, deps)).toBe('fought');
    expect(fight).toHaveBeenCalledTimes(1);
    expect(box.run.servedBoards?.[run.wave]).toBe(board);
    expect(box.run.sandboxFoeWave).toBe(run.wave);
    expect(box.run.phase).toBe('combat');
    expect(box.run.lastCombat!.initial.enemy.map((m) => m.cardId)).toEqual(Array(7).fill('sandbag'));
    expect(box.prompts).toEqual([{ busy: true, message: null }, null]);
  });

  it('a stale pick (the round moved on while fetching) is dropped: nothing pinned, no fight, prompt closed', async () => {
    const run = god();
    const { box, deps, fight } = harness(run, async () => { box.run = { ...box.run, wave: box.run.wave + 1 }; return dummies(run.wave); });
    expect(await runGodPick(3, deps)).toBe('stale');
    expect(fight).not.toHaveBeenCalled();
    expect(box.run.servedBoards?.[run.wave]).toBeUndefined();
    expect(box.run.sandboxFoeWave).toBeUndefined();
    expect(box.prompts.at(-1)).toBeNull();
  });

  it('no board, or a fetch that throws, says so and never leaves the prompt busy', async () => {
    for (const find of [async () => null, async () => { throw new Error('network'); }] as GodPickDeps['findBoard'][]) {
      const { box, deps, fight } = harness(god(), find);
      expect(await runGodPick(9, deps)).toBe('none');
      expect(fight).not.toHaveBeenCalled();
      expect(box.prompts.at(-1)).toEqual({ busy: false, message: 'No boards found for round 9 — try another' });
    }
  });

  it('the panel locks exactly where the reducer refuses God Mode actions: modal windows AND the Ancients offer', () => {
    const run = god();
    expect(godPanelLocked(run)).toBe(false);
    expect(godPanelLocked({ ...run, questOffer: ['q'] } as RunState)).toBe(true);
    const ancients = { ...run, ancientsEnabled: true, ancients: { ...(run.ancients ?? {}), offer: ['x'] } } as unknown as RunState;
    expect(godPanelLocked(ancients)).toBe(true);
    // …and the lock is the reducer's: a print under the Ancients offer is refused.
    expect(reduce(ancients, { type: 'godPrint', cardId: 'sandbag' } as Action).shop.length).toBe(ancients.shop.length);
    expect(reduce(run, { type: 'godPrint', cardId: 'sandbag' } as Action).shop.length).toBe(run.shop.length + 1);
  });
});
