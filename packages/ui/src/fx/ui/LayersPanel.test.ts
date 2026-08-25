import { describe, it, expect } from 'vitest'
import { resolveDrop } from './LayersPanel'
describe('LayersPanel.resolveDrop', () => {
  it('delegates to reorderTargetIndex', () => {
    expect(resolveDrop(0, 65, [0, 40, 80])).toBe(1)
    expect(resolveDrop(2, -50, [0, 40, 80])).toBe(0)
  })
  // Note: the grip-drag "staleness after delete" bug lived in the CALLER building an over-long rowTops from
  // an index-keyed ref array, not in resolveDrop — which always clamps to rowTops.length. It can't be
  // expressed as a pure resolveDrop assertion (that would be vacuous), so it is covered by the fix at the
  // measurement site (LayersPanel building rowTops from props.layers), verified in review, not here.
})
