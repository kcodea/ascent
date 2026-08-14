import { describe, it, expect } from 'vitest';
import { readShippedOverrides, mergeOverrides, timingKeysFor } from './beatTiming';
import { migrateV1Patch } from '../choreographer/resolveTiming';

/**
 * CHOREOGRAPHER PR 18 — this file used to test a full v1 timing RESOLVER. That resolver was a second engine
 * beside the live compiler, and it is deleted: resolution behaviour (specificity chain, sparse merge,
 * provenance, policy re-basing) is owned and tested by `choreographer/resolveTiming` + `compileTimeline`,
 * and the Lab schedules through them (`labSchedule.test.ts` pins that). What remains here is the FILE layer.
 */
describe('the editor reads whichever config format is on disk (CHOREOGRAPHER PR 12)', () => {
  it('converts a v2 override back into the windup/hold the editor thinks in', () => {
    const out = readShippedOverrides({
      version: 2,
      overrides: { 'source:rune:rune_lapidary:endOfTurn': { deliveryOffsetMs: 100, completionOffsetMs: 600, recoveryMs: 40 } },
    });
    expect(out['source:rune:rune_lapidary:endOfTurn']).toEqual({ windupMs: 100, holdMs: 500, recoveryMs: 40 });
  });

  it('round-trips: v1 → v2 → v1 is lossless', () => {
    const v1 = { windupMs: 120, holdMs: 420, recoveryMs: 170 };
    const v2 = migrateV1Patch(v1);
    const back = readShippedOverrides({ version: 2, overrides: { global: v2 } });
    expect(back.global).toEqual(v1);
  });

  it('still reads a v1 file unchanged', () => {
    const out = readShippedOverrides({ version: 1, timings: { global: { holdMs: 300 } } });
    expect(out.global).toEqual({ holdMs: 300 });
  });

  it('a missing or malformed file yields no overrides rather than throwing', () => {
    expect(readShippedOverrides(undefined)).toEqual({});
    expect(readShippedOverrides({ version: 2 })).toEqual({});
  });
});

describe('draft plumbing', () => {
  it('mergeOverrides merges per FIELD, b winning', () => {
    const merged = mergeOverrides(
      { k: { windupMs: 10, holdMs: 20 } },
      { k: { holdMs: 99 }, other: { recoveryMs: 5 } },
    );
    expect(merged.k).toEqual({ windupMs: 10, holdMs: 99 });
    expect(merged.other).toEqual({ recoveryMs: 5 });
  });

  it('timingKeysFor puts the exact source first — the grammar edit keys are written in', () => {
    const keys = timingKeysFor({ source: { kind: 'rune', id: 'rune_lapidary' }, trigger: 'endOfTurn', policy: 'ownBeat' });
    expect(keys[0]).toBe('source:rune:rune_lapidary:endOfTurn');
    expect(keys[keys.length - 1]).toBe('policy:ownBeat');
  });
});
