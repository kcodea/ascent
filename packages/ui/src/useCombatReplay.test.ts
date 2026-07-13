import { describe, it, expect } from 'vitest';
import type { CombatEvent, MinionSnapshot } from '@game/core';
import { computeFrame } from './useCombatReplay';

const snap = (over: Partial<MinionSnapshot> & { uid: string; cardId: string }): MinionSnapshot => ({
  name: over.cardId, tribe: 'dragon', attack: 1, health: 1, keywords: [], golden: false, ...over,
});
const NAMES = new Map<string, string>();
const fold = (initial: { player: MinionSnapshot[]; enemy: MinionSnapshot[] }, events: CombatEvent[]) =>
  computeFrame(initial, events, events.length, 0, NAMES);

describe('computeFrame — ascend fold (live mid-combat transform)', () => {
  it('adopts the new form identity + keywords when an `ascend` event folds (player side)', () => {
    const initial = { player: [snap({ uid: 'p', cardId: 'tara', name: 'Tara', keywords: ['EG'] })], enemy: [] };
    // A stat buff lands on the same uid, then Tara ascends into Taragosa.
    const { player } = fold(initial, [
      { type: 'buff', target: 'p', attack: 2, health: 2, source: 'p' },
      { type: 'ascend', target: 'p', into: 'taragosa' },
    ] as CombatEvent[]);
    expect(player[0]!.cardId).toBe('taragosa'); // identity swapped live (not stuck at 'tara')
    expect(player[0]!.name).toBe('Taragosa');
    expect(player[0]!.attack).toBe(3); // the buff still landed on the same uid
    expect(player[0]!.keywords).toContain('EG'); // Taragosa's Engraved carries
  });

  it('folds an ascend on the ENEMY side too (true-PvP symmetry)', () => {
    const initial = { player: [], enemy: [snap({ uid: 'e', cardId: 'tara', name: 'Tara', keywords: ['EG'] })] };
    const { enemy } = fold(initial, [{ type: 'ascend', target: 'e', into: 'taragosa' }] as CombatEvent[]);
    expect(enemy[0]!.cardId).toBe('taragosa');
    expect(enemy[0]!.name).toBe('Taragosa');
  });
});
