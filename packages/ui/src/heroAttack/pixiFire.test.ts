/**
 * THE SHARED LIVE FIRE (owner 2026-09-29: "pixi style fire so it looks less like a flame image and more like actual
 * fire"): the colour ramp (white-hot to red), buoyancy (flames rise), the hard cap and the pool (never regrown), a
 * moving emitter spreading its births along its path (a continuous comet tail, never beads), timed emitters dying down
 * on their own, smoke left by dying flames, determinism, and clean teardown.
 */
import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import { FIRE_PALETTE, PixiFire, fireRamp, fireTexturesFrom } from './pixiFire';

const W = Texture.WHITE;
const TEX = fireTexturesFrom(W, W, W);

/** Every visible sprite in a layer container (0 smoke, 1 body | 2 flame, 3 embers). */
function visible(f: PixiFire): Sprite[] {
  const out: Sprite[] = [];
  for (const half of [f.back, f.front]) for (const layer of half.children as Container[]) for (const s of layer.children) if (s instanceof Sprite && s.visible) out.push(s);
  return out;
}

describe('the colour ramp', () => {
  it('runs white-hot -> yellow -> orange -> red -> a dark ember as a particle cools', () => {
    expect(fireRamp(FIRE_PALETTE, 0)).toBe(FIRE_PALETTE.core);
    expect(fireRamp(FIRE_PALETTE, 1)).toBe(FIRE_PALETTE.dark);
    expect(fireRamp(FIRE_PALETTE, 0.16)).toBe(FIRE_PALETTE.hot);
    expect(fireRamp(FIRE_PALETTE, 0.38)).toBe(FIRE_PALETTE.mid);
    expect(fireRamp(FIRE_PALETTE, 0.64)).toBe(FIRE_PALETTE.deep);
    // brightness falls monotonically along it
    const lum = (c: number): number => ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
    let prev = Infinity;
    for (let u = 0; u <= 1.0001; u += 0.05) { const l = lum(fireRamp(FIRE_PALETTE, u)); expect(l).toBeLessThanOrEqual(prev + 1e-6); prev = l; }
    expect(fireRamp(FIRE_PALETTE, Number.NaN)).toBe(FIRE_PALETTE.core);
  });
});

describe('the fire', () => {
  it('flames RISE (buoyancy) and cool; a stopped emitter burns out to nothing', () => {
    const f = new PixiFire(TEX, { cap: 400, seed: 3 });
    const e = f.emitter({ x: 500, y: 500, rate: 200, size: 30, life: 500, speed: 0, turb: 0 });
    for (let t = 0; t < 300; t += 16) f.update(16);
    expect(f.count).toBeGreaterThan(20);
    const ys = visible(f).map((s) => s.y);
    expect(ys.reduce((a, b) => a + b, 0) / ys.length).toBeLessThan(500); // on average above the source
    f.stop(e);
    expect(f.alive).toBe(true);
    for (let t = 0; t < 4000 && f.update(16); t += 16) { /* burn out */ }
    expect(f.count).toBe(0);
    expect(f.alive).toBe(false);
    expect(visible(f)).toHaveLength(0);
  });

  it('never exceeds its cap; the pool is reused, never regrown past the cap', () => {
    const f = new PixiFire(TEX, { cap: 120, seed: 5 });
    f.emitter({ shape: 'disc', x: 0, y: 0, r: 60, rate: 5000, size: 20, life: 800, embers: 200, smoke: 1 });
    let peak = 0;
    for (let t = 0; t < 1500; t += 16) { f.update(16); peak = Math.max(peak, f.count); }
    expect(peak).toBe(120);
    expect(f.pooled).toBeLessThanOrEqual(120); // one pool across the four layers (a free sprite is borrowed across)
    const pooled = f.pooled;
    f.burst(0, 0, { n: 500, radius: 40, speed: 400, size: 20, life: 400, embers: 50 });
    for (let t = 0; t < 1000; t += 16) f.update(16);
    expect(f.pooled).toBeLessThanOrEqual(120);
    expect(f.pooled).toBeGreaterThanOrEqual(pooled);
    f.destroy();
  });

  it('a MOVING emitter spreads its births along the path it swept (a continuous tail, not beads)', () => {
    const f = new PixiFire(TEX, { cap: 800, seed: 9 });
    const e = f.emitter({ x: 0, y: 500, rate: 3000, size: 20, life: 2000, speed: 0, lift: 0, turb: 0 });
    f.update(16); // born at x = 0
    e.x = 600; // a fast fireball: 600 px in one frame
    f.update(16);
    const xs = visible(f).map((s) => s.x).filter((x) => x > 5 && x < 595);
    expect(xs.length).toBeGreaterThan(10);
    // spread across the swept segment, not clumped at its end
    expect(Math.min(...xs)).toBeLessThan(200);
    expect(Math.max(...xs)).toBeGreaterThan(400);
    f.destroy();
  });

  it('a timed emitter burns, dies down and stops itself; dying flames leave smoke', () => {
    const f = new PixiFire(TEX, { cap: 600, seed: 11 });
    const e = f.emitter({ shape: 'ring', x: 300, y: 300, r: 60, a0: -2.5, a1: -0.6, rate: 400, size: 24, life: 400, smoke: 1 }, { hold: 200, fade: 300 });
    expect(f.emitting).toBe(1);
    let smoke = 0;
    for (let t = 0; t < 520; t += 16) { f.update(16); smoke = Math.max(smoke, (f.back.children[0] as Container).children.filter((s) => s.visible).length); }
    expect(e.on).toBe(false);
    expect(f.emitting).toBe(0);
    expect(smoke).toBeGreaterThan(0);
    for (let t = 0; t < 4000 && f.update(16); t += 16) { /* drain */ }
    expect(f.count).toBe(0);
    f.destroy();
  });

  it('is deterministic: the same seed burns the same fire', () => {
    const run = (): number[] => {
      const f = new PixiFire(TEX, { cap: 300, seed: 42 });
      f.emitter({ shape: 'ring', x: 200, y: 200, r: 50, rate: 300, size: 20, life: 500, tongues: 0.5, body: 0.5, embers: 20 });
      f.burst(200, 200, { n: 30, radius: 20, speed: 300, size: 30, life: 600, embers: 10 });
      for (let t = 0; t < 400; t += 16) f.update(16);
      const out = visible(f).map((s) => Math.round(s.x * 100) + Math.round(s.y * 100) * 7);
      f.destroy();
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('clear() puts everything out at once; destroy() leaves nothing behind', () => {
    const f = new PixiFire(TEX, { cap: 300, seed: 1 });
    const parent = new Container();
    parent.addChild(f.root);
    f.emitter({ x: 0, y: 0, rate: 500, size: 20, life: 500 });
    for (let t = 0; t < 200; t += 16) f.update(16);
    f.clear();
    expect(f.count).toBe(0);
    expect(f.alive).toBe(false);
    expect(visible(f)).toHaveLength(0);
    f.destroy();
    expect(parent.children).toHaveLength(0);
    expect(f.root.destroyed).toBe(true);
    expect(f.update(16)).toBe(false);
  });
});
