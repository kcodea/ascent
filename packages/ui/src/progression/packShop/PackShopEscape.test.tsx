// @vitest-environment jsdom
/**
 * The shop with the REAL opener mounted from it (jsdom has no WebGL, so the opener falls back to its reduced-motion path):
 * Esc reaches the opener exactly as in the Pack Lab, closes it, and does not close the shop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { OwnedPack } from '@game/progression';
import { mount, type Mounted } from '../../renderedText.mount';
import { PackShop, type PackShopProps } from './PackShop';
import type { ShopScene } from './shopScene';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./shopSounds', () => ({
  createShopSounds: () => { const nop = (): void => undefined; return { pickUp: nop, shake: nop, overLine: nop, till: nop, land: nop, refuse: nop, rack: nop, play: nop, dispose: nop }; },
}));

const calls: string[] = [];
const sceneFactory: NonNullable<PackShopProps['sceneFactory']> = () => scene as unknown as ShopScene;
const scene: Record<string, (...a: never[]) => unknown> & { setHand(p: readonly OwnedPack[]): void; setInputEnabled(on: boolean): void; setVisible(on: boolean, ms: number): void } = {
  setShelf: () => undefined, setAffordable: () => undefined, scrollBy: () => undefined, buySettled: () => undefined,
  rectOf: () => ({ left: 0, top: 0, width: 10, height: 10 }), payAether: () => undefined, gainAether: () => undefined,
  setHand: (p) => { calls.push('setHand:' + p.map((x) => x.packId).join(',')); },
  setInputEnabled: (on) => { calls.push('input:' + on); },
  setVisible: (on, ms) => { calls.push(`visible:${on}:${ms}`); },
  destroy: () => undefined,
};

const look = { kind: 'rarity', id: 'rare', name: 'Rare Pack', guaranteedFloor: 'rare' } as const;
const hand: OwnedPack[] = [{ packId: 'h1', look }, { packId: 'h2', look }];
let m: Mounted | null = null;
// jsdom has no WebGL: the opener logs that pixi could not start before falling back; keep the output pristine.
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { m?.unmount(); m = null; calls.length = 0; vi.restoreAllMocks(); });

describe('PackShop with the real opener', () => {
  it('moves focus into the opener, closes it on Escape, leaves the shop open, and returns focus to the played pack', async () => {
    const onClose = vi.fn();
    m = mount(<PackShop shelves={[{ id: 'packs', name: 'Packs' }]} offers={[]} hand={hand} aether={0} buy={() => new Promise(() => undefined)}
      open={() => new Promise(() => undefined)} sceneFactory={sceneFactory} reducedMotion={false} onClose={onClose} />);
    const item = [...document.querySelectorAll<HTMLElement>('button[data-pack]')][0]!;
    act(() => { item.click(); });
    expect(document.activeElement).toBe(document.querySelector('.pkop'));
    calls.length = 0;
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('.pkop')).toBeNull();
    expect(calls).toEqual(['setHand:h1,h2', 'visible:true:200', 'input:true']);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute('data-pack')).toBe('h1');
    // let the opener's (failing) pixi init report before the console spies are restored
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  });
});
