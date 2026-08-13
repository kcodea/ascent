import { describe, it, expect } from 'vitest';
import { readBeatConfig } from './beatConfig';
import { MODE_DEFAULTS, resolveTiming } from './resolveTiming';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import type { TimelineSourceNode } from './timelineTypes';
import type { PresentationBatch } from '@game/core';

/**
 * BEAT CHOREOGRAPHER PR 10 — the authored config reaches LIVE playback.
 *
 * The gap this closes: the compiler always accepted a config, but nothing passed one. Timings tuned in the
 * tool and committed to `beat-defaults.json` were written to a file the game never read — a designer could
 * tune, commit, reload, and watch nothing change. Indistinguishable from a broken tool, and the last piece of
 * the owner's "my edits do nothing".
 *
 * The v1→v2 read matters too: the shipped file is v1, and the blueprint forbids silently rewriting it on load.
 */
const node = (over: Partial<TimelineSourceNode> = {}): TimelineSourceNode => ({
  id: 'n', phase: 'endOfTurn', source: { kind: 'rune', id: 'rune_lapidary' }, trigger: 'endOfTurn',
  policyKey: 'rune:rune_lapidary:endOfTurn', family: 'endOfTurn', emittedPolicy: 'ownBeat',
  step: 1, sequence: 0, dependencyIds: [], consequences: [], runtimeAdapter: 'presentationBatch', runtimeRef: null,
  ...over,
});

describe('v1 files keep working (the shipped format)', () => {
  it('migrates windup/hold/recovery into delivery/completion/recovery', () => {
    const cfg = readBeatConfig({ version: 1, timings: { global: { windupMs: 100, holdMs: 400, recoveryMs: 50 } } });
    expect(cfg.overrides.global).toEqual({ deliveryOffsetMs: 100, completionOffsetMs: 500, recoveryMs: 50 });
  });

  it('a v1 policy value maps onto the user-facing mode vocabulary', () => {
    const cfg = readBeatConfig({ version: 1, timings: {}, policies: { 'source:hero:repete:secondHand': 'foldedCue' } });
    expect(cfg.policies?.['source:hero:repete:secondHand']).toBe('reactInsideParent');
  });

  it('the migration is READ-only — it reports its provenance rather than pretending to be a v2 file', () => {
    expect(readBeatConfig({ version: 1, timings: {} }).revision).toBe('file:v1-migrated');
  });
});

describe('v2 files load as authored', () => {
  it('keeps templates and overrides separate', () => {
    const cfg = readBeatConfig({
      version: 2,
      templates: { 'family:endOfTurn': { deliveryOffsetMs: 200 } },
      overrides: { 'source:rune:rune_lapidary': { completionOffsetMs: 900 } },
    });
    expect(cfg.templates['family:endOfTurn']).toEqual({ deliveryOffsetMs: 200 });
    expect(cfg.overrides['source:rune:rune_lapidary']).toEqual({ completionOffsetMs: 900 });
  });

  it('accepts modes already written in v2 vocabulary', () => {
    const cfg = readBeatConfig({ version: 2, policies: { global: 'reactInsideParent' } });
    expect(cfg.policies?.global).toBe('reactInsideParent');
  });
});

describe('a malformed config can never break End Turn', () => {
  it.each([null, undefined, 42, 'nope', [], { version: 99 }])('%p degrades to defaults instead of throwing', (raw) => {
    expect(() => readBeatConfig(raw)).not.toThrow();
    const cfg = readBeatConfig(raw);
    expect(cfg.overrides).toEqual({});
  });

  it('a non-object patch is skipped rather than crashing the read', () => {
    const cfg = readBeatConfig({ version: 1, timings: { global: 'not-a-patch' } });
    expect(cfg.overrides.global).toBeUndefined();
  });
});

describe('the config actually changes what the compiler produces', () => {
  const batch: PresentationBatch = {
    id: 'b', actionId: 'a', phase: 'endOfTurn',
    events: [{
      type: 'sourceTrigger', id: 't1', sequence: 0, step: 1, phase: 'endOfTurn',
      source: { kind: 'rune', id: 'rune_lapidary' }, trigger: 'endOfTurn', policy: 'ownBeat',
      policyKey: 'rune:rune_lapidary:endOfTurn', family: 'endOfTurn',
    }],
  };

  it('with no config, a beat uses the shipped defaults', () => {
    const t = compileTimeline(normalizePresentationBatch(batch));
    expect(t.beats[0].completionMs).toBe(MODE_DEFAULTS.ownBeat.completionOffsetMs);
  });

  it('a committed override RE-PACES the compiled beat — the whole point', () => {
    const config = readBeatConfig({ version: 1, timings: { 'source:rune:rune_lapidary:endOfTurn': { windupMs: 0, holdMs: 1200, recoveryMs: 0 } } });
    const t = compileTimeline(normalizePresentationBatch(batch), { config });
    expect(t.beats[0].completionMs).toBe(1200);
    expect(t.durationMs).toBe(1200);
  });

  it('a committed family template reaches every beat of that family', () => {
    const config = readBeatConfig({ version: 2, templates: { 'family:endOfTurn': { completionOffsetMs: 999 } } });
    const { value, provenance } = resolveTiming(node(), config);
    expect(value.completionOffsetMs).toBe(999);
    expect(provenance.completionOffsetMs).toBe('family:endOfTurn');
  });

  it('a committed reclassification changes the beat mode live', () => {
    const config = readBeatConfig({ version: 1, timings: {}, policies: { 'source:rune:rune_lapidary': 'foldedCue' } });
    const { value } = resolveTiming(node(), config);
    expect(value.mode).toBe('reactInsideParent');
    expect(value.completionOffsetMs).toBe(MODE_DEFAULTS.reactInsideParent.completionOffsetMs);
  });
});

describe('already-committed v1 keys keep applying (silent-regression guard)', () => {
  // The v1 Beat Lab wrote `source:<kind>:<id>:<trigger>` with no phase segment. If the v2 chain had dropped
  // that shape, every reviewed value already committed would have stopped applying with no error anywhere —
  // the quietest possible regression, and precisely the class of failure this project exists to end.
  it('a v1 source key still resolves', () => {
    const config = readBeatConfig({ version: 1, timings: { 'source:rune:rune_lapidary:endOfTurn': { windupMs: 0, holdMs: 1200, recoveryMs: 0 } } });
    const { value, provenance } = resolveTiming(node(), config);
    expect(value.completionOffsetMs).toBe(1200);
    expect(provenance.completionOffsetMs).toBe('source:rune:rune_lapidary:endOfTurn');
  });

  it('an explicit v2 phase-qualified key still outranks the v1 shape', () => {
    const config = readBeatConfig({
      version: 2,
      overrides: {
        'source:rune:rune_lapidary:endOfTurn': { completionOffsetMs: 1200 },
        'source:rune:rune_lapidary:phase:endOfTurn:trigger:endOfTurn': { completionOffsetMs: 300 },
      },
    });
    expect(resolveTiming(node(), config).value.completionOffsetMs).toBe(300);
  });
});
