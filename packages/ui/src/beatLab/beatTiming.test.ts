import { describe, it, expect } from 'vitest';
import { resolveBeatTiming, resolvePolicy, timingKeysFor, timingProvenance, POLICY_TIMING } from './beatTiming';
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
