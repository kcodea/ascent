import { describe, it, expect } from 'vitest';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { MODE_DEFAULTS, migrateV1Patch, resolveTiming, timingKeysFor } from './resolveTiming';
import type { BeatConfigSnapshot } from './resolveTiming';
import type { TimelineSourceNode } from './timelineTypes';
import type { PresentationBatch, PresentationPolicy } from '@game/core';

/**
 * BEAT CHOREOGRAPHER PR 2 — the compiler's guarantees (blueprint §22.2).
 *
 * These tests exist because the compiler is the ONE place that turns gameplay events into milliseconds for
 * both the live game and the tool. If it is wrong, the tool lies. The two behaviours worth reading closely:
 *
 *   - a nested reaction does NOT advance the root cursor (the fake-pause bug), and
 *   - consequences land at a DELIVERY marker, not at the beat's start (the "buff appears before its source
 *     acted" bug).
 */

let seq = 0;
const trig = (over: Partial<{ id: string; step: number; policy: PresentationPolicy; parentId: string; trigger: string; family: string; policyKey: string; simultaneousGroupId: string; dependencyIds: string[]; id2: string }> = {}) => {
  const id = over.id ?? `t${seq}`;
  return {
    type: 'sourceTrigger' as const,
    id,
    sequence: seq++,
    step: over.step ?? 1,
    phase: 'endOfTurn' as const,
    source: { kind: 'minion' as const, id: `card_${id}`, label: `Card ${id}` },
    trigger: over.trigger ?? 'endOfTurn',
    policy: over.policy ?? ('ownBeat' as PresentationPolicy),
    ...(over.parentId ? { parentId: over.parentId } : {}),
    ...(over.family ? { family: over.family } : {}),
    ...(over.policyKey ? { policyKey: over.policyKey } : {}),
    ...(over.simultaneousGroupId ? { simultaneousGroupId: over.simultaneousGroupId } : {}),
    ...(over.dependencyIds ? { dependencyIds: over.dependencyIds } : {}),
  };
};
const cons = (parentId: string, over: Partial<{ deliveryKey: string; uid: string }> = {}) => ({
  type: 'statsChanged' as const,
  id: `c${seq}`,
  sequence: seq++,
  step: 1,
  parentId,
  target: { zone: 'board' as const, uid: over.uid ?? 'u1' },
  attack: 1,
  health: 1,
  permanent: true,
  ...(over.deliveryKey ? { deliveryKey: over.deliveryKey } : {}),
});

const batchOf = (events: unknown[]): PresentationBatch => {
  seq = 0;
  return { id: 'b1', actionId: 'a1', phase: 'endOfTurn', events: events as PresentationBatch['events'] };
};
const compile = (events: unknown[], config?: BeatConfigSnapshot) =>
  compileTimeline(normalizePresentationBatch(batchOf(events)), config ? { config } : {});

describe('root beats', () => {
  it('places sequential own beats end to end, in gameplay order', () => {
    seq = 0;
    const a = trig({ id: 'a', step: 1 });
    const b = trig({ id: 'b', step: 2 });
    const t = compile([a, b]);
    expect(t.beats.map((x) => x.nodeId)).toEqual(['a', 'b']);
    const own = MODE_DEFAULTS.ownBeat;
    expect(t.beats[0].startMs).toBe(0);
    expect(t.beats[0].completionMs).toBe(own.completionOffsetMs);
    // The second beat starts after the first's RECOVERY, not at its completion.
    expect(t.beats[1].startMs).toBe(own.completionOffsetMs + own.recoveryMs);
  });

  it('simultaneous roots share a start and the cursor clears the LATEST of them', () => {
    seq = 0;
    const a = trig({ id: 'a', step: 1, simultaneousGroupId: 'g' });
    const b = trig({ id: 'b', step: 1, simultaneousGroupId: 'g' });
    const c = trig({ id: 'c', step: 2 });
    const t = compile([a, b, c]);
    const [ba, bb, bc] = ['a', 'b', 'c'].map((id) => t.beats.find((x) => x.nodeId === id)!);
    expect(ba.startMs).toBe(bb.startMs);
    expect(bc.startMs).toBe(Math.max(ba.recoveryEndMs, bb.recoveryEndMs));
  });

  it('a silent root consumes no time but still delivers its consequences', () => {
    seq = 0;
    const a = trig({ id: 'a', policy: 'passive' });
    const c = cons('a');
    const b = trig({ id: 'b' });
    const t = compile([a, c, b]);
    expect(t.beats.find((x) => x.nodeId === 'b')!.startMs).toBe(0); // 'a' cost nothing
    expect(t.consequenceDeliveries).toHaveLength(1);
  });
});

