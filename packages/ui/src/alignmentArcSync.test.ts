import { describe, it, expect } from 'vitest';
import { syncArcs, type ArcEntry, type ArcMarker, type ArcOps } from './alignmentArcSync';

/**
 * The handoff's test list, against the pure reconciler. A fake node records every call, so "reused rather
 * than recreated" and "redrawn only on a width change" are checked as OBSERVED BEHAVIOUR rather than
 * inferred from the code.
 */
interface Fake {
  id: string;
  redraws: number[];
  places: ArcMarker[];
  destroyed: boolean;
}

function harness() {
  const created: Fake[] = [];
  const entries = new Map<string, ArcEntry<Fake>>();
  const ops: ArcOps<Fake> = {
    create: (id) => {
      const f: Fake = { id, redraws: [], places: [], destroyed: false };
      created.push(f);
      return f;
    },
    destroy: (_id, node) => { node.destroyed = true; },
    redraw: (node, width) => { node.redraws.push(width); },
    place: (node, marker) => { node.places.push({ ...marker }); },
  };
  return { entries, ops, created };
}

const marker = (id: string, over: Partial<ArcMarker> = {}): ArcMarker =>
  ({ id, x: 10, y: 20, width: 100, color: 0xffaa00, ...over });

describe('alignment arc reconciler', () => {
  it('creates a node for each new marker', () => {
    const { entries, ops, created } = harness();
    const r = syncArcs(entries, [marker('a'), marker('b')], ops);
    expect(r.created).toBe(2);
    expect(created.map((f) => f.id)).toEqual(['a', 'b']);
    expect(entries.size).toBe(2);
  });

  it('REUSES existing nodes across syncs — never recreates them', () => {
    const { entries, ops, created } = harness();
    syncArcs(entries, [marker('a')], ops);
    const first = created[0]!;
    for (let i = 0; i < 5; i++) syncArcs(entries, [marker('a', { x: i })], ops);
    expect(created.length, 'one node ever created').toBe(1);
    expect(entries.get('a')!.node).toBe(first);
    expect(first.places.length, 'but repositioned each time').toBe(6);
  });

  it('destroys the node of a marker that disappears', () => {
    const { entries, ops, created } = harness();
    syncArcs(entries, [marker('a'), marker('b')], ops);
    const r = syncArcs(entries, [marker('a')], ops);
    expect(r.destroyed).toBe(1);
    expect(created.find((f) => f.id === 'b')!.destroyed).toBe(true);
    expect(entries.has('b')).toBe(false);
    expect(created.find((f) => f.id === 'a')!.destroyed, 'the survivor is untouched').toBe(false);
  });

  it('redraws geometry ONLY when the width changes', () => {
    const { entries, ops, created } = harness();
    syncArcs(entries, [marker('a', { width: 100 })], ops);
    const node = created[0]!;
    expect(node.redraws, 'first sync must draw once').toEqual([100]);
    // Same width, moved and re-tinted: no redraw.
    syncArcs(entries, [marker('a', { width: 100, x: 99, color: 0x00ff00 })], ops);
    expect(node.redraws).toEqual([100]);
    // Width actually changed: exactly one more redraw.
    syncArcs(entries, [marker('a', { width: 140 })], ops);
    expect(node.redraws).toEqual([100, 140]);
  });

  it('updates tint and emphasis in place, without replacing the node', () => {
    const { entries, ops, created } = harness();
    syncArcs(entries, [marker('a', { color: 0xff0000 })], ops);
    syncArcs(entries, [marker('a', { color: 0x0000ff, emphasized: true })], ops);
    expect(created.length).toBe(1);
    const last = created[0]!.places.at(-1)!;
    expect(last.color).toBe(0x0000ff);
    expect(last.emphasized).toBe(true);
  });

  it('an empty marker list tears everything down', () => {
    const { entries, ops, created } = harness();
    syncArcs(entries, [marker('a'), marker('b'), marker('c')], ops);
    const r = syncArcs(entries, [], ops);
    expect(r.destroyed).toBe(3);
    expect(entries.size).toBe(0);
    expect(created.every((f) => f.destroyed)).toBe(true);
  });

  it('reports a no-op sync, so the caller can skip waking the renderer', () => {
    // The under-canvas ticker idles; every wake costs a presented frame. A sync that created, destroyed and
    // redrew nothing only re-placed existing nodes at identical values, which needs no new frame.
    const { entries, ops } = harness();
    syncArcs(entries, [marker('a')], ops);
    const r = syncArcs(entries, [marker('a')], ops);
    expect([r.created, r.destroyed, r.redrawn]).toEqual([0, 0, 0]);
  });

  it('keys by card uid, so a REORDER moves nodes rather than rebuilding them', () => {
    // The board reordering is the common case during a drag; rebuilding here would churn GPU objects on
    // every candidate-gap change.
    const { entries, ops, created } = harness();
    syncArcs(entries, [marker('a', { x: 0 }), marker('b', { x: 100 })], ops);
    syncArcs(entries, [marker('b', { x: 0 }), marker('a', { x: 100 })], ops);
    expect(created.length).toBe(2);
    expect(created.find((f) => f.id === 'a')!.places.at(-1)!.x).toBe(100);
    expect(created.find((f) => f.id === 'b')!.places.at(-1)!.x).toBe(0);
  });
});
