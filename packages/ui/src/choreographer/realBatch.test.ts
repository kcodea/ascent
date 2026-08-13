import { describe, it, expect } from 'vitest';
import { createRun, reduce, reduceWithPresentation, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';

/**
 * BEAT CHOREOGRAPHER PR 2 — the compiler against REAL gameplay emission.
 *
 * The synthetic tests prove the compiler's rules. This one proves the rules survive contact with the actual
 * End-of-Turn batch — which is the thing the current Beat Lab never established, and precisely why a green
 * lab could coexist with a broken screen. A synthetic fixture passing is not evidence that real emission works.
 */
const faceOmen = { type: 'faceOmen' } as never;

function eotRun(): RunState {
  const run = createRun(3, 'warden');
  return {
    ...run,
    phase: 'recruit',
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    runeCoffers: true,
    runeShopkeep: true,
    runeLapidary: true,
    upgradeCost: 9,
    playedThisTurn: ['a', 'b', 'c'],
  } as RunState;
}

const compileReal = (state: RunState) => {
  const { batch } = reduceWithPresentation(state, faceOmen, true);
  return compileTimeline(normalizePresentationBatch(batch!));
};

describe('a real End-of-Turn batch compiles', () => {
  it('produces beats and a non-zero duration', () => {
    const t = compileReal(eotRun());
    expect(t.phase).toBe('endOfTurn');
    expect(t.beats.length).toBeGreaterThan(0);
    expect(t.durationMs).toBeGreaterThan(0);
  });

  it('carries PR 1 identity all the way to the compiled beat', () => {
    const t = compileReal(eotRun());
    const lapidary = t.beats.find((b) => b.source.id === 'rune_lapidary');
    expect(lapidary, 'the Lapidary reached the timeline').toBeTruthy();
    expect(lapidary!.policyKey).toBe('rune:rune_lapidary:endOfTurn');
    expect(lapidary!.family).toBe('endOfTurn');
  });

  it('has NO structural diagnostics — real emission is well-formed', () => {
    const t = compileReal(eotRun());
    const structural = t.diagnostics.filter((d) => d.severity === 'error');
    expect(structural, JSON.stringify(structural, null, 2)).toHaveLength(0);
  });

  it('every emitted beat is registry-identified (no missingPolicyKey warnings for End of Turn)', () => {
    const t = compileReal(eotRun());
    const unmigrated = t.diagnostics.filter((d) => d.code === 'missingPolicyKey');
    expect(unmigrated, unmigrated.map((d) => d.message).join('\n')).toHaveLength(0);
  });

  it('no consequence is delivered before the beat that caused it has visibly started', () => {
    const t = compileReal(eotRun());
    const beats = new Map(t.beats.map((b) => [b.id, b]));
    for (const d of t.consequenceDeliveries) {
      const beat = beats.get(d.beatId)!;
      expect(d.atMs, `${beat.source.label ?? beat.source.id} delivered before it acted`).toBeGreaterThanOrEqual(beat.startMs);
    }
  });

  it('beats are ordered by gameplay resolution order (board minions before recurring rewards)', () => {
    const t = compileReal(eotRun());
    const minion = t.beats.findIndex((b) => b.source.kind === 'minion');
    const rune = t.beats.findIndex((b) => b.source.id === 'rune_lapidary');
    if (minion >= 0 && rune >= 0) expect(minion).toBeLessThan(rune);
  });

  it('compiling does not resolve gameplay a second time', () => {
    const s = eotRun();
    const plain = reduce(s, faceOmen);
    const { state, batch } = reduceWithPresentation(s, faceOmen, true);
    compileTimeline(normalizePresentationBatch(batch!));
    // Compilation is pure: the resolved state is untouched by it, and equals the uninstrumented result.
    expect(JSON.stringify(state)).toBe(JSON.stringify(plain));
  });

  it('is deterministic against real emission', () => {
    const s = eotRun();
    expect(JSON.stringify(compileReal(s))).toBe(JSON.stringify(compileReal(s)));
  });
});
