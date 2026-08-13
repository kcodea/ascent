import { describe, it, expect } from 'vitest';
import { makeCollector, NOOP_COLLECTOR, type PresentationCollector } from './collector';
import type { SourceTriggerEvent, ConsequenceEvent } from './events';

/** BEAT SYSTEM PR 2 — collector determinism + nesting + no-op equivalence (blueprint §22.1). */
const src = (id: string) => ({ kind: 'minion' as const, id, side: 'player' as const });
const buff = (uid: string, attack: number, health: number) =>
  ({ type: 'statsChanged' as const, target: { zone: 'board' as const, uid }, attack, health, permanent: true });

const triggers = (c: PresentationCollector) => (c.finish()?.events ?? []).filter((e): e is SourceTriggerEvent => e.type === 'sourceTrigger');
const consequences = (c: PresentationCollector) => (c.finish()?.events ?? []).filter((e): e is ConsequenceEvent => e.type !== 'sourceTrigger');

describe('presentation collector', () => {
  it('stamps deterministic, batch-local ids', () => {
    const c = makeCollector('play:abc', 'recruit');
    c.withTrigger({ phase: 'recruit', source: src('m1'), trigger: 'onPlay', policy: 'ownBeat' }, () => c.emit(buff('t1', 2, 2)));
    const batch = c.finish()!;
    expect(batch.id).toBe('batch:play:abc');
    expect(batch.events.map((e) => e.id)).toEqual(['trigger:play:abc:0', 'event:play:abc:1']);
  });

  it('is byte-identical across two identical resolutions (no time/random)', () => {
    const run = () => {
      const c = makeCollector('endOfTurn', 'endOfTurn');
      c.withTrigger({ phase: 'endOfTurn', source: src('m1'), trigger: 'endOfTurn', policy: 'ownBeat' }, () => c.emit(buff('t1', 1, 1)));
      return JSON.stringify(c.finish());
    };
    expect(run()).toBe(run());
  });

  it('attributes consequences to the active trigger via parentId', () => {
    const c = makeCollector('a', 'recruit');
    c.withTrigger({ phase: 'recruit', source: src('m1'), trigger: 'onPlay', policy: 'ownBeat' }, () => c.emit(buff('t1', 2, 2)));
    const [trig] = triggers(c);
    const [cons] = consequences(c);
    expect(cons!.parentId).toBe(trig!.id);
  });

  it('nests child triggers under their parent and shares the parent step by default only when asked', () => {
    const c = makeCollector('a', 'recruit');
    c.withTrigger({ phase: 'recruit', source: src('shout'), trigger: 'onPlay', policy: 'ownBeat' }, () => {
      c.withTrigger({ phase: 'recruit', source: src('adjacent'), trigger: 'onPlay', policy: 'foldedCue', boundary: 'currentStep' }, () => c.emit(buff('t', 1, 1)));
    });
    const [parent, child] = triggers(c);
    expect(child!.parentId).toBe(parent!.id);
    expect(child!.step).toBe(parent!.step); // currentStep folds into the parent's step
  });

  it('newStep boundary advances the resolution step for each own beat', () => {
    const c = makeCollector('a', 'endOfTurn');
    c.withTrigger({ phase: 'endOfTurn', source: src('m1'), trigger: 'endOfTurn', policy: 'ownBeat' }, () => {});
    c.withTrigger({ phase: 'endOfTurn', source: src('m2'), trigger: 'endOfTurn', policy: 'ownBeat' }, () => {});
    const [a, b] = triggers(c);
    expect(b!.step).toBeGreaterThan(a!.step);
  });

  it('finish() returns null when nothing was recorded', () => {
    expect(makeCollector('a', 'recruit').finish()).toBeNull();
  });

  it('survives an imbalanced scope without corrupting later attribution', () => {
    const c = makeCollector('a', 'recruit');
    const stray = c.beginTrigger({ phase: 'recruit', source: src('leak'), trigger: 'onPlay', policy: 'ownBeat' });
    // deliberately never end `stray`, then run a clean scope
    c.endTrigger(stray);
    c.withTrigger({ phase: 'recruit', source: src('clean'), trigger: 'onPlay', policy: 'ownBeat' }, () => c.emit(buff('t', 1, 1)));
    const cleanTrigger = triggers(c).find((t) => t.source.id === 'clean')!;
    expect(consequences(c)[0]!.parentId).toBe(cleanTrigger.id);
  });

  it('NOOP collector records nothing and runs the body', () => {
    let ran = false;
    NOOP_COLLECTOR.withTrigger({ phase: 'recruit', source: src('m'), trigger: 'onPlay', policy: 'ownBeat' }, () => { ran = true; NOOP_COLLECTOR.emit(buff('t', 9, 9)); });
    expect(ran).toBe(true);
    expect(NOOP_COLLECTOR.finish()).toBeNull();
    expect(NOOP_COLLECTOR.enabled).toBe(false);
  });
});
