import { describe, it, expect } from 'vitest';
import type { PresentationBatch } from '@game/core';
import { labSchedule, draftToEngine, labEffectiveTiming, modeToPolicyWord } from './labSchedule';
import { compileTimeline } from '../choreographer/compileTimeline';
import { normalizePresentationBatch } from '../choreographer/adapters/presentationBatchAdapter';
import { shippedBeatConfig } from '../choreographer/beatConfig';

/**
 * CHOREOGRAPHER PR 18 — ONE ENGINE. The load-bearing guarantee of this whole PR:
 *
 *   what the Beat Lab schedules IS `compileTimeline` with the SAME committed config live playback reads.
 *
 * If these ever diverge, the Lab is lying again — the exact failure the pivot exists to end. So the central
 * test is byte-equivalence between the Lab's schedule and a direct compile, not any particular timing value.
 */
const batch = (policy: 'ownBeat' | 'foldedCue' = 'ownBeat', withChild = false): PresentationBatch => ({
  id: 'b1', actionId: 'a1', phase: 'endOfTurn',
  events: [
    { type: 'sourceTrigger', id: 't1', sequence: 0, step: 1, phase: 'endOfTurn', source: { kind: 'rune', id: 'rune_lapidary', label: 'Lapidary' }, trigger: 'endOfTurn', policy, family: 'endOfTurn' },
    { type: 'statsChanged', id: 'c1', sequence: 1, step: 1, parentId: 't1', target: { zone: 'board', uid: 'u1' }, attack: 1, health: 1, permanent: true },
    { type: 'statsChanged', id: 'c2', sequence: 2, step: 1, parentId: 't1', target: { zone: 'board', uid: 'u2' }, attack: 1, health: 1, permanent: true },
    ...(withChild ? [
      { type: 'sourceTrigger', id: 't2', sequence: 3, step: 1, phase: 'endOfTurn', source: { kind: 'minion', id: 'b2_oona', label: 'Oona' }, trigger: 'onSummon', policy: 'foldedCue', parentId: 't1' } as const,
    ] : []),
    { type: 'sourceTrigger', id: 't3', sequence: 4, step: 2, phase: 'endOfTurn', source: { kind: 'rune', id: 'rune_coffers', label: 'Coffers' }, trigger: 'endOfTurn', policy: 'ownBeat', family: 'endOfTurn' },
  ] as PresentationBatch['events'],
});

describe('the Lab schedules on the live engine — byte equivalence', () => {
  it('with no draft, the schedule IS compileTimeline with the shipped config', () => {
    const b = batch();
    const lab = labSchedule(b, {}, {});
    const live = compileTimeline(normalizePresentationBatch(b), { config: shippedBeatConfig() });
    expect(JSON.stringify(lab.timeline)).toBe(JSON.stringify(live));
    // …and the re-projected beats carry the compiled numbers verbatim.
    expect(lab.beats.map((x) => [x.startMs, x.consequenceMs, x.endMs, x.nextMs]))
      .toEqual(live.beats.map((x) => [x.startMs, x.deliveryMs, x.completionMs, x.recoveryEndMs]));
  });

  it('a v1 draft edit re-paces the Lab exactly as the same patch would re-pace live', () => {
    const b = batch();
    const draft = { 'source:rune:rune_lapidary:endOfTurn': { windupMs: 0, holdMs: 1200, recoveryMs: 0 } };
    const lab = labSchedule(b, draft, {});
    const live = compileTimeline(normalizePresentationBatch(b), {
      config: shippedBeatConfig(),
      draft: draftToEngine(draft, {}).draft,
    });
    expect(JSON.stringify(lab.timeline)).toBe(JSON.stringify(live));
    expect(lab.beats[0]!.endMs).toBe(1200);
  });

  it('a policy toggle re-bases the preview exactly as it re-bases live', () => {
    const b = batch('foldedCue');
    const toggled = labSchedule(b, {}, { 'source:rune:rune_lapidary:endOfTurn': 'ownBeat' });
    const untouched = labSchedule(b, {}, {});
    expect(toggled.beats[0]!.endMs).toBeGreaterThan(untouched.beats[0]!.endMs); // ownBeat holds; foldedCue barely does
    expect(toggled.timeline.beats[0]!.mode).toBe('ownBeat');
  });
});

