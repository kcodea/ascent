import { describe, expect, it } from 'vitest';
import { driveLayerHeads, resolveAnchor, type FxAnchors, type FxHeadSink } from './anchors';
import { FX_ANCHOR_PARTS, withUnitParts, type UnitElementLike } from './anchorParts';
import { coerceDef } from './defStore';
import { setLayerAnchorPart, toDef, type EditorLayer } from './ui/layerModel';
import { ANCHOR_PART_COPY } from './ui/copy';
import './primitives';

const anchors: FxAnchors = {
  source: { x: 100, y: 100 },
  target: { x: 500, y: 100 },
  parts: {
    source: { 'badge.attack': { x: 80, y: 140 }, top: { x: 100, y: 60 } },
    target: { 'badge.attack': { x: 480, y: 140 } },
  },
};

describe('resolveAnchor with a part', () => {
  it('lands on the resolved part; `card` / null / an unresolved part keep the centre', () => {
    expect(resolveAnchor(anchors, 'source', 0, undefined, 'badge.attack')).toEqual({ x: 80, y: 140 });
    expect(resolveAnchor(anchors, 'source', 0, undefined, 'top')).toEqual({ x: 100, y: 60 });
    expect(resolveAnchor(anchors, 'source', 0, undefined, 'card')).toEqual({ x: 100, y: 100 });
    expect(resolveAnchor(anchors, 'source', 0)).toEqual({ x: 100, y: 100 });
    expect(resolveAnchor(anchors, 'target', 0, undefined, 'medallion')).toEqual({ x: 500, y: 100 }); // never resolved → centre
  });
  it('travel runs part-to-part when both ends resolved the part', () => {
    expect(resolveAnchor(anchors, 'travel', 0, 0, 'badge.attack')).toEqual({ x: 80, y: 140 });
    expect(resolveAnchor(anchors, 'travel', 1, 0, 'badge.attack')).toEqual({ x: 480, y: 140 });
  });
  it('non-unit anchors ignore the part', () => {
    expect(resolveAnchor({ ...anchors, camera: { x: 1, y: 2 } }, 'camera', 0, undefined, 'top')).toEqual({ x: 1, y: 2 });
  });
});

describe('driveLayerHeads with parts', () => {
  it('feeds each layer its own part and aims part-to-part', () => {
    const heads: number[][] = [];
    const aims: number[][] = [];
    const sink: FxHeadSink = { setHead: (i, x, y) => { heads[i] = [x, y]; }, setAim: (i, sx, sy, tx, ty) => { aims[i] = [sx, sy, tx, ty]; } };
    driveLayerHeads(sink, [{ anchor: 'source', anchorPart: 'badge.attack' }, { anchor: 'source' }, { anchor: 'target', anchorPart: 'top' }], anchors, 0);
    expect(heads[0]).toEqual([80, 140]);
    expect(heads[1]).toEqual([100, 100]);
    expect(heads[2]).toEqual([500, 100]); // target has no `top` resolved → centre
    expect(aims[0]).toEqual([80, 140, 480, 140]);
    expect(aims[1]).toEqual([100, 100, 500, 100]);
  });
});

describe('withUnitParts', () => {
  const unit = (rect: { left: number; top: number; width: number; height: number }): UnitElementLike => ({
    getBoundingClientRect: () => rect,
    querySelector: () => null,
  });
  it('is a no-op with no parts or no uids, and decorates only the ends it can find', () => {
    const base: FxAnchors = { source: { x: 1, y: 1 }, target: { x: 2, y: 2 } };
    expect(withUnitParts(base, { source: 'a', target: 'b' }, [], () => unit({ left: 0, top: 0, width: 10, height: 10 }))).toBe(base);
    expect(withUnitParts(base, undefined, ['top'], () => null)).toBe(base);
    const out = withUnitParts(base, { source: 'a', target: 'missing' }, ['top'], (uid) => (uid === 'a' ? unit({ left: 0, top: 0, width: 10, height: 10 }) : null));
    expect(out.parts?.source?.top).toEqual({ x: 5, y: 0 });
    expect(out.parts?.target).toBeUndefined();
  });
});

describe('def round-trip', () => {
  it('coerceDef keeps a real part and drops `card` / junk as an omission', () => {
    const raw = { id: 'x', duration: 100, layers: [
      { primitive: 'burst', anchor: 'source', at: 0, params: {}, anchorPart: 'medallion' },
      { primitive: 'burst', anchor: 'source', at: 0, params: {}, anchorPart: 'card' },
      { primitive: 'burst', anchor: 'source', at: 0, params: {}, anchorPart: 'gem' },
    ] };
    const def = coerceDef(raw)!;
    expect(def.layers[0].anchorPart).toBe('medallion');
    expect('anchorPart' in def.layers[1]).toBe(false);
    expect('anchorPart' in def.layers[2]).toBe(false);
  });
  it('setLayerAnchorPart stores a part, omits `card`, and toDef serialises only real parts', () => {
    const base: EditorLayer = { primitive: 'burst', anchor: 'source', at: 0, life: null, params: {} };
    const withPart = setLayerAnchorPart([base], 0, 'badge.health');
    expect(withPart[0].anchorPart).toBe('badge.health');
    const back = setLayerAnchorPart(withPart, 0, 'card');
    expect('anchorPart' in back[0]).toBe(false);
    expect(toDef('x', 100, withPart).layers[0].anchorPart).toBe('badge.health');
    expect('anchorPart' in toDef('x', 100, back).layers[0]).toBe(false);
  });
});

describe('ANCHOR_PART_COPY', () => {
  it('covers every part and nothing else', () => {
    expect(Object.keys(ANCHOR_PART_COPY).sort()).toEqual([...FX_ANCHOR_PARTS].sort());
    for (const p of FX_ANCHOR_PARTS) {
      expect(ANCHOR_PART_COPY[p].label.trim()).not.toBe('');
      expect(ANCHOR_PART_COPY[p].blurb.length).toBeGreaterThan(20);
    }
  });
});
