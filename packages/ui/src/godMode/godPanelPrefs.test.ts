// packages/ui/src/godMode/godPanelPrefs.test.ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { clampGodPanelPos, loadGodPanelPrefs, saveGodPanelPrefs } from './godPanelPrefs';

afterEach(() => localStorage.clear());
describe('godPanelPrefs', () => {
  it('round-trips and survives junk', () => {
    saveGodPanelPrefs({ x: 40, y: 90, collapsed: true, tiers: [3, 5, 7], tribes: ['demon', 'neutral'] });
    expect(loadGodPanelPrefs()).toEqual({ x: 40, y: 90, collapsed: true, tiers: [3, 5, 7], tribes: ['demon', 'neutral'] });
    localStorage.setItem('ascent.godmode.panel', JSON.stringify({ tiers: [0, 7, 8, 2.5] }));
    expect(loadGodPanelPrefs().tiers).toEqual([7]);
    localStorage.setItem('ascent.godmode.panel', '{nope');
    expect(loadGodPanelPrefs().tiers).toEqual([]);
  });
  it('clamps a saved spot onto the stage, header grabbable (a narrower window can never strand the panel)', () => {
    const vp = { w: 1024, h: 768 };
    expect(clampGodPanelPos({ x: 40, y: 90 }, vp)).toEqual({ x: 40, y: 90 });
    expect(clampGodPanelPos({ x: 3000, y: 2000 }, vp)).toEqual({ x: 904, y: 728 });
    expect(clampGodPanelPos({ x: -50, y: -10 }, vp)).toEqual({ x: 0, y: 0 });
    expect(clampGodPanelPos({ x: Number.NaN, y: 10.6 }, vp)).toEqual({ x: 0, y: 11 });
    expect(clampGodPanelPos({ x: 500, y: 500 }, { w: 60, h: 20 })).toEqual({ x: 0, y: 0 });
  });
});
