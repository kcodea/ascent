import { describe, it, expect } from 'vitest';
import { coalesceBuffFxByTarget } from './buffFxConfig';

/**
 * `coalesceBuffFxByTarget` is the fix for the Brightwing Broker shop jank: K Brokers each capture a
 * source→target tendril to every OTHER minion, so a single buy emits K×(M−1) buff-FX events, each a
 * per-frame-retessellated ribbon. The target's stats jump ONCE (summed in the sim), so one tendril per target
 * is correct — and collapsing them is where the K-fold FX cut comes from.
 */
type Ev = { sourceUid: string; targetUid: string; fxWave?: number };

/** K Brokers buffing a board of size M: each Broker emits an event to every OTHER minion → K×(M−1) events. */
function brokerBuys(k: number, m: number): Ev[] {
  const ids = Array.from({ length: m }, (_, i) => `u${i}`);
  const evs: Ev[] = [];
  for (let s = 0; s < k; s++) for (const t of ids) if (t !== ids[s]) evs.push({ sourceUid: ids[s]!, targetUid: t });
  return evs;
}

describe('coalesceBuffFxByTarget', () => {
  it('collapses K Brightwings on an M-board from K×(M−1) events to exactly M targets', () => {
    // 3 Brokers, 6-minion board: 3×5 = 15 events in, one per distinct target out. Every minion is a target of
    // at least one Broker (each is buffed by the OTHER Brokers), so all 6 survive.
    const evs = brokerBuys(3, 6);
    expect(evs).toHaveLength(15);
    const out = coalesceBuffFxByTarget(evs);
    expect(out).toHaveLength(6); // one tendril per target, not 15
    expect(new Set(out.map((e) => e.targetUid)).size).toBe(6);
    // Worst case the owner can hit — a board of 7 Brokers: 7×6 = 42 events → 7 tendrils.
    expect(coalesceBuffFxByTarget(brokerBuys(7, 7))).toHaveLength(7);
  });

  it('keeps the FIRST event per target (a stable, deterministic source)', () => {
    const evs: Ev[] = [
      { sourceUid: 'a', targetUid: 'x' },
      { sourceUid: 'b', targetUid: 'x' }, // duplicate target → dropped
      { sourceUid: 'c', targetUid: 'y' },
    ];
    const out = coalesceBuffFxByTarget(evs);
    expect(out).toEqual([
      { sourceUid: 'a', targetUid: 'x' },
      { sourceUid: 'c', targetUid: 'y' },
    ]);
  });

  it('dedupes tagged events only WITHIN their own wave — the between-wave stagger survives', () => {
    // Itemized rewards (Blueprint Cache) tag events with fxWave; the same target appears in successive waves
    // (one pulse per step) and MUST NOT be collapsed across waves, or the step animation loses its beats.
    const evs: Ev[] = [
      { sourceUid: 's', targetUid: 'x', fxWave: 0 },
      { sourceUid: 's', targetUid: 'x', fxWave: 1 }, // same target, different wave → KEPT
      { sourceUid: 's', targetUid: 'x', fxWave: 1 }, // same target, same wave → dropped
    ];
    const out = coalesceBuffFxByTarget(evs);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.fxWave)).toEqual([0, 1]);
  });

  it('leaves an already-distinct set untouched (no false merges across different targets)', () => {
    const evs: Ev[] = [
      { sourceUid: 's', targetUid: 'a' },
      { sourceUid: 's', targetUid: 'b' },
      { sourceUid: 's', targetUid: 'c' },
    ];
    expect(coalesceBuffFxByTarget(evs)).toHaveLength(3);
  });
});
