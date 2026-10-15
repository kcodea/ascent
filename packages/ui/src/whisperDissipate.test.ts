import { describe, expect, it } from 'vitest';
import {
  mergeWhisperFade, planWhisperDissipate, whisperDissipateTotalMs,
  WHISPER_DISSIPATE_CAP_MS, WHISPER_DISSIPATE_MS, WHISPER_DISSIPATE_STAGGER_MS,
} from './whisperDissipate';

/** Owner 2026-10-14: "whispers need to coalesce/dissipate when unused at end of turn and not just immediately go away". */
const isWhisper = (id: string): boolean => id.startsWith('w_');
const c = (uid: string, cardId: string) => ({ uid, cardId });

describe('whisper dissipate: the plan', () => {
  it('only Whispers dissipate, in hand order, staggered ~80 ms, under ~600 ms in all', () => {
    const plan = planWhisperDissipate([c('a', 'm1'), c('b', 'w_tome'), c('d', 'm2'), c('e', 'w_rune')], isWhisper);
    expect(plan).toEqual([{ uid: 'b', index: 1, delayMs: 0 }, { uid: 'e', index: 3, delayMs: WHISPER_DISSIPATE_STAGGER_MS }]);
    expect(WHISPER_DISSIPATE_STAGGER_MS).toBe(80);
    expect(whisperDissipateTotalMs(plan)).toBeLessThanOrEqual(WHISPER_DISSIPATE_CAP_MS);
    expect(WHISPER_DISSIPATE_CAP_MS).toBeLessThanOrEqual(600);
  });

  it('a full hand of Whispers squeezes the stagger so the last one still ends inside the cap', () => {
    const hand = Array.from({ length: 10 }, (_, i) => c(`u${i}`, 'w_tome'));
    const plan = planWhisperDissipate(hand, isWhisper);
    expect(plan.map((p) => p.uid)).toEqual(hand.map((h) => h.uid));
    for (let k = 1; k < plan.length; k++) expect(plan[k]!.delayMs).toBeGreaterThanOrEqual(plan[k - 1]!.delayMs);
    expect(whisperDissipateTotalMs(plan)).toBeLessThanOrEqual(WHISPER_DISSIPATE_CAP_MS);
  });

  it('nothing to dissipate: an empty plan, zero time (End Turn is untouched)', () => {
    expect(planWhisperDissipate([c('a', 'm1')], isWhisper)).toEqual([]);
    expect(whisperDissipateTotalMs([])).toBe(0);
    expect(whisperDissipateTotalMs(planWhisperDissipate([c('b', 'w_x')], isWhisper))).toBe(WHISPER_DISSIPATE_MS);
  });
});

describe('whisper dissipate: the hand row', () => {
  const plan = planWhisperDissipate([c('a', 'm1'), c('b', 'w_tome'), c('d', 'm2'), c('e', 'w_rune')], isWhisper);
  const ghosts = new Map([['b', { uid: 'b' }], ['e', { uid: 'e' }]]);

  it('before the commit (the EoT beats still show the old hand) the row is unchanged, same array', () => {
    const row = [{ uid: 'a' }, { uid: 'b' }, { uid: 'd' }, { uid: 'e' }];
    expect(mergeWhisperFade(row, plan, ghosts, new Set())).toBe(row);
  });

  it('after the commit removes them, each still-fading Whisper is held at its own slot (no gap closes mid-fade)', () => {
    const committed = [{ uid: 'a' }, { uid: 'd' }];
    expect(mergeWhisperFade(committed, plan, ghosts, new Set()).map((x) => x.uid)).toEqual(['a', 'b', 'd', 'e']);
  });

  it('a Whisper whose fade ended leaves the row at once, before or after the commit, and never comes back', () => {
    const before = [{ uid: 'a' }, { uid: 'b' }, { uid: 'd' }, { uid: 'e' }];
    expect(mergeWhisperFade(before, plan, ghosts, new Set(['b'])).map((x) => x.uid)).toEqual(['a', 'd', 'e']);
    const after = [{ uid: 'a' }, { uid: 'd' }];
    expect(mergeWhisperFade(after, plan, ghosts, new Set(['b'])).map((x) => x.uid)).toEqual(['a', 'd', 'e']);
    expect(mergeWhisperFade(after, plan, ghosts, new Set(['b', 'e'])).map((x) => x.uid)).toEqual(['a', 'd']);
  });

  it('cards granted after the commit (End-of-Turn grants) keep their places behind the held ghosts', () => {
    const after = [{ uid: 'a' }, { uid: 'd' }, { uid: 'g1' }];
    expect(mergeWhisperFade(after, plan, ghosts, new Set()).map((x) => x.uid)).toEqual(['a', 'b', 'd', 'e', 'g1']);
  });
});
