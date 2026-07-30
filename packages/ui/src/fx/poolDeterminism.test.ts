import { Container, DOMAdapter, Texture } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { coerceParams } from './params';
import { getPrimitive } from './registry';
import type { FxContext, FxInstance, FxPrimitive } from './primitive';
import './primitives';
import { particleLayerPoolSize, resetParticleLayerPool } from './particleLayerPool';
import { resetShaderPools, shaderPoolSize } from './shaderPool';
import { fxPoolSize, resetFxPools } from './fxRuntime';

/**
 * **The determinism proof for pooling.**
 *
 * Pooling shaders and containers is only safe if a recycled instance is INDISTINGUISHABLE from a fresh one.
 * `burst.ts` pins that a seeded burst draws exactly 7 `rand()` values per particle in a fixed order, and that
 * contract is what every saved seed replays against — so the question this file answers is narrow and exact:
 * *for the same seed, does a burst spawned onto a recycled layer produce byte-identical particles to one
 * spawned onto a brand-new layer?*
 *
 * It does it by DIFFING two real spawns rather than by reasoning about the code, because the failure mode
 * pooling introduces is precisely the one reasoning misses: state that survives on the object and only
 * perturbs the second tenant.
 *
 * These run headless. `ParticleContainer`, `MeshGeometry`, `Mesh` and `Shader.from` are all GL-free until
 * something draws them, and the only genuine renderer call in the whole path is `generateTexture` for the
 * shared shape atlas — stubbed below.
 */

/** Pixi's `GlProgram` constructor probes fragment precision via a `<canvas>` + WebGL context, neither of
 *  which exists in the node test env. A canvas that yields no context makes it fall back to `'mediump'`. */
beforeAll(() => {
  const base = DOMAdapter.get();
  DOMAdapter.set({
    ...base,
    createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
  });
});

/** The one renderer method the primitives actually call. Everything else is threaded through untouched. */
const RENDERER = { generateTexture: () => Texture.WHITE } as unknown as Renderer;

function spawn(id: string, seed: number, oneShot = true): FxInstance<Record<string, never>> {
  const prim = getPrimitive(id) as FxPrimitive;
  expect(prim).toBeDefined();
  const ctx: FxContext = { container: new Container(), renderer: RENDERER, oneShot, seed };
  return prim.spawn(ctx, coerceParams(prim.params, {})) as FxInstance<Record<string, never>>;
}

/** The pooled `ParticleContainer` a particle instance is drawing into. `burst` calls its field `pc`; the
 *  sibling `emitter`/`smoke` call theirs `particles` — a naming difference that predates the pool, and one
 *  the tests have to bridge rather than paper over by only ever testing burst. */
function containerOf(inst: unknown): { particleChildren: Record<string, number>[] } {
  const holder = inst as { pc?: { particleChildren: Record<string, number>[] }; particles?: { particleChildren: Record<string, number>[] } };
  const pc = holder.pc ?? holder.particles;
  if (!pc) throw new Error('instance exposes neither `pc` nor `particles` — the pool wiring changed');
  return pc;
}

/** Everything about a particle effect that the eye can see, flattened for an exact array compare. */
function snapshotParticles(inst: unknown): number[] {
  const pc = containerOf(inst);
  const out: number[] = [];
  for (const p of pc.particleChildren) {
    out.push(p.x, p.y, p.rotation, p.scaleX, p.scaleY, p.tint, p.alpha);
  }
  return out;
}

/** Drive an instance the way `playDef` does: position the head, then tick. */
function run(inst: FxInstance<Record<string, never>>, frames: number): void {
  for (let i = 0; i < frames; i++) {
    inst.setHead?.(100 + i * 3, 200 - i * 2);
    inst.update(16.67);
  }
}

function uniformsOf(inst: unknown, key: string): Record<string, number | Float32Array> {
  const shader = (inst as { shader: { resources: Record<string, unknown> } }).shader;
  return (shader.resources[key] as { uniforms: Record<string, number | Float32Array> }).uniforms;
}

