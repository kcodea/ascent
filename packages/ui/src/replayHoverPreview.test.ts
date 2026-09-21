// @vitest-environment jsdom
/**
 * CARD HOVER PREVIEWS DURING A REPLAY (owner report 2026-09-20): while a replay played, hovering a shop / board /
 * hand card never opened the related-card + keyword-pill popup it opens live. The cause: a replayed GHOST drag
 * (the recorded player's card in flight) sets the same `drag.active` slice a live drag does, and every `Card`
 * read that slice as "the viewer is dragging" — which both disables its hover and force-hides an open popup.
 * With recorded drags every few seconds, previews never survived.
 *
 * The rows now hand `Card` a `viewerDrag` flag — active AND not a ghost — so only the viewer's own drag
 * suppresses hover. Pinned here on the three row selectors (the exact values the rows read).
 */
import { describe, expect, it } from 'vitest';
import type { CardView } from './Card';
import { NO_DRAG_DECISION } from './dragDecision';
import type { DragSnapshot, DragState } from './dragStore';
import { selectHandDrag, selectTavernDrag, selectWarbandDrag } from './Recruit';

const view: CardView = { name: 'Imp', cardId: 'imp', tribe: 'demon', attack: 1, health: 1, keywords: [], text: '', tier: 1, baseAttack: 1, baseHealth: 1 };
const drag = (over: Partial<DragState>): DragState => ({
  uid: 'u1', source: 'shop', view, ox: 0, oy: 0, grabOx: 0, grabOy: 0, w: 0, h: 0, startX: 0, startY: 0, x: 0, y: 0, active: true, ...over,
});
const snap = (d: DragState | null): DragSnapshot => ({
  drag: d, overZone: null, decision: NO_DRAG_DECISION, castingSpell: false, snapping: false, magSlide: false,
  magTargetUid: null, sellTop: 0, buyTop: 0, handSlotW: 0, aimTargetUid: null,
} as DragSnapshot);

describe('the rows\' drag slices — `viewerDrag` is what gates a card\'s hover preview', () => {
  it('a LIVE drag (the viewer holding a card) suppresses hover; the rows still dim the source', () => {
    for (const sel of [selectTavernDrag, selectWarbandDrag, selectHandDrag]) {
      const s = sel(snap(drag({})));
      expect(s.dragActive).toBe(true);
      expect(s.viewerDrag).toBe(true);
      expect(s.dragUid).toBe('u1');
    }
  });

  it('a replayed GHOST drag keeps the row choreography (active, source dimmed) but is NOT the viewer\'s hand — hover previews stay live', () => {
    for (const sel of [selectTavernDrag, selectWarbandDrag, selectHandDrag]) {
      const s = sel(snap(drag({ ghost: true })));
      expect(s.dragActive, 'the rows still lift the recorded card').toBe(true);
      expect(s.viewerDrag, 'but the viewer is not dragging').toBe(false);
    }
  });

  it('no drag / a press under the threshold → neither', () => {
    for (const sel of [selectTavernDrag, selectWarbandDrag, selectHandDrag]) {
      expect(sel(snap(null))).toMatchObject({ dragActive: false, viewerDrag: false });
      expect(sel(snap(drag({ active: false })))).toMatchObject({ dragActive: false, viewerDrag: false });
    }
  });
});
