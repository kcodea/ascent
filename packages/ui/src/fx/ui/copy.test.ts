import { describe, expect, it } from 'vitest';
import { FX_ANCHOR_IDS } from '../anchors';
// Side-effect import: every built-in primitive self-registers at load, which is what lets `listPrimitives()`
// below see them at all.
import '../primitives';
import { listPrimitives } from '../registry';
import {
  ANCHOR_COPY,
  ANCHOR_OPTIONS,
  anchorBlurb,
  anchorLabel,
  PRIMITIVE_COPY,
  primitiveBlurb,
  primitiveLabel,
} from './copy';

/**
 * The copy lives in the UI layer rather than on `FxPrimitive`, which buys a clean engine contract and costs
 * the risk of drift: add a primitive or an anchor id and nothing in the type system notices that its label
 * is missing. These are the tests that notice. They walk the REGISTRY and `FX_ANCHOR_IDS` — not a hardcoded
 * list — so anything added later is covered the moment it lands.
 */
describe('PRIMITIVE_COPY', () => {
  it('covers every registered primitive', () => {
    const missing = listPrimitives()
      .map((p) => p.id)
      .filter((id) => PRIMITIVE_COPY[id] === undefined);
    expect(missing, `primitives with no label/blurb: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no entry for a primitive that does not exist', () => {
    const registered = new Set(listPrimitives().map((p) => p.id));
    const orphans = Object.keys(PRIMITIVE_COPY).filter((id) => !registered.has(id));
    expect(orphans, `copy for unregistered primitives: ${orphans.join(', ')}`).toEqual([]);
  });

  it('every entry has a real label and a real blurb', () => {
    Object.entries(PRIMITIVE_COPY).forEach(([id, copy]) => {
      expect(copy.label.trim(), `${id}.label`).not.toBe('');
      expect(copy.blurb.trim(), `${id}.blurb`).not.toBe('');
      // A blurb that just restates the label teaches nothing — the whole point is to say what it DOES.
      expect(copy.blurb.length, `${id}.blurb is too short to explain anything`).toBeGreaterThan(20);
    });
  });

  // The row of buttons is read left to right; two primitives sharing a label makes it unusable.
  it('labels are unique', () => {
    const labels = Object.values(PRIMITIVE_COPY).map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('ANCHOR_COPY', () => {
  it('covers exactly FX_ANCHOR_IDS, in both directions', () => {
    expect(Object.keys(ANCHOR_COPY).sort()).toEqual([...FX_ANCHOR_IDS].sort());
  });

  it('every entry has a real label and a real blurb', () => {
    Object.entries(ANCHOR_COPY).forEach(([id, copy]) => {
      expect(copy.label.trim(), `${id}.label`).not.toBe('');
      expect(copy.blurb.trim(), `${id}.blurb`).not.toBe('');
      expect(copy.blurb.length, `${id}.blurb is too short to explain anything`).toBeGreaterThan(20);
    });
  });

  it('labels are unique', () => {
    const labels = Object.values(ANCHOR_COPY).map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('ANCHOR_OPTIONS', () => {
  it('is FX_ANCHOR_IDS in picker order, zipped with its copy', () => {
    expect(ANCHOR_OPTIONS.map((o) => o.id)).toEqual([...FX_ANCHOR_IDS]);
    ANCHOR_OPTIONS.forEach((o) => {
      expect(o.label).toBe(ANCHOR_COPY[o.id].label);
      expect(o.blurb).toBe(ANCHOR_COPY[o.id].blurb);
    });
  });
});

describe('lookup helpers', () => {
  it('return the copy for a known id', () => {
    expect(primitiveLabel('burst')).toBe(PRIMITIVE_COPY.burst.label);
    expect(primitiveBlurb('burst')).toBe(PRIMITIVE_COPY.burst.blurb);
    expect(anchorLabel('travel')).toBe(ANCHOR_COPY.travel.label);
    expect(anchorBlurb('travel')).toBe(ANCHOR_COPY.travel.blurb);
  });

  // A primitive registered without copy must still render a usable button rather than a blank one — the
  // coverage test above is what catches the omission, not a broken UI.
  it('falls back to the raw id rather than rendering blank', () => {
    expect(primitiveLabel('not-a-primitive')).toBe('not-a-primitive');
    expect(primitiveBlurb('not-a-primitive')).toBe('');
  });
});
