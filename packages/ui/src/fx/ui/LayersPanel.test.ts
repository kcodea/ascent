import { describe, it, expect } from 'vitest'
import { resolveDrop } from './LayersPanel'
describe('LayersPanel.resolveDrop', () => {
  it('delegates to reorderTargetIndex', () => {
    expect(resolveDrop(0, 65, [0, 40, 80])).toBe(1)
    expect(resolveDrop(2, -50, [0, 40, 80])).toBe(0)
  })
})
