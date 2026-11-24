// @vitest-environment jsdom
/**
 * The scene's no-Pixi contract (packScene.ts header): when Pixi is not allowed, or its init fails, the scene fires
 * `onUnavailable` exactly once and nothing else, so the shell can fall back to its reduced-motion path. Never after
 * `destroy()`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const ctl = vi.hoisted(() => ({ allowed: true, initFails: false }));
vi.mock('../../phoneDiag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../phoneDiag')>()),
  pixiAllowed: () => ctl.allowed,
}));
vi.mock('pixi.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    async init(): Promise<void> {
      await Promise.resolve();
      if (ctl.initFails) throw new Error('no webgl');
      throw new Error('this test never builds a real scene');
    }
    destroy(): void { /* nothing was built */ }
  }
  return { ...real, Application: FakeApplication };
});

import { createPackScene, type PackSceneEvents } from './packScene';
import type { PackSounds } from './packSounds';

const LOOK = { kind: 'rarity', id: 'rare', name: 'Rare Pack', guaranteedFloor: 'rare' } as const;
const sounds = new Proxy({}, { get: () => () => undefined }) as unknown as PackSounds;
const recorder = (): { fired: string[]; events: PackSceneEvents } => {
  const fired: string[] = [];
  const rec = (n: string) => () => { fired.push(n); };
  return {
    fired,
    events: { onUnavailable: rec('unavailable'), onPop: rec('pop'), onStripFree: rec('strip'), onSleeveDropped: rec('sleeve'),
      onZoomed: rec('zoom'), onFlipEdge: rec('edge') },
  };
};
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

afterEach(() => { ctl.allowed = true; ctl.initFails = false; vi.restoreAllMocks(); });

describe('packScene: no Pixi', () => {
  it('Pixi not allowed: onUnavailable fires once, synchronously, and every method stays a no-op', async () => {
    ctl.allowed = false;
    const { fired, events } = recorder();
    const scene = createPackScene(document.createElement('div'), LOOK, 5, sounds, events);
    expect(fired).toEqual(['unavailable']);
    expect(scene.flipTop({ x: 0, y: 0 })).toBe(false);
    scene.quickOpen(); scene.setBacks(null); scene.resetSealed(); scene.setInputEnabled(true); scene.setSpeed(0.5);
    await flush();
    scene.destroy();
    expect(fired).toEqual(['unavailable']);
  });

  it('init fails: onUnavailable fires once after the failed init', async () => {
    ctl.initFails = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fired, events } = recorder();
    const scene = createPackScene(document.createElement('div'), LOOK, 5, sounds, events);
    expect(fired).toEqual([]);
    await flush();
    expect(fired).toEqual(['unavailable']);
    scene.destroy();
    expect(fired).toEqual(['unavailable']);
  });

  it('destroyed before a failed init resolves: nothing fires', async () => {
    ctl.initFails = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fired, events } = recorder();
    const scene = createPackScene(document.createElement('div'), LOOK, 5, sounds, events);
    scene.destroy();
    await flush();
    expect(fired).toEqual([]);
  });
});