describe('nested reactions (the fake-pause bug)', () => {
  it('a reaction is placed inside its parent and does NOT advance the root cursor', () => {
    seq = 0;
    const parent = trig({ id: 'p', step: 1 });
    const child = trig({ id: 'k', step: 1, policy: 'foldedCue', parentId: 'p' });
    const after = trig({ id: 'z', step: 2 });
    const t = compile([parent, child, after]);

    const bp = t.beats.find((x) => x.nodeId === 'p')!;
    const bk = t.beats.find((x) => x.nodeId === 'k')!;
    const bz = t.beats.find((x) => x.nodeId === 'z')!;

    expect(bk.lane).toBe('reaction');
    expect(bk.parentBeatId).toBe(bp.id);
    // It starts at the parent's DELIVERY — when the thing it reacts to actually lands.
    expect(bk.startMs).toBe(bp.deliveryMs);
    // …and the next ROOT is unaffected by it: the reaction bought no extra sequential time.
    expect(bz.startMs).toBe(bp.recoveryEndMs);
  });

  it('a reaction that overruns its parent EXTENDS the parent instead of being clipped', () => {
    seq = 0;
    const parent = trig({ id: 'p', step: 1 });
    const child = trig({ id: 'k', step: 1, policy: 'foldedCue', parentId: 'p' });
    const t = compile([parent, child], {
      version: 2,
      templates: {},
      overrides: { 'source:minion:card_k:phase:endOfTurn:trigger:endOfTurn': { completionOffsetMs: 5000 } },
    });
    const bp = t.beats.find((x) => x.nodeId === 'p')!;
    const bk = t.beats.find((x) => x.nodeId === 'k')!;
    expect(bk.completionMs).toBeGreaterThan(MODE_DEFAULTS.ownBeat.completionOffsetMs);
    expect(bp.completionMs).toBe(bk.completionMs); // parent stretched to cover it
    expect(bp.recoveryEndMs).toBe(bk.completionMs + bp.config.recoveryMs);
  });

  it('gameplay causality wins over config: a node with a parent is a reaction even if reclassified ownBeat', () => {
    seq = 0;
    const t = compile([trig({ id: 'p' }), trig({ id: 'k', parentId: 'p', policy: 'ownBeat' })]);
    expect(t.beats.find((x) => x.nodeId === 'k')!.lane).toBe('reaction');
  });
});

