// @vitest-environment jsdom
/**
 * THE TABS UNDER YOUR CARD (showcase player card, PR 3 Task 7; spec "The four tabs on your card"): Avatar, Frame, Title,
 * Card plate, each with a tiny version of what you wear. Pins:
 *  - each tab opens the cosmetics window on its own tab (`onOpen(tab)`);
 *  - the Frame thumb is the ring on its own (one image, no avatar inside); the Title thumb is the painted Titles
 *    medallion; the Avatar thumb is round art; the Card plate thumb is the plate's own thumb;
 *  - a pointerdown on a tab never reaches the card's wrapper (the Versus room's drag handle);
 *  - a press on a tab still plays the click "thock", though the press is stopped (R-SFX-STOPPED-PRESS-01);
 *  - no native tooltip.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../../renderedText.mount';
import { PhCardTabs } from './PhCardTabs';
import type { CosmeticsTab } from '../../cosmetics/cosmeticsPending';
import { sfx } from '../../sfx';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const tab = (name: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>('.phs-tab')].find((b) => b.querySelector('.phs-tablbl')?.textContent === name)!;

function render(onOpen: (t: CosmeticsTab) => void, over: Partial<Parameters<typeof PhCardTabs>[0]> = {}, onParentDown?: () => void): void {
  ui = mount(
    <div className="wrap" onPointerDown={onParentDown}>
      <PhCardTabs avatarSrc="/a.webp" frameId="gold" plateThumb="/plate.webp" onOpen={onOpen} {...over} />
    </div>,
  );
}

describe('the tabs under your card', () => {
  it('shows Avatar, Frame, Title and Card plate, in that order', () => {
    render(() => undefined);
    expect([...document.querySelectorAll('.phs-tab .phs-tablbl')].map((e) => e.textContent)).toEqual(['Avatar', 'Frame', 'Title', 'Card plate']);
  });

  it('each tab opens the window on its own tab', () => {
    const onOpen = vi.fn();
    render(onOpen);
    act(() => tab('Frame').click());
    expect(onOpen).toHaveBeenLastCalledWith('frame');
    act(() => tab('Avatar').click());
    expect(onOpen).toHaveBeenLastCalledWith('avatar');
    act(() => tab('Title').click());
    expect(onOpen).toHaveBeenLastCalledWith('title');
    act(() => tab('Card plate').click());
    expect(onOpen).toHaveBeenLastCalledWith('plate');
    expect(onOpen).toHaveBeenCalledTimes(4);
  });

  it('the Frame thumb is the ring alone: one image, and it is not the avatar', () => {
    render(() => undefined);
    const imgs = [...tab('Frame').querySelectorAll('img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute('src')).not.toBe('/a.webp');
  });

  it('the Avatar thumb is your avatar, the Card plate thumb the plate, the Title thumb the Titles medallion', () => {
    render(() => undefined);
    expect(tab('Avatar').querySelector('img')!.getAttribute('src')).toBe('/a.webp');
    expect(tab('Card plate').querySelector('img')!.getAttribute('src')).toBe('/plate.webp');
    const medal = [...tab('Title').querySelectorAll('img')];
    expect(medal).toHaveLength(1);
    expect(medal[0]!.getAttribute('src')).toMatch(/menu\/titles\.webp$/);
    expect(tab('Title').querySelector('.phs-tdot')).toBeNull(); // the rarity dot is gone
    // Every image is decoded in sync and never dragged.
    for (const img of document.querySelectorAll('.phs-tabs img')) {
      expect(img.getAttribute('decoding')).toBe('sync');
      expect(img.getAttribute('draggable')).toBe('false');
    }
  });

  it('with nothing worn the thumbs still draw (the Titles medallion; standard plate: a plain swatch)', () => {
    render(() => undefined, { avatarSrc: undefined, frameId: null, plateThumb: undefined });
    expect(tab('Title').querySelector('img')!.getAttribute('src')).toMatch(/menu\/titles\.webp$/);
    expect(tab('Card plate').querySelector('img')).toBeNull();
    expect(tab('Card plate').querySelector('.phs-tplain')).not.toBeNull();
  });

  it('a pointerdown on a tab never reaches the card wrapper (the room drag handle)', () => {
    const parent = vi.fn();
    render(() => undefined, {}, parent);
    act(() => { tab('Frame').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(parent).not.toHaveBeenCalled();
    // The wrapper itself still hears its own presses (the stop is on the tabs only).
    act(() => { $('.wrap')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })); });
    expect(parent).toHaveBeenCalledTimes(1);
  });

  it('R-SFX-STOPPED-PRESS-01: a press on a tab plays the click thock, a touch does not', () => {
    const thock = vi.spyOn(sfx, 'clickThock').mockImplementation(() => undefined);
    render(() => undefined);
    const down = (el: Element, pointerType: string): void => {
      const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(e, 'pointerType', { value: pointerType });
      act(() => { el.dispatchEvent(e); });
    };
    down(tab('Title'), 'mouse');
    expect(thock).toHaveBeenCalledTimes(1);
    down(tab('Card plate').querySelector('.phs-tablbl')!, 'mouse'); // a press on the label is a press on its tab
    expect(thock).toHaveBeenCalledTimes(2);
    down(tab('Frame'), 'touch');                                    // the cue belongs to a click, not a tap
    expect(thock).toHaveBeenCalledTimes(2);
    down($('.phs-tabs')!, 'mouse');                                 // the gap between two tabs is not a control
    expect(thock).toHaveBeenCalledTimes(2);
    thock.mockRestore();
  });

  it('no native tooltip', () => {
    render(() => undefined);
    expect(document.querySelector('[title]')).toBeNull();
    expect(document.querySelector('svg title')).toBeNull();
  });
});
