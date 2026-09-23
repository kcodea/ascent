import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { culledTotal, livePlayCount, livePlaysSnapshot, resetFxBudget } from './fxBudget';
import { registerSavedDef } from './fxDefs';
import { playDef } from './playDef';
import type { FxInstance } from './primitive';
import { clearPrimitives, registerPrimitive } from './registry';
import type { StoredFxDef } from './defStore';

/**
 * Found by review on `feat/equipment-amplified-comet-fx`, 2026-09-22 (pre-existing): fire a few one-shot def
 * plays on the shop screen, go to the title and come back. `PixiFxLayer` detaches at the title (`isPreRun`
 * unmounts it) and re-attaches on return; after the round trip the console shows exactly one
 * `[pixiFx] external updater threw — removing it to protect the overlay` per play that was still live at
 * detach (`Cannot read properties of null (reading 'fxUniforms')`), and those plays stay in the FX budget
 * registry counting against `maxParticles` as ghosts. Caller-owned loops (the `amplified-slot` play) were
 * fine because their owners dispose them on the same unmount; it was the self-retiring one-shots that leaked
 * across the detach.
 *
 * The fix: `pixiFx.detach()` retires every registered live play (`retireLivePlays`) BEFORE the stage is torn
 * down, and clears its updater / pending-mount lists, so a re-attach is a new world with nothing carried over.
 *
 * HEADLESS SEAM: a real `attach()` needs a WebGL context, so the test seeds the controller's private `app` and
 * `layer` through a cast (field names `app`, `layer`, `extraUpdaters`, `update` — a rename fails this loudly,
 * which is the point). With those seeded, the REAL `rendererFor` / `mountLayer` / `addUpdater` run, which is
 * exactly the wiring the bug lives in. The fake app's `destroy({ children })` destroys the seeded layer's
 * children, as Pixi's `Application.destroy` does to the stage — and the stub primitive throws a `TypeError`
 * from `update` once its container is destroyed, a faithful stand-in for `setParticleTime` on a shader whose
 * resources Pixi nulled.
 */

type Seam = {
  app: unknown;
  layer: Container | null;
  ready: boolean;
  extraUpdaters: unknown[];
  update: (ticker: { deltaMS: number }) => void;
};
const seam = (): Seam => pixiFx as unknown as Seam;

function seedFakeApp(): { layer: Container; destroyed: () => number } {
  const layer = new Container();
  let destroys = 0;
  const app = {
    renderer: {},
    canvas: {},
    ticker: { remove(): void {}, stop(): void {}, start(): void {}, add(): void {} },
    destroy(_opts: unknown, children: { children: boolean }): void {
      destroys++;
      layer.destroy(children);
    },
  };
  seam().app = app;
  seam().layer = layer;
  seam().ready = true;
  return { layer, destroyed: () => destroys };
}

describe('pixiFx.detach() retires every live def play', () => {
  const destroyed: number[] = [];
  let spawned = 0;
  let updatesOnDestroyed = 0;

  beforeEach(() => {
    destroyed.length = 0;
    spawned = 0;
    updatesOnDestroyed = 0;
    resetFxBudget();
    clearPrimitives();
    registerPrimitive({
      id: 'stub',
      params: { count: { kind: 'slider', label: 'Count', min: 0, max: 1000, step: 1, default: 50 } },
      spawn: (ctx) => {
        const n = spawned++;
        const inst: FxInstance = {
          update: () => {
            if (ctx.container.destroyed) {
              updatesOnDestroyed++;
              // What the real primitives hit: `shader.resources` is null after Pixi destroyed the layer.
              throw new TypeError("Cannot read properties of null (reading 'fxUniforms')");
            }
          },
          setParams: vi.fn(),
          isComplete: () => false,
          destroy: () => { destroyed.push(n); },
        };
        return inst;
      },
    });
    const def: StoredFxDef = {
      version: 1, id: 'detach-test', duration: 800,
      layers: [{ primitive: 'stub', anchor: 'target', at: 0, params: { count: 50 } }],
    };
    registerSavedDef(def);
  });
  afterEach(() => {
    // Leave the controller as the module singleton starts: detached, nothing seeded.
    seam().app = null;
    seam().layer = null;
    seam().ready = false;
    seam().extraUpdaters.length = 0;
    vi.restoreAllMocks();
    clearPrimitives();
    resetFxBudget();
  });

  it('leaves the registry and updater list empty, and a re-attach tick throws nothing', () => {
    const first = seedFakeApp();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Three one-shots live on the shop screen (two of one def, one of another shape — same stub).
    for (let i = 0; i < 3; i++) expect(playDef('detach-test', { target: { x: 0, y: 0 } })).not.toBeNull();
    expect(spawned).toBe(3);
    expect(livePlayCount()).toBe(3);
    expect(seam().extraUpdaters.length).toBe(3);
    expect(first.layer.children.length).toBe(3); // really mounted on the seeded stage

    // The title screen: PixiFxLayer unmounts → detach.
    pixiFx.detach();
    expect(first.destroyed()).toBe(1);
    expect(seam().app).toBeNull();
    // Every play retired for real — its primitive destroyed once, in age order — before the stage went.
    expect(destroyed).toEqual([0, 1, 2]);
    expect(livePlayCount()).toBe(0);
    expect(seam().extraUpdaters.length).toBe(0);
    // Not a budget trim: the `fx:culled` counter must keep meaning "the cap bit".
    expect(culledTotal()).toBe(0);

    // Back to the shop: a NEW app. Its first tick must find no stale updater to evict.
    seedFakeApp();
    expect(() => seam().update({ deltaMS: 16 })).not.toThrow();
    expect(updatesOnDestroyed).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(livePlayCount()).toBe(0);
  });

  it('a caller-owned loop retired at detach makes its later dispose a harmless no-op', () => {
    seedFakeApp();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const disposeLoop = playDef('detach-test', { target: { x: 0, y: 0 } }, { loop: true });
    expect(disposeLoop).not.toBeNull();
    playDef('detach-test', { target: { x: 0, y: 0 } });
    expect(livePlayCount()).toBe(2);
    expect(livePlaysSnapshot().map((p) => p.protected)).toEqual([true, false]); // the loop really is a loop

    pixiFx.detach();
    // Protected plays (a loop is one) are retired too: a re-attach is a new world.
    expect(livePlayCount()).toBe(0);
    expect(destroyed).toEqual([0, 1]);

    // The owner (StatusBar's `useAmplifiedSlotFx`, the Discover's (Both) markers, ...) disposes on its own
    // unmount, which can land after the layer's — it must not throw or tear anything down a second time.
    expect(() => disposeLoop!()).not.toThrow();
    expect(destroyed).toEqual([0, 1]);
    expect(error).not.toHaveBeenCalled();

    seedFakeApp();
    expect(() => seam().update({ deltaMS: 16 })).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });

  it('is a no-op when nothing is attached, and a no-op registry-wise when nothing is live', () => {
    expect(() => pixiFx.detach()).not.toThrow(); // no app: the early return, as before
    seedFakeApp();
    expect(() => pixiFx.detach()).not.toThrow();
    expect(livePlayCount()).toBe(0);
    expect(destroyed).toEqual([]);
  });
});
