import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { RunState } from '@game/sim';
import { runeTally } from './runeTally';

/** Set 3 rune design pass, tranche 5 (owner 2026-09-27): Rune of Unity's badge prints the types the board controls now. */
const byTribe = (t: string) => Object.values(CARD_INDEX).find((d) => d && !d.spell && !d.token && !d.universalTribe && d.tribe === t && !d.tribe2)!;
const card = (t: string, i: number) => { const d = byTribe(t); return { uid: `u${i}`, cardId: d.id, tribe: d.tribe, attack: 1, health: 1, keywords: [], golden: false }; };

describe('Rune of Unity badge', () => {
  it('counts the naturally controlled types out of the active five', () => {
    const tribes = ['kobold', 'dwarf', 'undead', 'spirit', 'celestial'];
    const run = { questFlags: { runeUnity: true }, tribes, board: tribes.slice(0, 3).map(card) } as unknown as RunState;
    expect(runeTally(run, 'rune_unity')).toBe('3/5 types');
    expect(runeTally({ ...run, board: tribes.map(card) } as RunState, 'rune_unity')).toBe('5/5 types');
  });
});