describe('pooled instances are indistinguishable from fresh ones', () => {
  // All THREE particle primitives share the one pool, so all three get the proof — burst alone would leave
  // emitter and smoke resting on the argument that they look similar.
  for (const id of ['burst', 'emitter', 'smoke']) {
    it(`${id}: the same seed produces byte-identical particles on a recycled layer`, () => {
      resetParticleLayerPool();

      const fresh = spawn(id, 0x5eed);
      run(fresh, 8);
      const fromFresh = snapshotParticles(fresh);
      expect(fromFresh.length).toBeGreaterThan(0); // the comparison is only meaningful if particles exist
      fresh.destroy(); // returns the layer to the pool

      const recycled = spawn(id, 0x5eed);
      // Proves this really is the pooled object, so the assertion below is about REUSE, not a lucky rebuild.
      expect(containerOf(recycled)).toBe(containerOf(fresh));
      run(recycled, 8);
      expect(snapshotParticles(recycled)).toEqual(fromFresh);
    });

    it(`${id}: a DIFFERENT seed still diverges (the test above is not vacuously true)`, () => {
      resetParticleLayerPool();
      const a = spawn(id, 0x5eed);
      run(a, 8);
      const fromA = snapshotParticles(a);
      a.destroy();
      const b = spawn(id, 0xd1ff);
      run(b, 8);
      expect(snapshotParticles(b)).not.toEqual(fromA);
    });

    it(`${id}: a recycled layer starts with no particles left over from its previous tenant`, () => {
      resetParticleLayerPool();
      const first = spawn(id, 1);
      run(first, 3);
      expect(snapshotParticles(first).length).toBeGreaterThan(0);
      first.destroy();

      const second = spawn(id, 1);
      // Before its own first emit, the recycled container must be empty — not carrying the previous wave.
      expect(snapshotParticles(second)).toEqual([]);
    });
  }

  it('ribbon: the same seed produces the same uSeed phase on a recycled shader', () => {
    resetShaderPools();
    const fresh = spawn('ribbon', 0xabcd);
    const freshSeed = uniformsOf(fresh, 'ribbonUniforms').uSeed;
    fresh.destroy();

    const recycled = spawn('ribbon', 0xabcd);
    expect((recycled as unknown as { shader: unknown }).shader).toBe(
      (fresh as unknown as { shader: unknown }).shader,
    );
    expect(uniformsOf(recycled, 'ribbonUniforms').uSeed).toBe(freshSeed);
  });

  it('ribbon: a recycled shader does not inherit the previous fire’s clock', () => {
    resetShaderPools();
    const first = spawn('ribbon', 1);
    run(first, 20);
    expect(uniformsOf(first, 'ribbonUniforms').uTime).toBeGreaterThan(0);
    first.destroy();

    const second = spawn('ribbon', 2);
    expect(uniformsOf(second, 'ribbonUniforms').uTime).toBe(0);
  });

  // The nastiest of the mesh cases: `uOneShot` and `uTime` are set ONLY in the constructor, so a pooled
  // shader that skipped them would give a one-shot ring the previous tenant's looping behaviour — visible
  // only when a looping preview and a combat fire happen to share a pooled shader.
  it('shockwave: a recycled shader gets its own uOneShot and a zeroed clock', () => {
    resetShaderPools();
    const looping = spawn('shockwave', 1, /* oneShot */ false);
    run(looping, 20);
    expect(uniformsOf(looping, 'shockwaveUniforms').uOneShot).toBe(0);
    expect(uniformsOf(looping, 'shockwaveUniforms').uTime).toBeGreaterThan(0);
    looping.destroy();

    const single = spawn('shockwave', 1, /* oneShot */ true);
    expect((single as unknown as { shader: unknown }).shader).toBe(
      (looping as unknown as { shader: unknown }).shader,
    );
    expect(uniformsOf(single, 'shockwaveUniforms').uOneShot).toBe(1);
    expect(uniformsOf(single, 'shockwaveUniforms').uTime).toBe(0);
  });
});

/**
 * The pools are MODULE-GLOBAL and outlive the `Application` they were built against, so `pixiFx.detach()`
 * has to be able to empty them. It cannot import them directly — that would drag the primitives' ~134 kB of
 * GLSL out of its lazily-fetched chunk and into the entry chunk (see `fxRuntime.ts`) — so it goes through a
 * registry the primitives barrel populates as it loads. These pin that the wiring is actually connected: a
 * silently unregistered hook would leave `detach()` a no-op, which is exactly the state this replaced.
 */
describe('the detach teardown hook reaches the pools', () => {
  it('resetFxPools() empties both pools once the primitives have loaded', () => {
    const layer = acquireParticleLayerForTest();
    layer.destroy();
    const shader = spawn('shockwave', 1);
    shader.destroy();
    expect(particleLayerPoolSize()).toBeGreaterThan(0);
    expect(shaderPoolSize('fx-shockwave')).toBeGreaterThan(0);

    resetFxPools();

    expect(particleLayerPoolSize()).toBe(0);
    expect(shaderPoolSize('fx-shockwave')).toBe(0);
    expect(fxPoolSize()).toBe(0);
  });

  it('fxPoolSize() reports the live pool depth (what window.__fx.poolSize shows)', () => {
    resetFxPools();
    expect(fxPoolSize()).toBe(0);
    acquireParticleLayerForTest().destroy();
    expect(fxPoolSize()).toBe(particleLayerPoolSize());
    expect(fxPoolSize()).toBeGreaterThan(0);
  });
});

/** A burst is the cheapest way to put one pooled particle pair into circulation. */
function acquireParticleLayerForTest(): FxInstance<Record<string, never>> {
  return spawn('burst', 1);
}
