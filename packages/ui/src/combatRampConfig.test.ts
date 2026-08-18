import { describe, expect, it } from 'vitest';
import { buildAuthoredTimeline, rampSpeed, type CombatRampConfig } from './combatRampConfig';

const CFG: CombatRampConfig = { graceMs: 2000, rampUpMs: 4000, ceiling: 3, tailMs: 5000 };
const FAR = 1_000_000; // "lots of time left" — keeps the down-curve pinned at ceiling

describe('rampSpeed', () => {
  it('holds at base during the grace window', () => {
    expect(rampSpeed(1, 0, FAR, CFG)).toBeCloseTo(1);
    expect(rampSpeed(1, 1999, FAR, CFG)).toBeCloseTo(1);
  });

  it('reaches the ceiling after grace + rampUp', () => {
    expect(rampSpeed(1, CFG.graceMs + CFG.rampUpMs, FAR, CFG)).toBeCloseTo(3);
    expect(rampSpeed(1, CFG.graceMs + CFG.rampUpMs + 5000, FAR, CFG)).toBeCloseTo(3);
  });

  it('climbs monotonically between grace and full ramp', () => {
    const a = rampSpeed(1, 3000, FAR, CFG);
    const b = rampSpeed(1, 4000, FAR, CFG);
    const c = rampSpeed(1, 5000, FAR, CFG);
    expect(a).toBeGreaterThan(1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(3);
  });

  it('eases back to base as the fight ends (down-curve)', () => {
    expect(rampSpeed(1, FAR, 0, CFG)).toBeCloseTo(1);         // no time left → base
    expect(rampSpeed(1, FAR, CFG.tailMs, CFG)).toBeCloseTo(3); // exactly at tail → ceiling
    const mid = rampSpeed(1, FAR, 2500, CFG);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(3);
  });

  it('short fight (little time left) never really speeds up', () => {
    // elapsed is large but only 1s of authored time remains → min() picks the low down-curve
    const s = rampSpeed(1, FAR, 1000, CFG);
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThan(3);
  });

  it('is a no-op when base is already at/above the ceiling', () => {
    expect(rampSpeed(5, FAR, FAR, CFG)).toBeCloseTo(5);
    expect(rampSpeed(3, FAR, FAR, CFG)).toBeCloseTo(3);
  });

  it('never leaves the [base, ceiling] band across a sweep', () => {
    for (let e = 0; e <= 12000; e += 250) {
      for (let r = 0; r <= 12000; r += 250) {
        const s = rampSpeed(1, e, r, CFG);
        expect(s).toBeGreaterThanOrEqual(1 - 1e-9);
        expect(s).toBeLessThanOrEqual(3 + 1e-9);
      }
    }
  });
});

describe('buildAuthoredTimeline', () => {
  it('sums inter-beat holds and adds the final hold', () => {
    // beats carry a cumulative marker; holdAt returns the gap into each beat
    const beats = [0, 10, 30, 60];
    const t = buildAuthoredTimeline(beats, (next, prev) => next - prev, 100);
    expect(t.totalMs).toBe(160);            // 60 + finalHold 100
    expect(t.remainingAt(0)).toBe(160);
    expect(t.remainingAt(1)).toBe(150);
    expect(t.remainingAt(3)).toBe(100);     // only the final hold left
    expect(t.remainingAt(99)).toBe(100);    // clamps past the end
  });

  it('handles an empty beats array', () => {
    const t = buildAuthoredTimeline<number>([], () => 0, 100);
    expect(t.totalMs).toBe(100);
    expect(t.remainingAt(0)).toBe(100);
  });
});
