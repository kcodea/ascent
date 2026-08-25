import { describe, it, expect } from 'vitest'
import { resolveDrop } from './LayersPanel'
describe('LayersPanel.resolveDrop', () => {
  it('delegates to reorderTargetIndex', () => {
    expect(resolveDrop(0, 65, [0, 40, 80])).toBe(1)
    expect(resolveDrop(2, -50, [0, 40, 80])).toBe(0)
  })

  it('resolves in range when rowTops is sized to the list AFTER a layer deletion', () => {
    // Regression for the grip-drag staleness bug: a drag started right after deleting a layer must measure
    // rowTops against the LIVE (shrunken) layer count, never a longer, stale array — otherwise every drop
    // target falls out of range and `applyReorder`/`onSelect` both silently no-op on an invalid index.
    const rowTops = [0, 40, 80] // 3 rows left after a delete brought the list down from 4
    for (const pointerY of [-999, 0, 20, 40, 60, 80, 999]) {
      const to = resolveDrop(1, pointerY, rowTops)
      expect(to).toBeGreaterThanOrEqual(0)
      expect(to).toBeLessThan(rowTops.length)
    }
  })
})
