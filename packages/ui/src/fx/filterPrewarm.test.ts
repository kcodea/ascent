/**
 * The filter warm-up (gameplay perf pass 2026-10-09) must cover every filter a committed def switches on, so no
 * filtered effect links its program on its first play (measured: a 97-132 ms freeze on the first hand-to-board drop).
 */
import { describe, expect, it } from 'vitest';
import { CORE_BLUR_ID } from './filterStack';
import { filterIdsInUse, filterPrewarmSteps } from './filterPrewarm';

const def = (...layers: Record<string, unknown>[]) => ({ layers: layers.map((params) => ({ params })) });

describe('filterIdsInUse', () => {
  it('collects every registry filter a def layer switches on, once', () => {
    const ids = filterIdsInUse([
      def({ bloomOn: true, glowOn: false }, { glowOn: true }),
      def({ bloomOn: true, rgbSplitOn: true }),
    ]);
    expect(new Set(ids)).toEqual(new Set(['bloom', 'glow', 'rgbSplit']));
  });

  it('adds the core blur only when a layer actually blurs', () => {
    expect(filterIdsInUse([def({ blur: 0 })])).toEqual([]);
    expect(filterIdsInUse([def({ blur: 2.5 })])).toEqual([CORE_BLUR_ID]);
  });

  it('ignores switches that are not registry filters (audio sends, unknown ids)', () => {
    expect(filterIdsInUse([def({ reverbOn: true, notAFilterOn: true })])).toEqual([]);
  });

  it('yields no steps without a renderer', () => {
    expect(filterPrewarmSteps(null)).toEqual([]);
  });
});
