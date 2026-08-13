import { describe, it, expect } from 'vitest';
import { resolveBeatTiming, resolvePolicy, readShippedOverrides, timingKeysFor, timingProvenance, POLICY_TIMING } from './beatTiming';
import { migrateV1Patch } from '../choreographer/resolveTiming';
import { scheduleBeats } from './beatTimeline';
import type { PresentationBatch } from '@game/core';

/** BEAT SYSTEM PR 7 — the timing layer's specificity chain + sparse-patch merge. */
const oona = { source: { kind: 'minion' as const, id: 'b2_oona' }, trigger: 'onSummon', policy: 'foldedCue' as const };
const lapidary = { source: { kind: 'rune' as const, id: 'runeLapidary' }, trigger: 'endOfTurn', policy: 'ownBeat' as const };

describe('timing resolution', () => {
  it('with no overrides, reproduces the shipped per-policy defaults exactly', () => {
    expect(resolveBeatTiming(oona)).toEqual(POLICY_TIMING.foldedCue);
    expect(resolveBeatTiming(lapidary)).toEqual(POLICY_TIMING.ownBeat);
  });

  it('most-specific key wins, per FIELD (sparse patches merge)', () => {
    const t = resolveBeatTiming(lapidary, {
      'trigger:endOfTurn': { holdMs: 300, windupMs: 200 },
      'source:rune:runeLapidary:endOfTurn': { holdMs: 900 },
    });
    expect(t.holdMs).toBe(900);      // exact source wins
    expect(t.windupMs).toBe(200);    // trigger level supplies the field the source patch omits
    expect(t.recoveryMs).toBe(POLICY_TIMING.ownBeat.recoveryMs); // untouched → shipped default
  });

  it('the chain is source → (family) → trigger → policy', () => {
    const keys = timingKeysFor(oona);
    expect(keys[0]).toBe('source:minion:b2_oona:onSummon');
    expect(keys[keys.length - 2]).toBe('trigger:onSummon');
    expect(keys[keys.length - 1]).toBe('policy:foldedCue');
  });

  it('provenance names the key that supplies each field', () => {
    const prov = timingProvenance(lapidary, { 'source:rune:runeLapidary:endOfTurn': { holdMs: 900 } });
    expect(prov.holdMs).toBe('source:rune:runeLapidary:endOfTurn');
    expect(prov.windupMs).toBe('policy:ownBeat');
  });

  it('scheduleBeats accepts a resolver and paces beats with it', () => {
    const batch: PresentationBatch = {
      id: 'b', actionId: 'a', phase: 'endOfTurn',
      events: [{ type: 'sourceTrigger', id: 't1', sequence: 0, step: 1, phase: 'endOfTurn', source: { kind: 'rune', id: 'runeLapidary' }, trigger: 'endOfTurn', policy: 'ownBeat' }],
    };
    const { totalMs } = scheduleBeats(batch, (t) => resolveBeatTiming(t, { 'source:rune:runeLapidary:endOfTurn': { windupMs: 0, holdMs: 100, recoveryMs: 0 } }));
    expect(totalMs).toBe(100);
  });
});

describe('policy overrides (the folded ↔ own-beat toggle)', () => {
  const repete = { source: { kind: 'hero' as const, id: 'repete' }, trigger: 'secondHand', policy: 'foldedCue' as const };

  it('no override → the emitted policy stands', () => {
    expect(resolvePolicy(repete)).toBe('foldedCue');
  });

  it('an override reclassifies the beat (folded → own)', () => {
    expect(resolvePolicy(repete, { 'source:hero:repete:secondHand': 'ownBeat' })).toBe('ownBeat');
  });

  it('reclassifying re-bases the timing to the new policy default', () => {
    const folded = resolveBeatTiming(repete);
    const own = resolveBeatTiming(repete, {}, { 'source:hero:repete:secondHand': 'ownBeat' });
    expect(own.holdMs).toBeGreaterThan(folded.holdMs); // ownBeat holds (420) vs foldedCue (160)
    expect(own).toEqual(POLICY_TIMING.ownBeat);
  });

  it('a timing override still layers on top of the reclassified base', () => {
    const t = resolveBeatTiming(repete, { 'source:hero:repete:secondHand': { holdMs: 999 } }, { 'source:hero:repete:secondHand': 'ownBeat' });
    expect(t.holdMs).toBe(999);
    expect(t.windupMs).toBe(POLICY_TIMING.ownBeat.windupMs);
  });
});

describe('the editor reads whichever config format is on disk (CHOREOGRAPHER PR 12)', () => {
  // `beat-defaults.json` is a v2 file now, because that is what the live compiler reads. If this editor only
  // understood `timings`, it would show an EMPTY editor over a file full of committed values — and the next
  // commit would look like a deliberate reset while silently wiping reviewed work.
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
