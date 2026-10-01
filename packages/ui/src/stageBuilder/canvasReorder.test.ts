/**
 * The Stage Board canvas's drag-to-reorder math (owner ask 2026-09-29). Four resting slots, 100 px apart, 90 px wide
 * (midpoints 45 / 145 / 245 / 345). Pins: the insertion index for a pointer x, measured against the neighbours'
 * CURRENT slid positions (so the swap back triggers at the same spot as the swap out), the per-unit slide, and the
 * slide step.
 */
import { describe, expect, it } from 'vitest';
import { moveMinion } from './stageDraft';
import { reorderIndexAt, slideSlots, slotPitch, type SlotRect } from './canvasReorder';
import type { GauntletStage } from '@game/content';

const slots: SlotRect[] = [0, 100, 200, 300].map((left) => ({ left, width: 90 }));

describe('reorderIndexAt', () => {
  it('stays put while the pointer is still over its own slot', () => {
    expect(reorderIndexAt(slots, 45, 0, 0)).toBe(0);
    expect(reorderIndexAt(slots, 250, 2, 2)).toBe(2);
  });

  it('moves right once the pointer passes the next unit’s midpoint, and on to the end', () => {
    expect(reorderIndexAt(slots, 140, 0, 0)).toBe(0);
    expect(reorderIndexAt(slots, 150, 0, 0)).toBe(1);
    expect(reorderIndexAt(slots, 350, 0, 1)).toBe(3);
    expect(reorderIndexAt(slots, 5000, 0, 0)).toBe(3);
  });

  it('moves left past a neighbour’s midpoint, down to the front', () => {
    expect(reorderIndexAt(slots, 250, 3, 3)).toBe(3);
    expect(reorderIndexAt(slots, 240, 3, 3)).toBe(2);
    expect(reorderIndexAt(slots, -50, 3, 3)).toBe(0);
  });

  it('is symmetric: with the gap open at 1, the slid-left unit is measured at slot 0, not its resting slot', () => {
    // Unit 1 has slid into slot 0 (midpoint 45) to make room: going back over 45 swaps back, not over 145.
    expect(reorderIndexAt(slots, 100, 0, 1)).toBe(1);
    expect(reorderIndexAt(slots, 40, 0, 1)).toBe(0);
  });

  it('a single unit can only stay at 0', () => {
    expect(reorderIndexAt(slots.slice(0, 1), 900, 0, 0)).toBe(0);
  });
});

describe('slideSlots', () => {
  it('opens the gap: units between the old and new spot slide one slot toward the old one', () => {
    // Dragging 0 to 2: units 1 and 2 slide left one slot, 3 stays.
    expect([0, 1, 2, 3].map((i) => slideSlots(i, 0, 2))).toEqual([0, -1, -1, 0]);
    // Dragging 3 to 1: units 1 and 2 slide right, 0 stays.
    expect([0, 1, 2, 3].map((i) => slideSlots(i, 3, 1))).toEqual([0, 1, 1, 0]);
    // No move: nothing slides.
    expect([0, 1, 2, 3].map((i) => slideSlots(i, 2, 2))).toEqual([0, 0, 0, 0]);
  });

  it('the slid layout is exactly the order moveMinion commits', () => {
    const stage = {
      rounds: [{ board: ['a', 'b', 'c', 'd'].map((cardId) => ({ cardId, attack: 1, health: 1, cardVersion: 'x' })) }],
    } as unknown as GauntletStage;
    for (const [from, gap] of [[0, 2], [3, 1], [1, 3], [2, 0]] as const) {
      const shown: string[] = [];
      ['a', 'b', 'c', 'd'].forEach((id, i) => { shown[i === from ? gap : i + slideSlots(i, from, gap)] = id; });
      expect(moveMinion(stage, 1, from, gap).rounds[0]!.board.map((m) => m.cardId)).toEqual(shown);
    }
  });
});

describe('slotPitch', () => {
  it('is the neighbour spacing, or a lone unit’s width', () => {
    expect(slotPitch(slots)).toBe(100);
    expect(slotPitch(slots.slice(0, 1))).toBe(90);
    expect(slotPitch([])).toBe(0);
  });
});
