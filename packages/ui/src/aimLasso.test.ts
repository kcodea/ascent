import { describe, expect, it } from 'vitest';
import { createLassoState, stepLasso, type AimLassoCfg } from './aimLasso';

const CFG: AimLassoCfg = {
  segments: 12,
  curve: 0.3,
  curveVar: 0,
  springStiffness: 140,
  springDamping: 16,
  swayAmp: 6,
  swayFreq: 1.6,
  swaySpeed: 2,
  motionInfluence: 0.01,
};

const from = { x: 100, y: 400 };
const to = { x: 500, y: 400 };
// A deterministic rng so side/amp/seed are fixed across a test (side +1, amp 1.0, seed 0).
const fixedRng = (): number => 0.5;

/** Run the lasso to rest at a fixed cursor (no motion, no sway) so points settle onto the base bow. */
function settle(cfg: AimLassoCfg, steps = 400): { x: number; y: number }[] {
  const noSway: AimLassoCfg = { ...cfg, swayAmp: 0 };
  const st = createLassoState(from, to, noSway, fixedRng);
  let pts: { x: number; y: number }[] = [];
  for (let i = 0; i < steps; i++) pts = stepLasso(st, from, to, 0, 1 / 60, 0, noSway);
  return pts;
}

describe('createLassoState', () => {
  it('creates segments+1 points once stepped, endpoints pinned to from/to', () => {
    const st = createLassoState(from, to, CFG, fixedRng);
    const pts = stepLasso(st, from, to, 0, 1 / 60, 0, CFG);
    expect(pts.length).toBe(CFG.segments + 1);
    expect(pts[0]).toEqual(from);
    expect(pts[pts.length - 1]).toEqual(to);
  });
});

describe('rest shape', () => {
  it('idle + no sway settles interior points onto the base bow (finite, bowed off the chord)', () => {
    const pts = settle(CFG);
    // Every point finite.
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Control-point bow = len·curve·0.5 = 400·0.3·0.5 = 60; a quadratic Bézier at t=0.5 reaches half of that,
    // so the settled midpoint sits ~30px off the straight chord (y=400).
    const mid = pts[Math.floor(pts.length / 2)]!;
    expect(Math.abs(mid.y - 400)).toBeGreaterThan(25);
  });

  it('a settled chain barely moves on the next idle step (velocity has bled off)', () => {
    const noSway: AimLassoCfg = { ...CFG, swayAmp: 0 };
    const st = createLassoState(from, to, noSway, fixedRng);
    for (let i = 0; i < 400; i++) stepLasso(st, from, to, 0, 1 / 60, 0, noSway);
    const a = stepLasso(st, from, to, 0, 1 / 60, 0, noSway).map((p) => ({ ...p }));
    const b = stepLasso(st, from, to, 0, 1 / 60, 0, noSway);
    let maxMove = 0;
    for (let i = 0; i < a.length; i++) maxMove = Math.max(maxMove, Math.hypot(b[i]!.x - a[i]!.x, b[i]!.y - a[i]!.y));
    expect(maxMove).toBeLessThan(0.5);
  });
});

describe('motion reactivity', () => {
  it('higher cursor speed produces a larger perpendicular sway than idle', () => {
    // Measure peak deviation from the chord midline at a fixed sway PHASE, idle vs fast.
    const peakDev = (speed: number): number => {
      const st = createLassoState(from, to, CFG, fixedRng);
      let peak = 0;
      // step to a phase where sin is near its peak, sampling the mid point's distance off the base bow
      for (let i = 0; i < 30; i++) {
        const pts = stepLasso(st, from, to, speed, 1 / 60, 0.12, CFG);
        const mid = pts[Math.floor(pts.length / 2)]!;
        peak = Math.max(peak, Math.abs(mid.y - 400));
      }
      return peak;
    };
    expect(peakDev(2000)).toBeGreaterThan(peakDev(0) + 1);
  });

  it('a sudden cursor jump makes the interior LAG (not instantly on the new rest)', () => {
    const noSway: AimLassoCfg = { ...CFG, swayAmp: 0 };
    const st = createLassoState(from, to, noSway, fixedRng);
    for (let i = 0; i < 400; i++) stepLasso(st, from, to, 0, 1 / 60, 0, noSway); // settle at `to`
    const jumped = { x: 500, y: 100 }; // yank the cursor 300px up
    const oneStep = stepLasso(st, from, jumped, 0, 1 / 60, 0, noSway);
    // The rest midpoint after the jump is far from y=400; a lagging chain is still near the OLD shape.
    const mid = oneStep[Math.floor(oneStep.length / 2)]!;
    expect(Math.abs(mid.y - 400)).toBeLessThan(120); // hasn't snapped to the new bow yet
  });
});

describe('stability', () => {
  it('does not blow up over a long run with jittery input and clamped huge dt', () => {
    const st = createLassoState(from, to, CFG, fixedRng);
    let pts: { x: number; y: number }[] = [];
    for (let i = 0; i < 1000; i++) {
      const t = { x: 300 + Math.sin(i * 0.3) * 200, y: 300 + Math.cos(i * 0.21) * 150 };
      const dt = i % 50 === 0 ? 5 : 1 / 60; // occasional giant frame gap (tab stall) — must be clamped
      pts = stepLasso(st, from, t, 1500, dt, i / 60, CFG);
    }
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Math.abs(p.x)).toBeLessThan(1e5);
      expect(Math.abs(p.y)).toBeLessThan(1e5);
    }
  });
});

describe('live segment change', () => {
  it('resizes the interior when segments changes between steps', () => {
    const st = createLassoState(from, to, CFG, fixedRng);
    stepLasso(st, from, to, 0, 1 / 60, 0, CFG);
    const bigger = stepLasso(st, from, to, 0, 1 / 60, 0, { ...CFG, segments: 24 });
    expect(bigger.length).toBe(25);
    const smaller = stepLasso(st, from, to, 0, 1 / 60, 0, { ...CFG, segments: 6 });
    expect(smaller.length).toBe(7);
  });
});
