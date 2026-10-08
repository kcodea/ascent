import { describe, it, expect } from 'vitest';
import { RUNE_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';

/**
 * `devOpenRuneforge` backs the Scene Builder's "Enter Runeforge" / "Enter Epic Runeforge" buttons (owner ask
 * 2026-10-07): open a REAL forge on the current turn through the run's own openers, so the forge look can be
 * iterated on without playing to its turn.
 */
const base = (): RunState => ({ ...createRun(1, 'warden'), phase: 'recruit', hand: [], board: [] });

describe('devOpenRuneforge', () => {
  it('opens a Basic forge of basic runes', () => {
    const s = reduce(base(), { type: 'devOpenRuneforge', epic: false });
    expect(s.runeforgeOffer?.length).toBeGreaterThan(0);
    expect(s.runeforgeEpic).toBeFalsy();
    expect(s.runeforgeOffer!.every((id) => !RUNE_INDEX[id]!.epic)).toBe(true);
  });

  it('opens an Epic forge of epic runes', () => {
    const s = reduce(base(), { type: 'devOpenRuneforge', epic: true });
    expect(s.runeforgeOffer?.length).toBeGreaterThan(0);
    expect(s.runeforgeEpic).toBe(true);
    expect(s.runeforgeOffer!.every((id) => !!RUNE_INDEX[id]!.epic)).toBe(true);
  });

  it('is refused while a modal is already open', () => {
    const open = reduce(base(), { type: 'devOpenRuneforge', epic: false });
    expect(reduce(open, { type: 'devOpenRuneforge', epic: true })).toBe(open);
  });
});
