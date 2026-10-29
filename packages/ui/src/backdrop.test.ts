// @vitest-environment jsdom
/**
 * BOARD BACKDROP (owner 2026-10-28): the player's Settings pick writes its preset's vars, survives a reload, and the
 * DEV Layout Lab only overrides it once a Backdrop control is touched, but then shows exactly what the Lab is set to,
 * defaults included (R-BACKDROP-LAB-01: "cobblestone ... is currently wood in the tuner for some reason when selected").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name);

const clearRoot = (): void => {
  const html = document.documentElement;
  html.removeAttribute('style');
  delete html.dataset.bdFit;
  delete html.dataset.btexFit;
};
beforeEach(() => {
  localStorage.clear();
  clearRoot();
  vi.resetModules();
});
afterEach(() => { localStorage.clear(); clearRoot(); });

describe('the Settings backdrop pick', () => {
  it('defaults to Castle (owner 2026-10-29) and writes its preset', async () => {
    const b = await import('./backdrop');
    expect(b.getBackdrop()).toBe('castle');
    expect(rootVar('--bd-img')).toContain('/backdrop-castle.webp');
    expect(document.documentElement.dataset.bdFit).toBe('cover');
    expect(rootVar('--bd-size')).toBe(`${b.BACKDROPS.castle.size}px`);
  });

  it('a pick applies at once and is restored on the next load', async () => {
    const b = await import('./backdrop');
    b.setBackdrop('oak');
    expect(rootVar('--bd-img')).toContain('/backdrop-oak-planks.webp');
    expect(rootVar('--bd-tint-col')).toBe(b.BACKDROPS.oak.tint);
    vi.resetModules();
    document.documentElement.removeAttribute('style');
    const again = await import('./backdrop');
    expect(again.getBackdrop()).toBe('oak');
    expect(rootVar('--bd-img')).toContain('/backdrop-oak-planks.webp');
  });

  it('every preset names a texture the game has', async () => {
    const b = await import('./backdrop');
    const { BACKDROP_TEXTURES } = await import('./layoutConfig');
    for (const id of b.BACKDROP_IDS) expect(BACKDROP_TEXTURES[b.BACKDROPS[id].texture], id).toBeTruthy();
  });
});

describe('the Layout Lab over the Settings pick (DEV)', () => {
  it('an untouched Lab leaves the Settings pick showing', async () => {
    localStorage.setItem('ascent.backdrop', 'stone');
    await import('./backdrop');
    await import('./layoutConfig');
    expect(rootVar('--btex-img')).toBe('');
  });

  it('picking the DEFAULT texture in the Lab still shows it, not the Settings pick; Reset hands back', async () => {
    localStorage.setItem('ascent.backdrop', 'stone');
    await import('./backdrop');
    const lab = await import('./layoutConfig');
    lab.setLayoutString('btexImg', 'oak');
    expect(rootVar('--btex-img')).toContain('/backdrop-oak-planks.webp');
    // Every other Backdrop knob is written too, so the Lab shows ONE coherent backdrop.
    expect(rootVar('--btex-size')).not.toBe('');
    lab.resetLayout();
    expect(rootVar('--btex-img')).toBe('');
    expect(rootVar('--btex-size')).toBe('');
  });
});

describe('single-image (cover) backdrops', () => {
  it('a cover texture fills the window; a tile texture repeats', async () => {
    const { backdropFit, BACKDROP_TEXTURES } = await import('./layoutConfig');
    expect(BACKDROP_TEXTURES.runicSlate?.cover).toBe(true);
    expect(backdropFit('runicSlate')).toBe('cover');
    expect(backdropFit('oak')).toBe('tile');
    expect(backdropFit('nope')).toBe('tile');
  });

  it('the Lab flags its fit only while it drives the backdrop, and Reset hands back', async () => {
    await import('./backdrop');
    const lab = await import('./layoutConfig');
    const html = document.documentElement;
    expect(html.dataset.btexFit).toBeUndefined();
    lab.setLayoutString('btexImg', 'runicSlate');
    expect(html.dataset.btexFit).toBe('cover');
    lab.setLayoutString('btexImg', 'stone');
    expect(html.dataset.btexFit).toBe('tile');
    lab.resetLayout();
    expect(html.dataset.btexFit).toBeUndefined();
  });

  it('every painted image is in Settings and fills the window when picked', async () => {
    const b = await import('./backdrop');
    const { BACKDROP_TEXTURES } = await import('./layoutConfig');
    const covers = Object.keys(BACKDROP_TEXTURES).filter((t) => BACKDROP_TEXTURES[t]!.cover);
    expect(covers.length).toBeGreaterThanOrEqual(10);
    for (const tex of covers) {
      const id = b.BACKDROP_IDS.find((i) => b.BACKDROPS[i].texture === tex);
      expect(id, tex).toBeTruthy();
      b.setBackdrop(id!);
      expect(document.documentElement.dataset.bdFit, tex).toBe('cover');
    }
    b.setBackdrop('oak');
    expect(document.documentElement.dataset.bdFit).toBeUndefined();
  });

  it('a tile Settings pick never carries the cover flag', async () => {
    localStorage.setItem('ascent.backdrop', 'oak');
    await import('./backdrop');
    expect(document.documentElement.dataset.bdFit).toBeUndefined();
  });
});
