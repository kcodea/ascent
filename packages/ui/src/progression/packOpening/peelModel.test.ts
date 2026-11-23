import { describe, expect, it } from 'vitest';
import { DEFAULT_PACK_FEEL as feel } from './packFxConfig';
import {
  newSleeve, newTear, releaseSleeve, releaseTear, stepSleeve, stepTear,
  type SleeveState, type TearState, type Vec3,
} from './peelModel';

const W = 300;
const DT = 1;
const CLEAR = 400;
const v = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });
const reach = (s: TearState): number => Math.hypot(s.hand.x - s.T, s.hand.y, s.hand.z);

/** Pops the seal with a straight-up pull (hand ends up LEFT of the tear front, so nothing advances yet). */
function popped(): TearState {
  const s = newTear();
  const r = stepTear(s, { held: true, target: v(0, -40) }, feel, W, DT, 0);
  expect(r.popped).toBe(true);
  return s;
}

/** Holds a target relative to the current tear front for n steps; returns the time used. */
function hold(s: TearState, n: number, dx: number, dy: number, t0 = 0): number {
  let t = t0;
  for (let i = 0; i < n; i++, t += DT) stepTear(s, { held: true, target: v(s.T + dx, dy) }, feel, W, DT, t);
  return t;
}

describe('peelModel: the tear', () => {
  it('the seal holds until the pull passes the pop tension', () => {
    const s = newTear();
    for (let i = 0; i < 60; i++) {
      const r = stepTear(s, { held: true, target: v(20, -20) }, feel, W, DT, i); // hypot = 28.3 < 30
      expect(r.popped).toBe(false);
      expect(s.started).toBe(false);
      expect(s.T).toBeLessThanOrEqual(10.5);
    }
    let pops = 0;
    for (let i = 0; i < 10; i++) if (stepTear(s, { held: true, target: v(40, -10) }, feel, W, DT, i).popped) pops++;
    expect(pops).toBe(1);
    expect(s.started).toBe(true);
  });

  it('pulling along the tear line advances the tear', () => {
    const s = popped();
    const before = s.T;
    hold(s, 30, 200, 0);
    expect(s.T).toBeGreaterThan(before);
  });

  it('pulling back the other way never advances the tear (owner bug 2026-11-23)', () => {
    const s = popped();
    const before = s.T;
    for (let i = 0; i < 60; i++) {
      const r = stepTear(s, { held: true, target: v(s.T - 200, 0) }, feel, W, DT, i);
      expect(r.advanced).toBe(0);
    }
    expect(s.T).toBe(before);
  });

  it('the held edge never leaves the peeled length', () => {
    const s = newTear();
    const targets = [v(10, 0), v(40, -30), v(250, -60, 80), v(-80, 40, 20), v(300, 300, 139), v(0, -200)];
    let t = 0;
    for (const tg of targets) {
      for (let i = 0; i < 25; i++, t++) {
        stepTear(s, { held: true, target: v(s.T + tg.x, tg.y, tg.z) }, feel, W, DT, t);
        if (!s.done) expect(reach(s)).toBeLessThanOrEqual(s.T + 1e-6);
      }
      releaseTear(s);
      for (let i = 0; i < 10; i++, t++) {
        stepTear(s, { held: false, target: null }, feel, W, DT, t);
        if (!s.done) expect(reach(s)).toBeLessThanOrEqual(s.T + 1e-6);
      }
    }
  });

  it('max tear speed caps one step', () => {
    const s = popped();
    for (let i = 0; i < 200 && !s.done; i++) {
      const r = stepTear(s, { held: true, target: v(s.T + 400, -30, 139) }, feel, W, DT, i);
      expect(r.advanced).toBeLessThanOrEqual(feel.maxTearSpeed * DT + 1e-9);
    }
  });

  it('letting go mid-tear does not creep the tear', () => {
    // A lifted, up-and-along pull: the prototype's ungated rule crept ~2 px here as the corner swung to rest.
    const s = popped();
    for (let i = 0; i < 30; i++) stepTear(s, { held: true, target: v(s.T + 30, -30, 139) }, feel, W, DT, i);
    releaseTear(s);
    const at = s.T;
    for (let i = 0; i < 120; i++) stepTear(s, { held: false, target: null }, feel, W, DT, 100 + i);
    expect(s.T).toBe(at);
    expect(s.held).toBe(false);
  });

  it('releaseTear is idempotent and clears held', () => {
    const s = popped();
    hold(s, 5, 200, 0);
    expect(s.held).toBe(true);
    releaseTear(s);
    const snap = JSON.stringify(s);
    releaseTear(s);
    expect(s.held).toBe(false);
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('ripped fires once when T reaches the width', () => {
    const s = popped();
    let rips = 0;
    for (let i = 0; i < 600; i++) {
      if (stepTear(s, { held: true, target: v(s.T + 400, -20, 139) }, feel, W, DT, i).ripped) rips++;
    }
    expect(rips).toBe(1);
    expect(s.done).toBe(true);
    expect(s.held).toBe(false);
    expect(s.T).toBeGreaterThanOrEqual(W - 1);
  });
});

/** Holds the sleeve at a fixed pull for n steps (sleeve already freed if want > grip). */
function pull(s: SleeveState, want: number, n: number): void {
  for (let i = 0; i < n; i++) stepSleeve(s, { held: true, want, flickVy: 0 }, feel, CLEAR, DT);
}

describe('peelModel: the sleeve', () => {
  it('the sleeve does not slide before the grip distance', () => {
    const s = newSleeve();
    for (let i = 0; i < 100; i++) {
      const r = stepSleeve(s, { held: true, want: 79, flickVy: 0 }, feel, CLEAR, DT);
      expect(r.brokeFree).toBe(false);
    }
    expect(s.freed).toBe(false);
    expect(s.dy).toBeLessThanOrEqual(6 + 73 * 0.12 + 1e-6);
    const r = stepSleeve(s, { held: true, want: 81, flickVy: 0 }, feel, CLEAR, DT);
    expect(r.brokeFree).toBe(true);
    expect(s.freed).toBe(true);
  });

  it('an early release slides the sleeve back to 0', () => {
    const s = newSleeve();
    pull(s, 100, 60);
    expect(s.dy).toBeCloseTo(100, 1);
    expect(releaseSleeve(s, 0, feel).dropped).toBe(false);
    for (let i = 0; i < 200; i++) expect(stepSleeve(s, { held: false, want: 0, flickVy: 0 }, feel, CLEAR, DT).dropped).toBe(false);
    expect(s.dy).toBeLessThan(0.5);
    expect(s.falling).toBe(false);
  });

  it('release past the let-go distance drops it', () => {
    const s = newSleeve();
    pull(s, 300, 60);
    expect(s.dy).toBeGreaterThan(feel.sleeveLetGo);
    expect(releaseSleeve(s, 0, feel).dropped).toBe(true);
    expect(s.falling).toBe(true);
    expect(s.vy).toBe(5);
  });

  it('a flick drops it', () => {
    const s = newSleeve();
    pull(s, 81, 1);
    pull(s, 50, 60);
    expect(s.dy).toBeCloseTo(50, 1);
    expect(releaseSleeve(s, 10, feel).dropped).toBe(true);
    expect(s.vy).toBe(8);
  });

  it('dragging past the stack bottom drops it while held', () => {
    const s = newSleeve();
    let dropped = false;
    for (let i = 0; i < 300 && !dropped; i++) {
      dropped = stepSleeve(s, { held: true, want: CLEAR + 1, flickVy: 3 }, feel, CLEAR, DT).dropped;
    }
    expect(dropped).toBe(true);
    expect(s.falling).toBe(true);
    expect(s.held).toBe(false);
    expect(s.vy).toBe(6);
    // and it keeps falling under gravity
    const dy = s.dy;
    stepSleeve(s, { held: false, want: 0, flickVy: 0 }, feel, CLEAR, DT);
    expect(s.dy).toBeGreaterThan(dy);
  });

  it('releaseSleeve is idempotent', () => {
    const s = newSleeve();
    pull(s, 300, 60);
    expect(releaseSleeve(s, 0, feel).dropped).toBe(true);
    const snap = JSON.stringify(s);
    expect(releaseSleeve(s, 20, feel).dropped).toBe(false);
    expect(JSON.stringify(s)).toBe(snap);
    expect(s.held).toBe(false);
  });

  it('a step with held: false while held is treated as a release (pointercancel)', () => {
    const s = newSleeve();
    pull(s, 300, 60);
    expect(stepSleeve(s, { held: false, want: 0, flickVy: 0 }, feel, CLEAR, DT).dropped).toBe(true);
    expect(s.held).toBe(false);
  });

  it('rim lag and finger pinch build while held and relax after', () => {
    const s = newSleeve();
    pull(s, 81, 1);
    for (let i = 0; i < 4; i++) stepSleeve(s, { held: true, want: 81 + 40 * (i + 1), flickVy: 0 }, feel, CLEAR, DT);
    expect(s.lag).toBeGreaterThan(0);
    expect(s.pinch).toBeGreaterThan(0);
    releaseSleeve(s, 0, feel);
    for (let i = 0; i < 200; i++) stepSleeve(s, { held: false, want: 0, flickVy: 0 }, feel, CLEAR, DT);
    expect(s.lag).toBeLessThan(1e-3);
    expect(s.pinch).toBeLessThan(1e-3);
  });
});
