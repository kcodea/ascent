// @vitest-environment jsdom
/**
 * BOARD BACKDROP (owner 2026-10-28): the player's Settings pick writes its preset's vars, survives a reload, and the
 * DEV Layout Lab only overrides it once a Backdrop control is touched, but then shows exactly what the Lab is set to,
 * defaults included (R-BACKDROP-LAB-01: "cobblestone ... is currently wood in the tuner for some reason when selected").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  vi.resetModules();
});
afterEach(() => { localStorage.clear(); document.documentElement.removeAttribute('style'); });

describe('the Settings backdrop pick', () => {
  it('defaults to Oak planks and writes its preset', async () => {
    const b = await import('./backdrop');
    expect(b.getBackdrop()).toBe('oak');
    expect(rootVar('--bd-img')).toContain('/backdrop-oak-planks.webp');
    expect(rootVar('--bd-size')).toBe(`${b.BACKDROPS.oak.size}px`);
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
