// @vitest-environment jsdom
/**
 * THE COLLECTION'S SKIN PREVIEWS (owner 2026-09-30: "can you [show] the default skin when the player hits use
 * default? also add a mouseover preview of what minions/spells would look like in game as well please. for heroes
 * the preview image is off - can you fix that?"). Oracle R-PROG-COLLECTION-04.
 *  - "Use default art" flips the detail preview to the target's DEFAULT art at once, keeps the item selected, and
 *    the status / ribbon / Equip button follow the server's answer; Equip shows the skin again; a refusal reverts.
 *  - hovering an OWNED card skin's tile floats the REAL in-game `Card` wearing that skin, beside the tile;
 *    leaving clears it; a hero skin tile does not.
 *  - a hero skin previews in the in-game portrait ring (`HeroPortraitRing`: `.cv2-heroframe > .hero > .f > img.heroimg`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import type { CrateFx } from './crateFx/crateFxPixi';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const equipCosmeticRemote = vi.fn();
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  equipCosmeticRemote: (slot: string, target: string, id: string | null) => equipCosmeticRemote(slot, target, id),
  fetchOwnCrates: async () => undefined,
}));

import { CollectionPage } from './CollectionScreen';
import { previewPlacement } from './SkinCardPreview';
import { resetProgressionForTests, useProgression } from './progressionStore';
import { setCrateFxFactoryForTests } from './crateFx/crateFxPixi';
import { useGame } from '../store';
import { artFor, heroArt } from '../art';

const noopFx = (): CrateFx => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : k === 'mount' ? async () => true : () => {}) }) as CrateFx;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; setCrateFxFactoryForTests(null); resetProgressionForTests(); });
beforeEach(() => {
  resetProgressionForTests();
  localStorage.clear();
  equipCosmeticRemote.mockReset();
  setCrateFxFactoryForTests(noopFx);
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, showCollection: false, playerName: 'Kevin' });
});

const base: ProgressionProfile = {
  accountXp: 325, accountLevel: 2, revision: 9, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'],
  cosmetics: ['alpha_tester', 'skin_blackbelt_1', 'skin_albus_1'],
  loadout: { heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } },
};
function open(): void {
  localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(['alpha_tester', 'skin_blackbelt_1', 'skin_albus_1']));
  useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList: [], mirror: { userId: 'u-1', ...base } });
  ui = mount(<CollectionPage reducedMotion />);
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tab = (label: string): HTMLButtonElement => $$('.colls-tab').find((t) => t.querySelector('.colls-tab-name')?.textContent === label) as HTMLButtonElement;
const tile = (name: string): HTMLButtonElement => $$('.colls-tile').find((t) => t.querySelector('.colls-tile-name')?.textContent === name) as HTMLButtonElement;
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const fact = (label: string): string | undefined => $$('.colls-fact').find((f) => f.querySelector('span')?.textContent === label)?.querySelector('b')?.textContent ?? undefined;
// React's onPointerEnter / onPointerLeave derive from pointerover / pointerout (jsdom has no PointerEvent class).
const hover = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); }); };
const unhover = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })); }); };
const clean = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };

describe('Use default art shows the default look', () => {
  it('a hero skin: the preview switches to the hero\x27s own art at once; status, ribbon and Equip follow the answer', async () => {
    open();
    act(() => tab('Heroes').click());
    const img = (): string | null | undefined => $('.colls-detail .colls-heroring img.heroimg')?.getAttribute('src');
    expect(img()).toContain('skin_albus_1');
    let resolve!: (v: unknown) => void;
    equipCosmeticRemote.mockReturnValue(new Promise((r) => { resolve = r; }));
    await act(async () => { button('Use default art')!.click(); });
    // Immediately, before the server answers: the default art, labelled.
    expect(img()).toBe(heroArt('albus'));
    expect(text('.colls-default-tag')).toBe('Default art');
    await act(async () => { resolve({ status: 'ok', value: null, profile: { ...base, revision: 10, loadout: { minionSkinByCardId: base.loadout!.minionSkinByCardId } } }); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_skin', 'albus', null);
    // The same item stays selected, now Owned (not Equipped), default in use, with Equip to put it back on.
    expect(text('.colls-plate-name')).toBe('Surf Day Albus');
    expect(fact('Status')).toBe('Owned');
    expect(fact('In use')).toBe('Default art');
    expect(img()).toBe(heroArt('albus'));
    expect(tile('Surf Day Albus').className).not.toMatch(/\bworn\b/);
    expect(tile('Surf Day Albus').querySelector('.colls-tile-ribbon')).toBeNull();
    expect(button('Equip')).toBeTruthy();
    // Re-equip: the skin is back in the preview and the ribbon returns.
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 11 } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(img()).toContain('skin_albus_1');
    expect($('.colls-default-tag')).toBeNull();
    expect(fact('Status')).toBe('Equipped');
    expect(tile('Surf Day Albus').className).toMatch(/\bworn\b/);
    clean();
  });

  it('a minion skin: the art switches to the card\x27s own art; a refusal puts the skin back', async () => {
    open();
    act(() => tab('Minions').click());
    act(() => tile('Sheriff Brian').click());
    const img = (): string | null | undefined => $('.colls-detail .colls-skinart img')?.getAttribute('src');
    expect(img()).toContain('skin_blackbelt_1');
    equipCosmeticRemote.mockResolvedValue({ status: 'error', reason: 'not_owned' });
    await act(async () => { button('Use default art')!.click(); });
    await settle();
    expect(img()).toContain('skin_blackbelt_1');
    expect(fact('Status')).toBe('Equipped');
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 10, loadout: { heroSkinByHeroId: { albus: 'skin_albus_1' } } } });
    await act(async () => { button('Use default art')!.click(); });
    await settle();
    expect(img()).toBe(artFor('blackbelt'));
    expect(fact('Status')).toBe('Owned');
    // Picking the tile again previews the skin itself.
    act(() => tile('Sheriff Brian').click());
    expect(img()).toContain('skin_blackbelt_1');
  });
});

describe('the in-game card preview on hover', () => {
  it('a minion skin tile floats the real Card wearing the skin; leaving clears it', () => {
    open();
    act(() => tab('Minions').click());
    expect($('.colls-cardpreview')).toBeNull();
    hover(tile('Sheriff Brian'));
    const preview = $('.colls-cardpreview');
    expect(preview?.dataset.cardPreview).toBe('blackbelt');
    const card = preview!.querySelector('.card');
    expect(card).not.toBeNull();
    expect(card!.querySelector('img.artimg')?.getAttribute('src')).toContain('skin_blackbelt_1');
    expect(card!.textContent).toContain('Black Belt Brian');
    unhover(tile('Sheriff Brian'));
    expect($('.colls-cardpreview')).toBeNull();
    clean();
  });

  it('an unowned skin never previews (owner 2026-10-01: "do not allow preview if you do not own the art")', () => {
    open();
    act(() => tab('Minions').click());
    hover(tile('Glitch Brian'));
    expect($('.colls-cardpreview')).toBeNull();
  });

  it('the detail panel\x27s art previews the card as well; a hero skin tile does not', () => {
    open();
    act(() => tab('Minions').click());
    act(() => tile('Sheriff Brian').click());
    hover($('.colls-detail .colls-skinart')!);
    expect($('.colls-cardpreview .card img.artimg')?.getAttribute('src')).toContain('skin_blackbelt_1');
    unhover($('.colls-detail .colls-skinart')!);
    act(() => tab('Heroes').click());
    hover(tile('Surf Day Albus'));
    expect($('.colls-cardpreview')).toBeNull();
  });

  it('sits beside the anchor and stays on screen', () => {
    const vp = { w: 1920, h: 1080 };
    const box = { w: 330, h: 560 };
    // Room on the right: to the right of the tile.
    expect(previewPlacement({ left: 100, right: 350, top: 400, height: 150 }, box, vp).left).toBe(364);
    // Against the right edge: flips to the left of it, never over it.
    const flipped = previewPlacement({ left: 1600, right: 1850, top: 400, height: 150 }, box, vp);
    expect(flipped.left + box.w).toBeLessThanOrEqual(1600);
    // Near the top or the bottom: clamped inside the viewport.
    expect(previewPlacement({ left: 100, right: 350, top: 0, height: 40 }, box, vp).top).toBe(8);
    expect(previewPlacement({ left: 100, right: 350, top: 1060, height: 20 }, box, vp).top).toBe(1080 - box.h - 8);
  });
});

describe('the hero skin preview', () => {
  it('uses the in-game portrait ring (the StatusBar disc markup), not a bare image', () => {
    open();
    act(() => tab('Heroes').click());
    const ring = $('.colls-detail .colls-heroring');
    expect(ring?.className).toMatch(/\bcv2-heroframe\b/);
    expect(ring?.querySelector(':scope > .hero > .f > img.heroimg')?.getAttribute('src')).toContain('skin_albus_1');
    expect($('.colls-skinart.hero')).toBeNull();
  });
});
