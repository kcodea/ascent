// @vitest-environment jsdom
/**
 * THE COLLECTION'S ATTACK ANIMATIONS TAB (owner 2026-09-28: "the new blast attack is going to be a cosmetic unlock,
 * not a new default"). The tab is live; Arcane Barrage (`attack_blast`) has a tile, a detail panel with a sandbox
 * preview, Equip (slot `hero_attack`, target '') and "Use Classic" (null) when worn; the kill switch hides it and
 * locks the tab. No native tooltips, no em dashes.
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
import { applyServerCatalogState, resetProgressionForTests, useProgression } from './progressionStore';
import { setCrateFxFactoryForTests } from './crateFx/crateFxPixi';
import { useGame } from '../store';

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
  cosmetics: ['alpha_tester', 'attack_blast'], loadout: {},
};
function open(over: Partial<ProgressionProfile> = {}): void {
  localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(['alpha_tester', 'attack_blast']));
  useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList: [], mirror: { userId: 'u-1', ...base, ...over } });
  ui = mount(<CollectionPage reducedMotion />);
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tab = (label: string): HTMLButtonElement => $$('.colls-tab').find((t) => t.querySelector('.colls-tab-name')?.textContent === label) as HTMLButtonElement;
const tile = (name: string): HTMLButtonElement => $$('.colls-tile').find((t) => t.querySelector('.colls-tile-name')?.textContent === name) as HTMLButtonElement;
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const clean = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };

describe('the Attack Animations tab', () => {
  it('Arcana (owner 2026-09-28: "one more attack animation ... a magic one called arcana") has its own tile and plays its own preview; Equip sends attack_arcana', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_quake', 'attack_arcana'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('3/15'); // 2026-09-28: Phantom Blades, Enraged Strike, Venom Volley then Frost Nova then Consecration joined, then Inferno, Grave Call, the Stampede and Oona's Banana Cannon, then the Epics Card Shark and Storm Call (2026-09-29), so three of fourteen
    act(() => tile('Arcana').click());
    expect(tile('Arcana').getAttribute('aria-label')).toBe('Arcana, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_quake', 'attack_arcana'], revision: 10, loadout: { heroAttack: 'attack_arcana' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_arcana');
    expect(tile('Arcana').className).toMatch(/\bworn\b/);
    expect(tile('Tectonic Slam').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Tectonic Slam (Quake, owner 2026-09-28) has its own tile and plays its own preview; Equip sends attack_quake', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_quake'] });
    act(() => tab('Attack Animations').click());
    // 2026-09-28: Arcana, Phantom Blades, Enraged Strike, Venom Volley, Frost Nova, Consecration, then (2026-09-29) Inferno, Grave Call, the Stampede and Oona's Banana Cannon and Hemorrhage joined, then the Epics Card Shark and Storm Call, so two of fifteen are owned here.
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Tectonic Slam').click());
    expect(tile('Tectonic Slam').getAttribute('aria-label')).toBe('Tectonic Slam, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_quake'], revision: 10, loadout: { heroAttack: 'attack_quake' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_quake');
    expect(tile('Tectonic Slam').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Phantom Blades (owner 2026-09-28: "surprise me") has its own tile and plays its own preview; Equip sends attack_blades', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_blades'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Phantom Blades').click());
    expect(tile('Phantom Blades').getAttribute('aria-label')).toBe('Phantom Blades, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_blades'], revision: 10, loadout: { heroAttack: 'attack_blades' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_blades');
    expect(tile('Phantom Blades').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Enraged Strike (owner 2026-09-28: "a legendary version of this strike") has its own tile and plays its own preview; Equip sends attack_enraged', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_enraged'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Enraged Strike').click());
    expect(tile('Enraged Strike').getAttribute('aria-label')).toBe('Enraged Strike, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_enraged'], revision: 11, loadout: { heroAttack: 'attack_enraged' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_enraged');
    expect(tile('Enraged Strike').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Venom Volley (Poison Darts, owner 2026-09-28: "make a poison dart animation") has its own tile and plays its own preview; Equip sends attack_poison', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_poison'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Venom Volley').click());
    expect(tile('Venom Volley').getAttribute('aria-label')).toBe('Venom Volley, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_poison'], revision: 11, loadout: { heroAttack: 'attack_poison' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_poison');
    expect(tile('Venom Volley').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Frost Nova (owner 2026-09-28: "an ice/freeze blast one. icicles and then a frost nova") has its own tile and plays its own preview; Equip sends attack_frost', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_frost'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Frost Nova').click());
    expect(tile('Frost Nova').getAttribute('aria-label')).toBe('Frost Nova, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_frost'], revision: 11, loadout: { heroAttack: 'attack_frost' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_frost');
    expect(tile('Frost Nova').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Consecration (owner 2026-09-28: "a holy weapon + consecration attack") has its own tile and plays its own preview; Equip sends attack_holy', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_holy'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Consecration').click());
    expect(tile('Consecration').getAttribute('aria-label')).toBe('Consecration, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_holy'], revision: 11, loadout: { heroAttack: 'attack_holy' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_holy');
    expect(tile('Consecration').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Inferno (owner 2026-09-29: "we need a fire animation") has its own tile and plays its own preview; Equip sends attack_fire', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_fire'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Inferno').click());
    expect(tile('Inferno').getAttribute('aria-label')).toBe('Inferno, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_fire'], revision: 11, loadout: { heroAttack: 'attack_fire' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_fire');
    expect(tile('Inferno').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Grave Call (owner 2026-09-29: "some sort of an undead animation") has its own tile and plays its own preview; Equip sends attack_undead', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_undead'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Grave Call').click());
    expect(tile('Grave Call').getAttribute('aria-label')).toBe('Grave Call, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_undead'], revision: 11, loadout: { heroAttack: 'attack_undead' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_undead');
    expect(tile('Grave Call').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Stampede (owner 2026-09-29: "a beast chomp rush animation") has its own tile and plays its own preview; Equip sends attack_beast', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_beast'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Stampede').click());
    expect(tile('Stampede').getAttribute('aria-label')).toBe('Stampede, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_beast'], revision: 11, loadout: { heroAttack: 'attack_beast' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_beast');
    expect(tile('Stampede').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('Oona\'s Banana Cannon (owner 2026-09-29: "i would love a king oona banana cannon animation") has its own tile and plays its own preview; Equip sends attack_banana', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_banana'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile("Oona's Banana Cannon").click());
    expect(tile("Oona's Banana Cannon").getAttribute('aria-label')).toBe("Oona's Banana Cannon, Legendary, owned");
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_banana'], revision: 11, loadout: { heroAttack: 'attack_banana' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_banana');
    expect(tile("Oona's Banana Cannon").className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  for (const [id, name] of [['attack_cards', 'Card Shark'], ['attack_storm', 'Storm Call']] as const) {
    it(`${name} (an Epic, owner 2026-09-29: "build 5 animations that range from rare -> epic") has its own tile and plays its own preview; Equip sends ${id}`, async () => {
      open({ cosmetics: ['alpha_tester', 'attack_blast', id] });
      act(() => tab('Attack Animations').click());
      expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
      act(() => tile(name).click());
      expect(tile(name).getAttribute('aria-label')).toBe(`${name}, Epic, owned`);
      expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
      expect($('.colls-detail .hapv-box')).not.toBeNull();
      const preview = button('▶ Preview');
      expect(preview).toBeTruthy();
      expect(preview!.disabled).toBe(false);
      equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, id], revision: 11, loadout: { heroAttack: id } } });
      await act(async () => { button('Equip')!.click(); });
      await settle();
      expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', id);
      expect(tile(name).className).toMatch(/\bworn\b/);
      clean();
    });
  }
  it('Hemorrhage (the bleed attack, owner 2026-09-29: "a bleed/gash animation") has its own tile and plays its own preview; Equip sends attack_bleed', async () => {
    open({ cosmetics: ['alpha_tester', 'attack_blast', 'attack_bleed'] });
    act(() => tab('Attack Animations').click());
    expect(tab('Attack Animations').querySelector('.colls-tab-count')?.textContent).toBe('2/15');
    act(() => tile('Hemorrhage').click());
    expect(tile('Hemorrhage').getAttribute('aria-label')).toBe('Hemorrhage, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    const preview = button('▶ Preview');
    expect(preview).toBeTruthy();
    expect(preview!.disabled).toBe(false);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, cosmetics: [...base.cosmetics!, 'attack_bleed'], revision: 11, loadout: { heroAttack: 'attack_bleed' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_bleed');
    expect(tile('Hemorrhage').className).toMatch(/\bworn\b/);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
    clean();
  });

  it('is live with its count; Arcane Barrage has a tile and a detail panel with an in-place preview', () => {
    open();
    const t = tab('Attack Animations');
    expect(t.className).not.toMatch(/\blocked\b/);
    // 2026-09-28: Quake ("Tectonic Slam"), Arcana, Phantom Blades, Enraged Strike, Venom Volley and Frost Nova joined Blast, then Inferno, Grave Call, the Stampede and Oona's Banana Cannon and Hemorrhage (2026-09-29), then the Epics Card Shark and Storm Call, so one of fifteen is owned.
    expect(t.querySelector('.colls-tab-count')?.textContent).toBe('1/15');
    act(() => t.click());
    expect(tile('Arcane Barrage').getAttribute('aria-label')).toBe('Arcane Barrage, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    expect(button('▶ Preview')).toBeTruthy();
    expect(button('Equip')).toBeTruthy();
    clean();
  });

  it('Equip sends the hero_attack slot with the global target; "Use Classic" sends null', async () => {
    open();
    act(() => tab('Attack Animations').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 10, loadout: { heroAttack: 'attack_blast' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_blast');
    expect(tile('Arcane Barrage').className).toMatch(/\bworn\b/);
    expect(useProgression.getState().mirror!.loadout).toEqual({ heroAttack: 'attack_blast' });
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 11, loadout: {} } });
    await act(async () => { button('Use Classic')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenLastCalledWith('hero_attack', '', null);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
  });

  it('a refusal keeps it as it was and says so', async () => {
    open({ loadout: { heroAttack: 'attack_blast' } });
    act(() => tab('Attack Animations').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'error', reason: 'not_equippable' });
    await act(async () => { button('Use Classic')!.click(); });
    await settle();
    expect(tile('Arcane Barrage').className).toMatch(/\bworn\b/);
    expect(text('.coll-error')).toBe('Could not change your hero attack. Try again.');
  });

  it('unowned: no Equip, the preview still plays; the kill switch locks the tab', () => {
    open({ cosmetics: ['alpha_tester'] });
    act(() => tab('Attack Animations').click());
    expect(button('Equip')).toBeUndefined();
    expect(button('▶ Preview')).toBeTruthy();
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: ['hero_attack'] }));
    expect(tab('Attack Animations').className).toMatch(/\blocked\b/);
    clean();
  });
});
