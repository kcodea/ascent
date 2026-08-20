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

/**
 * RUNE OF LASTING CADENCE — "End of Turn: trigger all your Rally effects."
 *
 * The owner's requirement for this rune was explicitly about TIME: "make sure there's room for the beat to
 * play and go through any and all animations." A batched payout would compile to ONE beat and resolve every
 * rally inside a single window. These assert the opposite all the way through the real compiler: N rallies →
 * N compiled beats, each sourced on the minion that rallied, and the timeline grows to make room.
 */
describe('Rune of Lasting Cadence — one compiled beat per rally, with room to play', () => {
  const cadenceRun = (ralliers: number): RunState => {
    const base = createRun(3, 'warden');
    return {
      ...base,
      phase: 'recruit',
      board: Array.from({ length: ralliers }, (_, i) => ({
        uid: `r${i}`, cardId: 'd2_cinderchef', tribe: 'dragon', attack: 1, health: 3,
        keywords: ['RL'], golden: false,
      })),
      runeLastingCadence: true,
    } as RunState;
  };

  it('compiles ONE beat per rally, sourced on the rallying minion', () => {
    const t = compileReal(cadenceRun(3));
    const beats = t.beats.filter((b) => b.policyKey === 'rune:rune_lasting_cadence:endOfTurn');
    expect(beats, 'three rallies, three beats').toHaveLength(3);
    expect(beats.map((b) => b.source.uid)).toEqual(['r0', 'r1', 'r2']);
    expect(new Set(beats.map((b) => b.source.kind))).toEqual(new Set(['minion']));
  });

  it('the TIMELINE grows with the rally count — the animation is allotted real time', () => {
    const one = compileReal(cadenceRun(1));
    const four = compileReal(cadenceRun(4));
    expect(one.durationMs, 'a single rally already reserves a window').toBeGreaterThan(0);
    expect(four.durationMs, 'four rallies reserve strictly more time than one').toBeGreaterThan(one.durationMs);
  });

  it('no structural diagnostics — the rally beats are well-formed', () => {
    expect(compileReal(cadenceRun(3)).diagnostics).toEqual([]);
  });

  it('unarmed, the rune contributes no beats at all', () => {
    // The same board with the rune off emits NOTHING — no batch, so nothing to compile and no window held.
    const bare = { ...cadenceRun(3), runeLastingCadence: undefined } as RunState;
    const { batch } = reduceWithPresentation(bare, faceOmen, true);
    const rallyTriggers = (batch?.events ?? []).filter(
      (e) => (e as { policyKey?: string }).policyKey === 'rune:rune_lasting_cadence:endOfTurn',
    );
    expect(rallyTriggers).toHaveLength(0);
  });
});
