// @vitest-environment jsdom
/**
 * BOARD BACKDROP (owner 2026-10-28): the player's Settings pick writes its backdrop's vars and survives a reload. Each
 * backdrop's tune comes from its preset, then the Background Tuner's saved file, then (DEV) its unsaved edits, and the
 * Layout Lab no longer touches the backdrop (R-BACKDROP-LAB-01, owner 2026-10-29: "lets make a standalone background
 * tuner. i dont want it in the scale and layout").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name);

const clearRoot = (): void => {
  const html = document.documentElement;
  html.removeAttribute('style');
  delete html.dataset.bdFit;
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
    expect(rootVar('--bd-size')).toBe(`${b.tuneOf('castle').size}px`);
    expect(rootVar('--bd-zoom')).toBe(String(b.tuneOf('castle').zoom));
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

describe('the Background Tuner (DEV)', () => {
  it('an edit to the backdrop on screen shows at once; Reset hands back what is saved', async () => {
    const b = await import('./backdrop');
    b.setBackdrop('castle');
    const saved = b.tuneOf('castle');
    b.setLiveTune('castle', 'zoom', 1.6);
    b.setLiveTune('castle', 'panX', -40);
    b.setLiveTune('castle', 'tint', '#123456');
    expect(rootVar('--bd-zoom')).toBe('1.6');
    expect(rootVar('--bd-pan-x')).toBe('-40');
    expect(rootVar('--bd-tint-col')).toBe('#123456');
    b.clearLiveTune();
    expect(rootVar('--bd-zoom')).toBe(String(saved.zoom));
    expect(rootVar('--bd-pan-x')).toBe(String(saved.panX));
  });

  it('an edit to another backdrop leaves the screen alone until that one is picked', async () => {
    const b = await import('./backdrop');
    b.setBackdrop('castle');
    b.setLiveTune('temple', 'zoom', 2);
    expect(rootVar('--bd-zoom')).toBe(String(b.tuneOf('castle').zoom));
    b.setBackdrop('temple');
    expect(rootVar('--bd-zoom')).toBe('2');
    b.clearLiveTune();
  });

  it('a malformed edit is ignored', async () => {
    const b = await import('./backdrop');
    b.setBackdrop('castle');
    const before = rootVar('--bd-tint-col');
    b.setLiveTune('castle', 'tint', 'red');
    b.setLiveTune('castle', 'zoom', Number.NaN);
    expect(rootVar('--bd-tint-col')).toBe(before);
    expect(rootVar('--bd-zoom')).toBe(String(b.tuneOf('castle').zoom));
  });

  it('what the tuner SAVED ships: it lays over the preset, and a bad entry is dropped', async () => {
    vi.doMock('./backdrop-tuning.json', () => ({
      default: { version: 1, backdrops: { castle: { zoom: 1.5, panX: -20, tint: 'bad' }, notABackdrop: { zoom: 2 } } },
    }));
    const b = await import('./backdrop');
    expect(b.tuneOf('castle')).toMatchObject({ zoom: 1.5, panX: -20, tint: b.TUNE_DEFAULTS.tint });
    expect(rootVar('--bd-zoom')).toBe('1.5');
    vi.doUnmock('./backdrop-tuning.json');
  });

  it('every slider fits what Save accepts, so a save never fails on a value the tuner can set', async () => {
    const { SPEC } = await import('./BackgroundTuner');
    const { BACKDROP_TUNING_RANGES } = await import('../../../apps/web/backdropTuningPlugin');
    const { NUMBER_KEYS } = await import('./backdrop');
    for (const k of NUMBER_KEYS) {
      const c = SPEC.controls.find((x) => x.key === k);
      expect(c, k).toBeTruthy();
      const [min, max] = BACKDROP_TUNING_RANGES[k]!;
      expect(c!.min, k).toBeGreaterThanOrEqual(min);
      expect(c!.max, k).toBeLessThanOrEqual(max);
    }
    expect(Object.keys(BACKDROP_TUNING_RANGES).sort()).toEqual([...NUMBER_KEYS].sort());
  });

  it('the Layout Lab has no Backdrop controls, and the board CSS reads only the backdrop\'s own vars', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const lab = await import('./layoutConfig');
    expect(lab.LAYOUT_VARS.filter((v) => v.group === 'Backdrop')).toEqual([]);
    expect(lab.LAYOUT_STR_VARS).toEqual([]);
    const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
    expect(css).not.toMatch(/--btex-|--bshadow-|data-btex-fit/);
    // Zoom grows the painted image's box; position slides it inside that box (so its edge never shows).
    expect(css).toMatch(/:root\[data-bd-fit='cover'\] \.boardbg-tex \{[^}]*inset: calc\(-40px - \(var\(--bd-zoom, 1\) - 1\) \* 50%\)/);
    expect(css).toMatch(/:root\[data-bd-fit='cover'\] \.boardbg-tex \{[^}]*background-position: 0 0, 0 0, calc\(50% - var\(--bd-pan-x, 0\) \* 0\.5%\)/);
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

  it('every painted image has a small phone copy on disk, and a pick writes it for touch devices', async () => {
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const b = await import('./backdrop');
    const { BACKDROP_TEXTURES, backdropSmallUrl } = await import('./layoutConfig');
    for (const [tex, t] of Object.entries(BACKDROP_TEXTURES)) {
      const sm = backdropSmallUrl(tex);
      if (!t.cover) { expect(sm, tex).toBeUndefined(); continue; }
      expect(sm, tex).toBe(t.url.replace('.webp', '-sm.webp'));
      expect(existsSync(resolve(__dirname, '../../../apps/web/public', sm!.slice(1))), sm).toBe(true);
    }
    b.setBackdrop('castle');
    expect(rootVar('--bd-img-sm')).toContain('/backdrop-castle-sm.webp');
    b.setBackdrop('oak');
    expect(rootVar('--bd-img-sm')).toContain('/backdrop-oak-planks.webp');
  });

  it('a tile Settings pick never carries the cover flag', async () => {
    localStorage.setItem('ascent.backdrop', 'oak');
    await import('./backdrop');
    expect(document.documentElement.dataset.bdFit).toBeUndefined();
  });
});
