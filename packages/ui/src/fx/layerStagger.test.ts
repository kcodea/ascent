import { describe, expect, it } from 'vitest';
import { setLayerStagger } from './ui/layerModel';
import type { EditorLayer } from './ui/layerModel';

const layer = (over: Partial<EditorLayer> = {}): EditorLayer =>
  ({ primitive: 'burst', anchor: 'target', at: 0, life: null, params: {}, ...over } as EditorLayer);

/**
 * `stagger` is the axis that lets ONE effect move at two rhythms — gems landing together while the badges
 * they buff pop in sequence. Before it, traversal lived only ABOVE the def (the cue staggered whole plays),
 * so every layer of every copy shared one schedule.
 *
 * The shift itself is applied in `playDef.staggerLayers`, which is module-private; what is testable here is
 * the editor model that produces the field, and the invariant that matters most is that a def which does
 * not use it serialises exactly as it did before the field existed.
 */
describe('setLayerStagger', () => {
  it('sets the field on the named layer only', () => {
    const out = setLayerStagger([layer(), layer()], 1, 60);
    expect(out[0].stagger).toBeUndefined();
    expect(out[1].stagger).toBe(60);
  });

  it('DELETES rather than storing 0 — 0 is the default, not a setting', () => {
    // A def carrying an explicit `stagger: 0` on every layer is noise in a diff reviewers have to read,
    // and it would appear on every effect authored before this field existed, on its next save.
    const out = setLayerStagger([layer({ stagger: 60 })], 0, 0);
    expect('stagger' in out[0]).toBe(false);
  });

  it('deletes on null too', () => {
    const out = setLayerStagger([layer({ stagger: 60 })], 0, null);
    expect('stagger' in out[0]).toBe(false);
  });

  it('refuses a negative — a layer running EARLIER on later units is a schedule nobody asked for', () => {
    const out = setLayerStagger([layer({ stagger: 60 })], 0, -40);
    expect('stagger' in out[0]).toBe(false);
  });

  it('returns a NEW array and does not mutate the input', () => {
    const before = [layer(), layer()];
    const out = setLayerStagger(before, 0, 40);
    expect(out).not.toBe(before);
    expect(before[0].stagger).toBeUndefined();
  });

  it('leaves every other field of the layer alone', () => {
    const out = setLayerStagger([layer({ at: 120, bow: 0, name: 'sparks' })], 0, 40);
    expect(out[0].at).toBe(120);
    expect(out[0].bow).toBe(0);
    expect(out[0].name).toBe('sparks');
  });

  it('is a no-op for an index that is not there', () => {
    const before = [layer()];
    expect(setLayerStagger(before, 7, 40)).toEqual(before);
  });
});
