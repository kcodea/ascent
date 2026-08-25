import { describe, it, expect } from 'vitest'
import { isFilterGroup, filterEntries, filterOnCount, FILTER_GROUP_LABELS } from './filterGroups'
import type { FxParamSpecs } from '../params'
import { FILTERS } from '../filterRegistry'

// Build a specs object with two known filters' params by cloning what filterLabSpecs emits:
// pick the first two registry filters and synthesise their on/amt keys.
const [f0, f1] = FILTERS
const specs = {
  [`${f0.id}On`]: { kind: 'toggle', label: f0.label, group: f0.label, default: false },
  [`${f0.id}Amt`]: { kind: 'slider', label: 'Amount', group: f0.label, min: 0, max: 1, step: 0.01, default: 0 },
  [`${f1.id}On`]: { kind: 'toggle', label: f1.label, group: f1.label, default: false },
  plainThing: { kind: 'slider', label: 'Plain', group: 'General', min: 0, max: 1, step: 0.1, default: 0 },
} as unknown as FxParamSpecs

describe('isFilterGroup', () => {
  it('recognises a registry filter label', () => {
    expect(isFilterGroup(f0.label)).toBe(true)
    expect(isFilterGroup('General')).toBe(false)
    expect(isFilterGroup(undefined)).toBe(false)
  })
})

describe('filterEntries', () => {
  it('lists filters present in specs with their non-toggle param keys', () => {
    const entries = filterEntries(specs, {})
    const e0 = entries.find((e) => e.id === f0.id)!
    expect(e0.paramKeys).toContain(`${f0.id}Amt`)
    expect(e0.paramKeys).not.toContain(`${f0.id}On`)
  })
  it('floats enabled filters to the top', () => {
    const entries = filterEntries(specs, { [`${f1.id}On`]: true })
    expect(entries[0].id).toBe(f1.id)
    expect(entries[0].on).toBe(true)
  })
})

describe('filterOnCount', () => {
  it('counts enabled', () => {
    expect(filterOnCount(filterEntries(specs, { [`${f0.id}On`]: true }))).toBe(1)
  })
})

describe('FILTER_GROUP_LABELS', () => {
  it('has one label per registry filter', () => {
    expect(FILTER_GROUP_LABELS.size).toBe(new Set(FILTERS.map((f) => f.label)).size)
  })
})
