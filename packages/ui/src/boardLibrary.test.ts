// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createRun, reduce, snapshotBoard, type BoardSnapshot } from '@game/sim';
import { loadStoredBoards, saveCapturedBoards } from './boardLibrary';

/**
 * EVERY ROUND IS UPLOADED, AN EMPTY BOARD INCLUDED (owner 2026-10-17, R-LOBBY-08: "empty boards are never uploaded is a
 * problem. this has to be fixed"). `saveCapturedBoards` is what feeds `uploadBoards` at run end: it used to drop every
 * board with no minions, so a recorded Disco Dan (turn 1 is a pure Setlist, nothing on board) started at wave 2 and a
 * lobby seat served his wave-2 board, at Shop tier 2, in round 1.
 */

/** Disco Dan's real turn 1: the three Setlist Discovers, then end the turn. */
function discoTurnOne(seed: number): BoardSnapshot {
  let s = createRun(seed, 'discodan', 'lobby');
  for (let i = 0; i < 3 && s.discover; i++) s = reduce(s, { type: 'discover', index: 0 });
  s = reduce(s, { type: 'faceOmen' });
  return snapshotBoard(s);
}

beforeEach(() => { localStorage.clear(); });

describe('the captured-board library keeps empty rounds', () => {
  it("Disco Dan's empty wave-1 board is saved and handed to the upload, with its tier", () => {
    const wave1 = discoTurnOne(31337);
    expect(wave1.minions).toEqual([]);
    const fresh = saveCapturedBoards([wave1], 'set2', 'Orangez');
    expect(fresh).toHaveLength(1); // this is the array `uploadBoards` receives
    expect(fresh[0]!).toMatchObject({ wave: 1, tier: 1, heroId: 'discodan', author: 'Orangez', setId: 'set2', minions: [] });
    expect(typeof fresh[0]!.id).toBe('string'); // a fight-ledger id like every other round
    expect(loadStoredBoards().map((b) => b.wave)).toEqual([1]);
  });

  it("two runs' empty round-1 boards on the same hero are two rounds, not one deduplicated board", () => {
    saveCapturedBoards([discoTurnOne(1)], 'set2', 'Orangez');
    saveCapturedBoards([discoTurnOne(2)], 'set2', 'Orangez');
    expect(loadStoredBoards().map((b) => b.seed)).toEqual([1, 2]);
  });
});
