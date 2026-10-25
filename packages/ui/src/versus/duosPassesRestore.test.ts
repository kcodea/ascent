// @vitest-environment jsdom
/**
 * VERSUS DUOS — A RESTORED RUN'S PASSES LINE UP WITH THE SERVER BY IDENTITY (R-DUOS-PASS-01, phase-3 live test
 * 2026-10-25). The live bug: a pass the server refused up front ("Their hand is full") never gets a row, and the old
 * positional line-up then paired every later outbox entry with the wrong row, so after a reload the sender kept a card
 * the teammate had already received. Entries and rows now pair by card uid + round (+ refused with refunded).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const { lineUpOutbox } = await import('./duosPasses');

const entry = (wave: number, uid: string, refunded = false) => ({ wave, card: { uid }, ...(refunded ? { refunded: true as const } : {}) });
const row = (seq: number, round: number, uid: string, status: 'sent' | 'landed' | 'refused' = 'landed') => ({ seq, round, card: { uid }, status });

describe('lining a restored outbox up with the server rows', () => {
  it('the live case: an up-front refusal (no row), then two passes; the restored run has only the refusal', () => {
    // Round 7: b4 refused up front (refunded, no row). Round 8: b4 passed (seq 0), b9 passed (seq 1). The run came back
    // from its round-8 lock, so its outbox holds only the round-7 refusal.
    const plan = lineUpOutbox([entry(7, 'b4', true)], [row(0, 8, 'b4'), row(1, 8, 'b9')]);
    expect([...plan.seqOf]).toEqual([]); // the refunded entry is NOT the round-8 pass
    expect(plan.repass.map((r) => r.seq)).toEqual([0, 1]); // both are played again on the run (card leaves, Gold paid)
    expect(plan.unsent).toEqual([]);
  });

  it('a full outbox lines up whatever the server numbered, and a pass the server never saw still goes out', () => {
    const plan = lineUpOutbox(
      [entry(3, 'a', true), entry(3, 'a'), entry(4, 'c'), entry(4, 'd')],
      [row(5, 3, 'a'), row(6, 4, 'c')],
    );
    expect([...plan.seqOf].sort()).toEqual([[1, 5], [2, 6]]);
    expect(plan.repass).toEqual([]);
    expect(plan.unsent).toEqual([3]); // d: recorded on the run, never reached the server
  });

  it('a pass the receiver refused pairs with the refunded entry, not with a later pass of the same card', () => {
    const plan = lineUpOutbox(
      [entry(5, 'x', true), entry(5, 'x')],
      [row(0, 5, 'x', 'refused'), row(1, 5, 'x', 'sent')],
    );
    expect([...plan.seqOf].sort()).toEqual([[0, 0], [1, 1]]);
    expect(plan.repass).toEqual([]);
    expect(plan.unsent).toEqual([]);
  });
});