describe('consequence delivery', () => {
  it('lands at the delivery marker, never at the beat start', () => {
    seq = 0;
    const t = compile([trig({ id: 'a' }), cons('a')]);
    const beat = t.beats[0];
    expect(t.consequenceDeliveries[0].atMs).toBe(beat.deliveryMs);
    expect(t.consequenceDeliveries[0].atMs).toBeGreaterThan(beat.startMs);
  });

  it('staggers multiple targets deterministically, per marker', () => {
    seq = 0;
    const t = compile([trig({ id: 'a' }), cons('a', { uid: 'u1' }), cons('a', { uid: 'u2' }), cons('a', { uid: 'u3' })]);
    const stagger = MODE_DEFAULTS.ownBeat.targetStaggerMs;
    const at = t.consequenceDeliveries.map((d) => d.atMs);
    expect(at[1] - at[0]).toBe(stagger);
    expect(at[2] - at[1]).toBe(stagger);
  });

  it('a named sub-marker delivers at its own offset', () => {
    seq = 0;
    const t = compile([trig({ id: 'a' }), cons('a', { deliveryKey: 'consume.arrive' })], {
      version: 2,
      templates: { global: { deliveryMarkers: { 'consume.arrive': 900 } } },
      overrides: {},
    });
    expect(t.consequenceDeliveries[0].atMs).toBe(t.beats[0].startMs + 900);
  });

  it('an unknown marker falls back to primary delivery AND reports it', () => {
    seq = 0;
    const t = compile([trig({ id: 'a' }), cons('a', { deliveryKey: 'typo.marker' })]);
    expect(t.consequenceDeliveries[0].atMs).toBe(t.beats[0].deliveryMs);
    expect(t.diagnostics.some((d) => d.message.includes('typo.marker'))).toBe(true);
  });
});

describe('timing resolution', () => {
  const node = (over: Partial<TimelineSourceNode> = {}): TimelineSourceNode => ({
    id: 'n', phase: 'endOfTurn', source: { kind: 'rune', id: 'rune_lapidary' }, trigger: 'endOfTurn',
    policyKey: 'rune:rune_lapidary:endOfTurn', family: 'endOfTurn', emittedPolicy: 'ownBeat',
    step: 1, sequence: 0, dependencyIds: [], consequences: [], runtimeAdapter: 'presentationBatch', runtimeRef: null,
    ...over,
  });

  it('merges the chain PER FIELD — a sparse source override keeps its family pacing', () => {
    const { value, provenance } = resolveTiming(node(), {
      version: 2,
      templates: { 'family:endOfTurn': { deliveryOffsetMs: 200, recoveryMs: 300 } },
      overrides: { 'source:rune:rune_lapidary': { completionOffsetMs: 900 } },
    });
    expect(value.completionOffsetMs).toBe(900);
    expect(value.deliveryOffsetMs).toBe(200); // family still supplies what the source omitted
    expect(value.recoveryMs).toBe(300);
    expect(provenance.completionOffsetMs).toBe('source:rune:rune_lapidary');
    expect(provenance.deliveryOffsetMs).toBe('family:endOfTurn');
  });

  it('a draft edit beats the committed file', () => {
    const { value, provenance } = resolveTiming(node(), { version: 2, templates: {}, overrides: { global: { completionOffsetMs: 100 } } }, { global: { completionOffsetMs: 777 } });
    expect(value.completionOffsetMs).toBe(777);
    expect(provenance.completionOffsetMs).toBe('draft:global');
  });

  it('the chain runs global → policy → trigger → family → source → phase → trigger → occurrence', () => {
    const keys = timingKeysFor(node({ occurrenceKey: 'left' }));
    expect(keys[0]).toBe('global');
    expect(keys).toContain('family:endOfTurn');
    expect(keys[keys.length - 1]).toBe('occurrence:left');
    expect(keys.indexOf('family:endOfTurn')).toBeGreaterThan(keys.indexOf('policy:ownBeat'));
  });

  it('reclassifying re-bases the timing on the new mode', () => {
    const folded = resolveTiming(node({ emittedPolicy: 'reactInsideParent' }));
    const own = resolveTiming(node({ emittedPolicy: 'reactInsideParent' }), { version: 2, templates: {}, overrides: {}, policies: { 'source:rune:rune_lapidary': 'ownBeat' } });
    expect(folded.value.completionOffsetMs).toBe(MODE_DEFAULTS.reactInsideParent.completionOffsetMs);
    expect(own.value.completionOffsetMs).toBe(MODE_DEFAULTS.ownBeat.completionOffsetMs);
  });

  it('v1 windup/hold/recovery migrates losslessly', () => {
    expect(migrateV1Patch({ windupMs: 120, holdMs: 420, recoveryMs: 170 })).toEqual({
      deliveryOffsetMs: 120, completionOffsetMs: 540, recoveryMs: 170,
    });
  });

  it('the shipped v1 per-policy pacing survives the migration unchanged', () => {
    expect(migrateV1Patch({ windupMs: 120, holdMs: 420, recoveryMs: 170 })).toMatchObject({
      deliveryOffsetMs: MODE_DEFAULTS.ownBeat.deliveryOffsetMs,
      completionOffsetMs: MODE_DEFAULTS.ownBeat.completionOffsetMs,
      recoveryMs: MODE_DEFAULTS.ownBeat.recoveryMs,
    });
    expect(migrateV1Patch({ windupMs: 0, holdMs: 160, recoveryMs: 60 })).toMatchObject({
      completionOffsetMs: MODE_DEFAULTS.reactInsideParent.completionOffsetMs,
      recoveryMs: MODE_DEFAULTS.reactInsideParent.recoveryMs,
    });
  });
});