describe('the live behaviours the old scheduler could not show', () => {
  it('a folded child now previews INSIDE its parent, not as a queued sequential beat', () => {
    const lab = labSchedule(batch('ownBeat', true), {}, {});
    const parent = lab.beats.find((x) => x.trigger.id === 't1')!;
    const child = lab.beats.find((x) => x.trigger.id === 't2')!;
    const after = lab.beats.find((x) => x.trigger.id === 't3')!;
    expect(child.startMs).toBe(parent.consequenceMs); // reacts at the parent's delivery
    expect(after.startMs).toBe(parent.nextMs); // …and buys the next ROOT no extra time
  });

  it('multi-target consequences land STAGGERED, not all at the windup point', () => {
    const lab = labSchedule(batch(), {}, {});
    const at1 = lab.consequenceAtMs.get('c1')!;
    const at2 = lab.consequenceAtMs.get('c2')!;
    expect(at2).toBeGreaterThan(at1);
  });
});

describe('the vocabulary bridges', () => {
  it('draftToEngine maps the four policy words onto the three modes', () => {
    const { modeDraft } = draftToEngine({}, { a: 'ownBeat', b: 'foldedCue', c: 'passive', d: 'intentionallySilent' });
    expect(modeDraft).toEqual({ a: 'ownBeat', b: 'reactInsideParent', c: 'silent', d: 'silent' });
  });

  it('labEffectiveTiming reads windup/hold/recovery off the compiled beat', () => {
    const lab = labSchedule(batch(), {}, {});
    const eff = labEffectiveTiming(lab.timeline.beats[0]!);
    expect(eff.timing.windupMs).toBe(lab.timeline.beats[0]!.config.deliveryOffsetMs);
    expect(eff.timing.holdMs).toBe(lab.timeline.beats[0]!.config.completionOffsetMs - lab.timeline.beats[0]!.config.deliveryOffsetMs);
  });

  it('modeToPolicyWord round-trips the registry word when it can', () => {
    expect(modeToPolicyWord('silent', 'intentionallySilent')).toBe('intentionallySilent');
    expect(modeToPolicyWord('silent', 'passive')).toBe('passive');
    expect(modeToPolicyWord('reactInsideParent', undefined)).toBe('foldedCue');
  });
});

describe('hold-only edits survive the vocabulary bridge (live-caught regression, PR 18)', () => {
  // Typed hold=1200 in the inspector, field read back 1080: a SPARSE hold patch migrated as
  // `completion = 0 + hold`, and the nonzero default wind-up ate the difference. The editor now writes
  // DENSE patches; this pins the engine-side arithmetic that made the sparse form lossy.
  it('a dense patch keeps the typed hold exactly', () => {
    const b = batch();
    const dense = { 'source:rune:rune_lapidary:endOfTurn': { windupMs: 120, holdMs: 1200, recoveryMs: 170 } };
    const lab = labSchedule(b, dense, {});
    const beat = lab.beats[0]!;
    expect(beat.consequenceMs - beat.startMs).toBe(120); // wind-up preserved
    expect(beat.endMs - beat.consequenceMs).toBe(1200); // hold is EXACTLY what was typed
  });

  it('documents WHY sparse was lossy: hold-only migrates against a zero wind-up', () => {
    const b = batch();
    const sparse = { 'source:rune:rune_lapidary:endOfTurn': { holdMs: 1200 } };
    const lab = labSchedule(b, sparse, {});
    const beat = lab.beats[0]!;
    // completion pins to 1200 absolute while delivery stays at the default 120 → displayed hold 1080.
    expect(beat.endMs - beat.consequenceMs).toBe(1080);
  });
});
