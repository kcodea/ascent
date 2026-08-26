import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STAGE, addActor, removeActor, setActorRole, setPoint, roleActor,
  normalizeStages, type StageState,
} from './stageModel'

describe('stage ops', () => {
  it('addActor appends with a unique uid in the given zone', () => {
    const s1 = addActor(DEFAULT_STAGE, 'warband')
    const s2 = addActor(s1, 'warband')
    expect(s2.actors).toHaveLength(2)
    expect(new Set(s2.actors.map((a) => a.uid)).size).toBe(2)
    expect(s2.actors.every((a) => a.zone === 'warband')).toBe(true)
  })
  it('setActorRole + roleActor round-trip', () => {
    const s = setActorRole(addActor(DEFAULT_STAGE, 'warband'), 'stage-0', 'source')
    expect(roleActor(s, 'source')?.uid).toBe('stage-0')
  })
  it('removeActor drops it', () => {
    const s = removeActor(addActor(DEFAULT_STAGE, 'tavern'), 'stage-0')
    expect(s.actors).toHaveLength(0)
  })
  it('setPoint clamps into 0..1', () => {
    const s = setPoint(DEFAULT_STAGE, 'source', { x: 2, y: -1 })
    expect(s.source).toEqual({ x: 1, y: 0 })
  })
  it('ops are immutable', () => {
    const s = addActor(DEFAULT_STAGE, 'warband')
    expect(s).not.toBe(DEFAULT_STAGE)
    expect(DEFAULT_STAGE.actors).toHaveLength(0)
  })
})

describe('normalizeStages', () => {
  it('returns a valid default for junk', () => {
    const out = normalizeStages(null)
    expect(out.last).toEqual(DEFAULT_STAGE)
    expect(out.byDef).toEqual({})
  })
  it('clamps fractions and drops malformed actors', () => {
    const raw = { last: { source: { x: 5, y: 0.5 }, target: { x: 0.7, y: 0.6 }, cursor: { x: 0.5, y: 0.5 }, actors: [{ uid: 'x', zone: 'warband', slot: 0, role: 'nope', atk: 3, hp: 4 }, 42] }, byDef: {} }
    const out = normalizeStages(raw)
    expect(out.last.source.x).toBe(1)          // clamped
    expect(out.last.actors[0].role).toBe('none') // invalid role coerced
    expect(out.last.actors).toHaveLength(1)      // the `42` dropped
  })
})
