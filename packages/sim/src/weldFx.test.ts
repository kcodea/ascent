import { describe, it, expect } from 'vitest';
import { createRun, type RunState } from './state';
import { reduce } from './reducer';
import { projectEndOfTurnSteps, weldMagnetic } from './recruit';

/**
 * Weld FX signal — every minion an Attachment lands on must be reported, so the UI can converge a ring on
 * each. A **Beatbot** mirrors every weld onto itself, so one weld can touch several minions.
 */
const mk = (uid: string, cardId: string, tribe: RunState['board'][number]['tribe'], attack = 2, health = 3, keywords: RunState['board'][number]['keywords'] = []): RunState['board'][number] =>
  ({ uid, cardId, tribe, attack, health, keywords: [...keywords], golden: false });

const payload = { source: 'Cling Drone', attack: 1, health: 1, keywords: [], mana: 0 };

describe('weld FX signal', () => {
  it('reports the host', () => {
    const s: RunState = { ...createRun(1, 'warden'), phase: 'recruit', board: [mk('h', 'drone', 'mech')] };
    weldMagnetic(s, s.board[0]!, payload, 0, 'play');
    expect(s.weldFxUids).toEqual(['h']);
    expect(s.weldFxKind).toBe('play');
    expect(s.weldFxSeq).toBe(1);
  });

  it('reports the host AND every Beatbot that mirrors the weld', () => {
    const s: RunState = { ...createRun(1, 'warden'), phase: 'recruit',
      board: [mk('h', 'drone', 'mech'), mk('bb1', 'beatboxer', 'mech'), mk('bb2', 'beatboxer', 'mech')] };
    weldMagnetic(s, s.board[0]!, payload, 0, 'auto');
    expect(s.weldFxUids?.slice().sort()).toEqual(['bb1', 'bb2', 'h']);
    for (const uid of s.weldFxUids!) {
      expect(s.board.find((c) => c.uid === uid)?.attachments ?? 0).toBeGreaterThan(0);
    }
  });

  it('a weld ONTO a Beatbot reports it once (no self-double)', () => {
    const s: RunState = { ...createRun(1, 'warden'), phase: 'recruit', board: [mk('bb', 'beatboxer', 'mech')] };
    weldMagnetic(s, s.board[0]!, payload, 0, 'play');
    expect(s.weldFxUids).toEqual(['bb']);
  });

  it('a hand-played Magnetic stamps kind=play through the reducer', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10,
      board: [mk('h', 'drone', 'mech')], hand: [mk('m', 'cling', 'mech', 1, 1, ['M'])] };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 });
    expect(s.weldFxKind).toBe('play');
    expect(s.weldFxUids).toContain('h');
  });

  it('EoT auto-welds surface on their beat via the projection (Cling Drones)', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['attachClingDrones'],
      board: [mk('m1', 'drone', 'mech'), mk('m2', 'drone', 'mech')] };
    const { fx } = projectEndOfTurnSteps(s);
    const welded = fx.flatMap((f) => f.welds);
    expect(welded).toContain('m1');
    expect(welded).toContain('m2');
  });
});

describe('weld FX signal — multiple welds in ONE action', () => {
  it('accumulates every welded uid instead of overwriting', () => {
    // The bug: `stampWeldFx` replaced `weldFxUids`, and the UI only reads the FINAL state after a dispatch.
    // A golden Banksly (two magnetizes) or a big Gold spend therefore animated only the LAST weld.
    const s: RunState = { ...createRun(1, 'warden'), phase: 'recruit',
      board: [mk('A', 'drone', 'mech'), mk('B', 'drone', 'mech')] };
    weldMagnetic(s, s.board[0]!, payload, 0, 'auto');
    weldMagnetic(s, s.board[1]!, payload, 0, 'auto');
    expect(s.weldFxUids?.slice().sort()).toEqual(['A', 'B']);
    expect(s.weldFxSeq).toBe(2);
  });

  it('does not leak across actions — reduce() clears the scratch', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10,
      board: [mk('h', 'drone', 'mech')], hand: [mk('m', 'cling', 'mech', 1, 1, ['M'])] };
    s = reduce(s, { type: 'play', uid: 'm', toIndex: 0 });
    expect(s.weldFxUids).toContain('h');
    s = reduce(s, { type: 'roll' }); // an unrelated action must not re-fire the weld
    expect(s.weldFxUids ?? []).toEqual([]);
  });
});
