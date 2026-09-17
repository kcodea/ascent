import { beforeEach, describe, expect, it } from 'vitest';
import { dragStore, shallowEqual, type DragState } from './dragStore';
import { NO_DRAG_DECISION } from './dragDecision';

/**
 * The transient pointer store (perf 2026-09-17). What these pin: a write that changes nothing notifies
 * nobody (the second guard behind the move flush's decision gate); a write that changes something notifies
 * once and replaces the snapshot; `endDrag` returns every drag field to idle but leaves the hero-aim target —
 * a different gesture — alone; and `pos` is the one field that is mutable and silent by design.
 */
const view = { name: 'x', cardId: 'x', tribe: 'neutral', attack: 1, health: 1, keywords: [] } as unknown as DragState['view'];
const drag = (over: Partial<DragState> = {}): DragState => ({
  uid: 'b1', source: 'board', view, ox: 50, oy: 70, grabOx: 50, grabOy: 70, w: 100, h: 140,
  startX: 10, startY: 10, x: 10, y: 10, active: false, ...over,
});

beforeEach(() => dragStore.reset());

describe('dragStore', () => {
  it('a no-op write notifies nobody; a real write notifies once and replaces the snapshot', () => {
    let n = 0;
    const off = dragStore.subscribe(() => { n++; });
    const before = dragStore.get();
    dragStore.set({ overZone: null, snapping: false }); // already the case
    expect(n).toBe(0);
    expect(dragStore.get()).toBe(before);
    dragStore.set({ drag: drag(), overZone: 'warband' });
    expect(n).toBe(1);
    expect(dragStore.get()).not.toBe(before);
    expect(dragStore.get().drag?.uid).toBe('b1');
    expect(dragStore.get().overZone).toBe('warband');
    off();
    dragStore.set({ overZone: 'hand' });
    expect(n).toBe(1);
  });

  it('endDrag returns the drag fields to idle, keeps the aim target, and drops the live position', () => {
    dragStore.set({ drag: drag({ active: true }), overZone: 'hand', decision: { ...NO_DRAG_DECISION, gapIndex: 2 }, castingSpell: true, snapping: true, magSlide: true, aimTargetUid: 'b3' });
    dragStore.pos = { x: 1, y: 2 };
    dragStore.endDrag();
    const s = dragStore.get();
    expect(s.drag).toBeNull();
    expect(s.overZone).toBeNull();
    expect(s.decision).toBe(NO_DRAG_DECISION);
    expect(s.castingSpell).toBe(false);
    expect(s.snapping).toBe(false);
    expect(s.magSlide).toBe(false);
    expect(s.aimTargetUid).toBe('b3');
    expect(dragStore.pos).toBeNull();
  });

  it('pos is mutable and silent — the per-frame visuals read it, React never does', () => {
    let n = 0;
    dragStore.subscribe(() => { n++; });
    dragStore.pos = { x: 5, y: 5 };
    dragStore.pos = { x: 6, y: 6 };
    expect(n).toBe(0);
  });

  it('shallowEqual — the slice comparator — compares own keys by Object.is', () => {
    expect(shallowEqual({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual(1, 1)).toBe(true);
    expect(shallowEqual(null, {})).toBe(false);
  });
});
