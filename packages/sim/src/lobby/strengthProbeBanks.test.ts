import { describe, expect, it, vi } from 'vitest';

vi.mock('../boardSide', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../boardSide')>();
  return { ...mod, sideFromSnapshot: vi.fn(mod.sideFromSnapshot) };
});

import { sideFromSnapshot } from '../boardSide';
import { createStrengthProbe, loadStrengthReference } from './boardStrength';
import type { BoardSnapshot } from '../snapshot';

/**
 * A CARRIED score rates the final board as a table really meets it on a later round: a board served past its own
 * round has already spent its next-combat banks (`snapshotBanksLive`), so the probe builds its side for THAT round.
 * Scored at its own round, the banks are live, as before. The wave the board carries is never rewritten.
 */
describe('the strength probe builds a carried board\'s side for the round it is carried to', () => {
  it('passes the carried round as the fight round; its own round passes none', async () => {
    const ref = await loadStrengthReference();
    const board = { ...ref.waves['7']![5]!, wave: 7, setId: ref.setId } as BoardSnapshot;
    const calls = vi.mocked(sideFromSnapshot).mock.calls;

    calls.length = 0;
    createStrengthProbe(board, ref, 12);
    expect(calls[0]![0]).toBe(board); // the board itself, wave 7: not a copy relabelled as round 12
    expect(calls[0]![3]).toBe(12);

    calls.length = 0;
    createStrengthProbe(board, ref);
    expect(calls[0]![3]).toBeUndefined();

    calls.length = 0;
    createStrengthProbe(board, ref, 7);
    expect(calls[0]![3]).toBeUndefined();
  });
});
