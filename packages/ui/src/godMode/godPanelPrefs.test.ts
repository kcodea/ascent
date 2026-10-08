// packages/ui/src/godMode/godPanelPrefs.test.ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { loadGodPanelPrefs, saveGodPanelPrefs } from './godPanelPrefs';

afterEach(() => localStorage.clear());
describe('godPanelPrefs', () => {
  it('round-trips and survives junk', () => {
    saveGodPanelPrefs({ x: 40, y: 90, collapsed: true, tiers: [3, 5], tribes: ['demon', 'neutral'] });
    expect(loadGodPanelPrefs()).toEqual({ x: 40, y: 90, collapsed: true, tiers: [3, 5], tribes: ['demon', 'neutral'] });
    localStorage.setItem('ascent.godmode.panel', '{nope');
    expect(loadGodPanelPrefs().tiers).toEqual([]);
  });
});
