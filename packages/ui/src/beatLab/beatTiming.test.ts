import { describe, it, expect } from 'vitest';
import { resolveBeatTiming, timingKeysFor, timingProvenance, POLICY_TIMING } from './beatTiming';
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
