import { describe, expect, it } from 'vitest';
import {
  STRENGTH_REF_VERSION, lastReferenceRound, loadStrengthReference, scoreBoard, type StrengthReference,
} from './boardStrength';
import type { BoardSnapshot } from '../snapshot';

/**
 * Strength v2 (design 2026-11-16, section 6.A + 6.B): the game reads reference `set2-v2`, and one probe scores a
 * board against ANY reference round, so a run's final board can be scored at the rounds it never reached.
 */
describe('strength reference v2 and the any-round probe', () => {
  let ref: StrengthReference;
  const subject = (round: number, i = 5): BoardSnapshot => ({ ...ref.waves[String(round)]![i]!, setId: ref.setId, wave: round });

  it('loads set2-v2: 40 boards for each of rounds 1-15, 4 fights each', async () => {
    ref = await loadStrengthReference();
    expect(ref.version).toBe('set2-v2');
    expect(STRENGTH_REF_VERSION).toBe('set2-v2');
    expect(ref.fightsPerRef).toBe(4);
    for (let r = 1; r <= 15; r++) expect(ref.waves[String(r)]?.length, `round ${r}`).toBe(40);
    expect(lastReferenceRound(ref)).toBe(15);
  });

  it('scoring at the board\'s own round is the default', () => {
    const b = subject(7);
    expect(scoreBoard(b, ref, 7)).toEqual(scoreBoard(b, ref));
  });

  it('scores a round-7 board against round 12: 160 fights, in round 12\'s bucket', () => {
    const s = scoreBoard(subject(7), ref, 12)!;
    expect(s.wave).toBe(12);
    expect(s.fights).toBe(160);
    expect(s.ref).toBe('set2-v2');
    expect(s.raw).toBeGreaterThanOrEqual(0);
    expect(s.raw).toBeLessThanOrEqual(1);
  });

  it('is deterministic, and a later round is a harder test', () => {
    const b = subject(7, 20);
    const at8 = scoreBoard(b, ref, 8)!;
    const at12 = scoreBoard(b, ref, 12)!;
    expect(scoreBoard(b, ref, 8)).toEqual(at8);
    expect(scoreBoard(b, ref, 12)).toEqual(at12);
    expect(at12.raw).toBeLessThanOrEqual(at8.raw);
  });

  it('does not score an empty board, at any round', () => {
    expect(scoreBoard({ ...subject(7), minions: [] }, ref, 12)).toBeNull();
  });

  it('a round past the reference is scored against the last reference round', () => {
    expect(scoreBoard(subject(15), ref, 19)!.wave).toBe(15);
  });
});
