import { describe, expect, it } from 'vitest';
import { createOddsStepper } from './oddsStepper';

/** A probe of `total` sims, each costing `perSimMs` on a fake clock. Records every step size it was asked for. */
function fakeProbe(total: number, perSimMs: number) {
  let clock = 0; let i = 0; const sizes: number[] = [];
  return {
    now: () => clock,
    sizes,
    progress: () => i,
    probe: { step(n: number): boolean { const end = Math.min(total, i + n); sizes.push(end - i); clock += (end - i) * perSimMs; i = end; return i >= total; } },
  };
}

describe('createOddsStepper', () => {
  it('measures on one sim, then sizes steps to the target (a cheap early-game sim takes the full ten)', () => {
    const f = fakeProbe(200, 0.1);
    const s = createOddsStepper(f.probe, f.now, 2, 10);
    while (!s.step()) { /* drain */ }
    expect(f.sizes[0]).toBe(1);
    expect(Math.max(...f.sizes)).toBe(10);
    expect(f.progress()).toBe(200);
  });

  it('keeps an expensive (late-game / phone) sim at one per step, so no step is a long task', () => {
    const f = fakeProbe(200, 6); // a 4x-throttled 7v7 sim
    const s = createOddsStepper(f.probe, f.now, 2, 10);
    while (!s.step()) { /* drain */ }
    expect(new Set(f.sizes)).toEqual(new Set([1]));
    expect(f.sizes.reduce((a, b) => a + b, 0)).toBe(200); // every sim ran exactly once
  });

  it('keeps every step within the target once the cost is known', () => {
    const f = fakeProbe(200, 0.45);
    const s = createOddsStepper(f.probe, f.now, 2, 10);
    while (!s.step()) { /* drain */ }
    for (const n of f.sizes.slice(1)) expect(n * 0.45).toBeLessThanOrEqual(2);
    expect(f.sizes.slice(1, -1).every((n) => n === 4)).toBe(true); // the last step is whatever remains
  });
});
