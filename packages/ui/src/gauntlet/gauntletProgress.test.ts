// @vitest-environment jsdom
/**
 * GAUNTLET device-local progress: which stages this browser has cleared, what that unlocks, and how each of the
 * ten stage-select slots reads. Stage data is injected (the shipped stages are all empty drafts today).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GauntletStage } from '@game/content';

const stages = vi.hoisted(() => new Map<number, unknown>());
vi.mock('@game/content', async (orig) => ({
  ...(await orig<typeof import('@game/content')>()),
  gauntletStage: (n: number) => stages.get(n),
}));

import { GAUNTLET_LOCAL_KEY, clearedStages, isStagePlayable, isStageUnlocked, recordClear, stageSlotState } from './gauntletProgress';

const minion = { cardId: 'alley', attack: 1, health: 1, cardVersion: 'x' };
const stage = (number: number, status: 'ready' | 'draft', filledRounds: number): GauntletStage => ({
  number, name: `S${number}`, opponentName: 'Host', status, runes: {},
  rounds: Array.from({ length: 10 }, (_, i) => ({ board: i < filledRounds ? [minion] : [] })),
});

beforeEach(() => {
  localStorage.clear();
  stages.clear();
  stages.set(1, stage(1, 'ready', 10));
  stages.set(2, stage(2, 'ready', 10));
  stages.set(3, stage(3, 'draft', 1)); // a draft with content: DEV-playable
  stages.set(4, stage(4, 'draft', 0)); // an empty draft: never playable
  // 5+ have no file at all.
});

describe('clearedStages / recordClear', () => {
  it('is empty with nothing stored, and with unreadable storage', () => {
    expect(clearedStages()).toEqual([]);
    localStorage.setItem(GAUNTLET_LOCAL_KEY, '{not json');
    expect(clearedStages()).toEqual([]);
    localStorage.setItem(GAUNTLET_LOCAL_KEY, JSON.stringify({ a: 1 }));
    expect(clearedStages()).toEqual([]);
  });

  it('records a clear once: the first clear is first, a repeat is not, and the list stays sorted + unique', () => {
    expect(recordClear(2)).toEqual({ firstClear: true });
    expect(recordClear(1)).toEqual({ firstClear: true });
    expect(recordClear(2)).toEqual({ firstClear: false });
    expect(clearedStages()).toEqual([1, 2]);
  });

  it('drops junk entries from a hand-edited store', () => {
    localStorage.setItem(GAUNTLET_LOCAL_KEY, JSON.stringify([3, 'x', 1, 1, 2.5, -1]));
    expect(clearedStages()).toEqual([1, 3]);
  });
});

describe('isStageUnlocked', () => {
  it('stage 1 is always open; every other stage opens when the one before it is cleared', () => {
    expect(isStageUnlocked(1, [])).toBe(true);
    expect(isStageUnlocked(2, [])).toBe(false);
    expect(isStageUnlocked(2, [1])).toBe(true);
    expect(isStageUnlocked(3, [1])).toBe(false);
    recordClear(1);
    expect(isStageUnlocked(2)).toBe(true); // reads storage by default
  });
});

describe('isStagePlayable', () => {
  it('ready stages always; a draft only in DEV and only with a non-empty round; a missing stage never', () => {
    expect(isStagePlayable(1, false)).toBe(true);
    expect(isStagePlayable(3, false)).toBe(false);
    expect(isStagePlayable(3, true)).toBe(true);
    expect(isStagePlayable(4, true)).toBe(false);
    expect(isStagePlayable(7, true)).toBe(false);
  });
});

describe('stageSlotState', () => {
  it('reads available / cleared / locked / soon for a player build', () => {
    const opts = { dev: false, cleared: [1] };
    expect(stageSlotState(1, opts)).toBe('cleared');
    expect(stageSlotState(2, opts)).toBe('available');
    expect(stageSlotState(3, opts)).toBe('soon'); // a draft is "Coming soon" to players
    expect(stageSlotState(4, opts)).toBe('soon');
    expect(stageSlotState(9, opts)).toBe('soon'); // no file
    expect(stageSlotState(2, { dev: false, cleared: [] })).toBe('locked');
  });

  it('in DEV an unlocked draft with content is "draft"; locked still reads locked; an empty draft stays soon', () => {
    expect(stageSlotState(3, { dev: true, cleared: [1, 2] })).toBe('draft');
    expect(stageSlotState(3, { dev: true, cleared: [1, 2, 3] })).toBe('draft');
    expect(stageSlotState(3, { dev: true, cleared: [1] })).toBe('locked');
    expect(stageSlotState(4, { dev: true, cleared: [1, 2, 3] })).toBe('soon');
  });
});