describe('diagnostics — problems surface instead of being silently repaired', () => {
  it('reports a missing policyKey rather than reconstructing one', () => {
    seq = 0;
    const t = compile([trig({ id: 'a' })]); // no policyKey
    expect(t.diagnostics.some((d) => d.code === 'missingPolicyKey')).toBe(true);
  });

  it('reports an orphan consequence', () => {
    seq = 0;
    const t = compile([trig({ id: 'a' }), cons('nope')]);
    expect(t.diagnostics.some((d) => d.code === 'orphanConsequence')).toBe(true);
    expect(t.consequenceDeliveries).toHaveLength(0);
  });

  it('reports an unknown parent and keeps the beat as a root (never drops it)', () => {
    seq = 0;
    const t = compile([trig({ id: 'a', parentId: 'ghost' })]);
    expect(t.diagnostics.some((d) => d.code === 'unknownParent')).toBe(true);
    expect(t.beats).toHaveLength(1);
    expect(t.beats[0].lane).toBe('source');
  });

  it('reports a dependency cycle without hanging or throwing', () => {
    seq = 0;
    const a = { ...trig({ id: 'a' }), dependencyIds: ['b'] };
    const b = { ...trig({ id: 'b' }), dependencyIds: ['a'] };
    const t = compile([a, b]);
    expect(t.diagnostics.some((d) => d.code === 'dependencyCycle')).toBe(true);
    expect(t.beats).toHaveLength(2);
  });

  it('clamps an illegal timing (completion before delivery) and says so', () => {
    seq = 0;
    const t = compile([trig({ id: 'a' })], { version: 2, templates: {}, overrides: { global: { deliveryOffsetMs: 500, completionOffsetMs: 100 } } });
    expect(t.diagnostics.some((d) => d.code === 'invalidTiming')).toBe(true);
    expect(t.beats[0].completionMs).toBeGreaterThanOrEqual(t.beats[0].deliveryMs);
  });

  it('refuses to invent a runtime anchor it was not given', () => {
    seq = 0;
    const t = compile([trig({ id: 'a' })], { version: 2, templates: { global: { anchor: { kind: 'atAttackContact', offsetMs: 0 } } }, overrides: {} });
    expect(t.diagnostics.some((d) => d.code === 'unknownAnchor')).toBe(true);
  });
});

describe('determinism (blueprint §11.3)', () => {
  it('the same input and config compile byte-identically', () => {
    const build = () => {
      seq = 0;
      return compile([trig({ id: 'a' }), cons('a'), trig({ id: 'k', parentId: 'a', policy: 'foldedCue' }), trig({ id: 'b', step: 2 })]);
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it('an empty batch compiles to an empty, zero-length timeline', () => {
    const t = compile([]);
    expect(t.beats).toHaveLength(0);
    expect(t.durationMs).toBe(0);
  });
});
