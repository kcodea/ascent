// @vitest-environment jsdom
/**
 * The shop scene's no-Pixi contract (mirrors packSceneUnavailable.test.ts): when Pixi is not allowed, or its init fails,
 * the scene fires `onUnavailable` exactly once and nothing else, and every method stays a safe no-op, before and after
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

import type { OwnedPack, PackOffer } from '@game/progression';
import { createShopScene, type ShopSceneEvents } from './shopScene';
import { createShopSounds } from './shopSounds';

const LOOK = { kind: 'rarity', id: 'rare', name: 'Rare Pack', guaranteedFloor: 'rare' } as const;
const OFFERS: PackOffer[] = [
  { offerId: 'a', look: LOOK, price: 100, shelf: 'rarity', contains: 1 },
  { offerId: 'b', look: LOOK, price: 0, shelf: 'rarity', contains: 1, badge: 'free' },
];
const HAND: OwnedPack[] = [{ packId: 'p1', look: LOOK }];

const recorder = (): { fired: string[]; events: ShopSceneEvents } => {
  const fired: string[] = [];
  const rec = (n: string) => () => { fired.push(n); };
  return {
    fired,
    events: {
      onUnavailable: rec('unavailable'), onHover: rec('hover'), onCentre: rec('centre'), onPickUp: rec('pickUp'),
      onOverLine: rec('overLine'), onDrop: rec('drop'),
    },
  };
};
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const pokeAll = (scene: ReturnType<typeof createShopScene>): void => {
  scene.setShelf(OFFERS); scene.setHand(HAND); scene.setAffordable(new Set(['a'])); scene.scrollBy(1);
  scene.buySettled(true); scene.setInputEnabled(false); scene.setVisible(false, 200);
  expect(scene.rectOf('a')).toBeNull();
};

afterEach(() => { ctl.allowed = true; ctl.initFails = false; vi.restoreAllMocks(); });

describe('shopScene: no Pixi', () => {
  it('Pixi not allowed: onUnavailable fires once, synchronously, and every method stays a no-op', async () => {
    ctl.allowed = false;
    const { fired, events } = recorder();
    const scene = createShopScene(document.createElement('div'), events, createShopSounds());
    expect(fired).toEqual(['unavailable']);
    pokeAll(scene);
    await flush();
    scene.destroy();
    pokeAll(scene);
    scene.destroy();
    expect(fired).toEqual(['unavailable']);
  });

  it('init fails: onUnavailable fires once after the failed init; calls before and after never throw', async () => {
    ctl.initFails = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fired, events } = recorder();
    const scene = createShopScene(document.createElement('div'), events, createShopSounds());
    pokeAll(scene);
    expect(fired).toEqual([]);
    await flush();
    expect(fired).toEqual(['unavailable']);
    pokeAll(scene);
    scene.destroy();
    pokeAll(scene);
    expect(fired).toEqual(['unavailable']);
  });

  it('destroyed before a failed init resolves: nothing fires', async () => {
    ctl.initFails = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fired, events } = recorder();
    const scene = createShopScene(document.createElement('div'), events, createShopSounds());
    scene.setShelf(OFFERS);
    scene.destroy();
    await flush();
    expect(fired).toEqual([]);
  });
});
