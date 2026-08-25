import { describe, it, expect } from 'vitest'
import { buildCommands, nextHighlight, type CommandSources } from './commandIndex'
import type { FxParamSpecs } from '../params'

const burstSpecs: FxParamSpecs = {
  count: { kind: 'slider', label: 'Shard count', min: 1, max: 50, step: 1, default: 12 },
  blendMode: { kind: 'enum', label: 'Blend mode', options: ['normal', 'add'], default: 'add' },
} as unknown as FxParamSpecs

const sources: CommandSources = {
  layers: [
    { primitive: 'burst', name: 'Sparks', anchor: 'source', at: 0, life: null, params: {} } as any,
    { primitive: 'burst', name: 'Trail', anchor: 'travel', at: 0, life: null, params: {} } as any,
  ],
  specsByPrimitive: { burst: burstSpecs },
  actions: [
    { id: 'fire', label: 'Fire once' },
    { id: 'addLayer', label: 'Add layer' },
  ],
}

describe('buildCommands', () => {
  it('matches params by label across all layers', () => {
    const out = buildCommands(sources, 'blend')
    const params = out.filter((c) => c.kind === 'param')
    expect(params).toHaveLength(2) // one per layer
    expect(params[0]).toMatchObject({ layerIndex: 0, paramKey: 'blendMode' })
  })
  it('matches a layer by name', () => {
    const out = buildCommands(sources, 'trail')
    expect(out.some((c) => c.kind === 'layer' && c.layerIndex === 1)).toBe(true)
  })
  it('matches actions by label', () => {
    const out = buildCommands(sources, 'fire')
    expect(out.some((c) => c.kind === 'action' && c.actionId === 'fire')).toBe(true)
  })
  it('empty query lists actions then a jump per layer, no params', () => {
    const out = buildCommands(sources, '  ')
    expect(out.filter((c) => c.kind === 'param')).toHaveLength(0)
    expect(out.filter((c) => c.kind === 'action')).toHaveLength(2)
    expect(out.filter((c) => c.kind === 'layer')).toHaveLength(2)
  })
  it('ids are stable and unique', () => {
    const out = buildCommands(sources, 'a')
    const ids = out.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('nextHighlight', () => {
  it('wraps forward past the end', () => { expect(nextHighlight(2, 3, 1)).toBe(0) })
  it('wraps backward past the start', () => { expect(nextHighlight(0, 3, -1)).toBe(2) })
  it('is 0 for an empty list', () => { expect(nextHighlight(0, 0, 1)).toBe(0) })
})
