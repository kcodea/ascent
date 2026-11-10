/**
 * R-VERSUS-CANDIDATE-DEDUPE-01: an identical shop candidate is uploaded once, and the mark is forgotten whenever the room
 * may no longer hold that board (so the newest-board rule, R-VERSUS-AUTO-NEWEST-BOARD-01, always has the real one).
 */
import { describe, expect, it } from 'vitest';
import { createCandidateDedupe } from './candidateDedupe';

const side = (n: number) => ({ board: Array.from({ length: n }, (_, i) => ({ uid: `m${i}`, attack: 2, health: 3 })), state: { tier: 2 } });

describe('createCandidateDedupe (R-VERSUS-CANDIDATE-DEDUPE-01)', () => {
  it('THE WASTE: the same board went up on every run change. Now an identical candidate for the round is skipped', () => {
    const d = createCandidateDedupe();
    expect(d.next('m', 3, [side(4), { runes: [] }])).not.toBeNull(); // the first one goes
    expect(d.next('m', 3, [side(4), { runes: [] }])).toBeNull(); // a Shop refresh: the board is the same
    expect(d.next('m', 3, [side(4), { runes: [] }])).toBeNull();
    expect(d.next('m', 3, [side(5), { runes: [] }])).not.toBeNull(); // a buy: it changed
    expect(d.next('m', 3, [side(5), { runes: ['x'] }])).not.toBeNull(); // the scout changed
  });

  it('a new round, or another match, always sends (the room dropped last round\'s candidate)', () => {
    const d = createCandidateDedupe();
    d.next('m', 3, [side(4)]);
    expect(d.next('m', 4, [side(4)])).not.toBeNull();
    expect(d.next('n', 4, [side(4)])).not.toBeNull();
  });

  it('a send that failed is forgotten: the same board goes out again', () => {
    const d = createCandidateDedupe();
    const mark = d.next('m', 3, [side(4)])!;
    d.failed(mark);
    expect(d.next('m', 3, [side(4)])).not.toBeNull();
  });

  it('a stale failure never clears a newer mark', () => {
    const d = createCandidateDedupe();
    const old = d.next('m', 3, [side(4)])!;
    d.next('m', 3, [side(5)]); // a newer candidate went out and landed
    d.failed(old); // the older send fails late
    expect(d.next('m', 3, [side(5)])).toBeNull();
  });

  it('a lock, an un-ready or a reconnect resets it: the next candidate goes out whatever it is', () => {
    const d = createCandidateDedupe();
    d.next('m', 3, [side(4)]);
    d.reset();
    expect(d.next('m', 3, [side(4)])).not.toBeNull();
  });
});
