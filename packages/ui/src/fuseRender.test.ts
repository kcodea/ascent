import { describe, it, expect } from 'vitest';
import { FuseRenderer, inGemPass, type SpriteFactory, type FuseView } from './fuseRender';
import { FuseSim, type FuseGeom } from './fuseSim';
import { FUSE_DEFAULTS } from './fuseTune';

const g: FuseGeom = { fuseX0: 0, fuseX1: 1000, fuseY: 0, fuseThick: 16, gemX: 1100, gemY: 0 };
const v: FuseView = { ox: 0, oy: -200, scale: 1, dpr: 1 };

/** A stub 2D context: counts drawImage, and throws on createRadialGradient once `locked`. */
function stubCtx(state: { locked: boolean; draws: number; clears?: number }): CanvasRenderingContext2D {
  const grad = { addColorStop: () => undefined };
  const ctx = {
    canvas: { width: 100, height: 100 },
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1,
    clearRect: () => { state.clears = (state.clears ?? 0) + 1; }, fillRect: () => undefined, beginPath: () => undefined, moveTo: () => undefined,
    lineTo: () => undefined, closePath: () => undefined, fill: () => undefined, stroke: () => undefined,
    arc: () => undefined, save: () => undefined, restore: () => undefined,
    setTransform: () => undefined, translate: () => undefined, rotate: () => undefined,
    drawImage: () => { state.draws++; },
    createRadialGradient: () => { if (state.locked) throw new Error('per-frame gradient'); return grad; },
    createLinearGradient: () => { if (state.locked) throw new Error('per-frame gradient'); return grad; },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function setup(): { r: FuseRenderer; state: { locked: boolean; draws: number }; ctx: CanvasRenderingContext2D } {
  const state = { locked: false, draws: 0 };
  const factory: SpriteFactory = (w, h) => {
    const ctx = stubCtx(state);
    return { canvas: { width: w, height: h } as unknown as HTMLCanvasElement, ctx };
  };
  const r = new FuseRenderer(FUSE_DEFAULTS, factory);
  state.locked = true;
  return { r, state, ctx: stubCtx(state) };
}

describe('fuse renderer', () => {
  it('inGemPass splits at captureR', () => {
    const R = FUSE_DEFAULTS.captureR;
    const sim = new FuseSim(FUSE_DEFAULTS, 1);
    expect(inGemPass(sim.addParticle({ x: g.gemX - (R - 1), y: g.gemY }), g, R)).toBe(true);
    expect(inGemPass(sim.addParticle({ x: g.gemX - (R + 1), y: g.gemY }), g, R)).toBe(false);
  });

  it('the two passes draw each live particle exactly once, with no per-frame gradients', () => {
    const { r, state, ctx } = setup();
    const empty = new FuseSim(FUSE_DEFAULTS, 1);
    r.drawBehind(ctx, empty, g, v);
    r.drawGem(ctx, empty, g, v, 0.5, 1);
    const extras = state.draws;

    const sim = new FuseSim(FUSE_DEFAULTS, 1);
    sim.step(1 / 60, 0, g);
    for (let i = 1; i <= 300; i++) sim.step(1 / 60, i / 600, g);
    for (let i = 0; i < 5; i++) sim.addParticle({ x: g.gemX + 30, y: g.gemY + 10 * i }); // some in the gem pass
    const n = sim.particles.length;
    expect(n).toBeGreaterThan(5);
    state.draws = 0;
    r.drawBehind(ctx, sim, g, v);
    r.drawGem(ctx, sim, g, v, 0.5, 1);
    expect(state.draws - extras).toBe(n);
  });

  it('the charged wait does not re-clear an empty behind-cards canvas every frame', () => {
    const { r, state, ctx } = setup();
    const sim = new FuseSim(FUSE_DEFAULTS, 1);
    sim.collapse();
    sim.step(1 / 60, 1, g); // idle: a few orbiters, all inside the gem pass
    expect(sim.mode).toBe('idle');
    r.drawBehind(ctx, sim, g, v); // first frame may clear what was there
    state.clears = 0;
    for (let i = 0; i < 60; i++) { sim.step(1 / 60, 1, g); r.drawBehind(ctx, sim, g, v); }
    expect(state.clears).toBe(0);
    // ...but a piece that leaves the gem pass is drawn (and the next empty frame clears it once).
    sim.addParticle({ x: g.gemX - 400, y: g.gemY });
    expect(r.drawBehind(ctx, sim, g, v)).toBe(1);
  });

  it('the collapse burst draws without baking anything new', () => {
    const { r, ctx } = setup();
    const sim = new FuseSim(FUSE_DEFAULTS, 1);
    r.burst();
    expect(() => {
      for (let t = 0; t < 1; t += 0.05) r.drawGem(ctx, sim, g, v, 1, 10 + t);
    }).not.toThrow();
  });
});
