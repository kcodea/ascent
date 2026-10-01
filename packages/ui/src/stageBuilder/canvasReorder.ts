/**
 * DRAG-TO-REORDER math for the Stage Board canvas (owner ask 2026-09-29: "i want to be able to drag to reorder").
 * Pure, so the index rules are unit-tested without a layout engine. Rects are the RESTING slot boxes, measured ONCE
 * per drag in screen space; the pointer x is screen space too (no stage conversion needed for comparisons).
 *
 * Same rule as the warband's reorder (`reorderIndexFromSlots` in Recruit.tsx): the insertion index measures against
 * each neighbour's CURRENT, already-slid position — with the gap at `gap`, the p-th non-dragged unit sits in slot
 * (p < gap ? p : p + 1) — so opening and closing a gap trigger symmetrically instead of needing half a card out but
 * only a sliver back.
 */
export interface SlotRect { left: number; width: number }

/** Movement (screen px) before a press becomes a drag — below it, a click / double-click stays a click. */
export const DRAG_THRESHOLD = 6;

/**
 * Where the dragged unit (resting index `from`) would land for a pointer at screen `x`: its index in the board
 * AFTER the move (i.e. `moveMinion`'s `to`). `gap` is the current insertion index (pass `from` at drag start).
 */
export function reorderIndexAt(slots: readonly SlotRect[], x: number, from: number, gap: number): number {
  const g = gap >= 0 ? gap : from;
  let p = 0;
  let count = 0;
  for (let i = 0; i < slots.length; i++) {
    if (i === from) continue;
    const slot = slots[p < g ? p : p + 1] ?? slots[i]!;
    if (x > slot.left + slot.width / 2) count++;
    p++;
  }
  return count;
}

/** How many slots unit `i` slides (±1 or 0) to open the drop gap at `gap` while unit `from` is dragged. */
export function slideSlots(i: number, from: number, gap: number): number {
  if (i === from) return 0;
  const p = i < from ? i : i - 1;
  return (p < gap ? p : p + 1) - i;
}

/** The distance between two neighbouring slots (screen px): the slide step. One unit → its own width. */
export function slotPitch(slots: readonly SlotRect[]): number {
  if (slots.length >= 2) return slots[1]!.left - slots[0]!.left;
  return slots[0]?.width ?? 0;
}
