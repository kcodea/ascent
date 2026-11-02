// @vitest-environment jsdom
/**
 * HERO SELECT IN THE PARTY HOME's LANGUAGE (DEV switch "Party home (prototype)", owner 2026-11-02). With the switch on the
 * screen wears the shell's look (banners, pills, the mode line) and keeps every behaviour; with it off, nothing changes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { HeroSelect } from '../HeroSelect';
import { useGame } from '../store';
import { setPartyHome } from '../partyHome/partyHomeFlag';
import { heroSelectEyebrow } from './heroSelectEyebrow';

const here = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; act(() => { setPartyHome(false); }); });

const open = (on: boolean, pendingMode: 'gauntlet' | 'ascent' | 'practice' = 'ascent'): HTMLElement => {
  act(() => { setPartyHome(on); useGame.setState({ pendingMode, heroChoices: ['aster', 'warden', 'soren'], heroReroll: null, rankedEntry: null }); });
  ui = mount(<HeroSelect />);
  return ui.container;
};

describe('Hero Select, party home look', () => {
  it('switch off: the shipped screen, unchanged', () => {
    const el = open(false);
    expect(el.querySelector('.heroselect')!.classList.contains('phhs')).toBe(false);
    expect(el.querySelector('.hsback')!.textContent).toBe('← Main Menu');
    expect(el.querySelector('.hs-eyebrow')).toBeNull();
    expect(el.querySelector('.hcrod, .hcfoot')).toBeNull();
  });

  it('switch on: banners, a Back pill, the mode line; the same three heroes and the same title', () => {
    const el = open(true);
    const root = el.querySelector('.heroselect')!;
    expect(root.classList.contains('phhs')).toBe(true);
    expect(root.classList.contains('ph-tokens')).toBe(true); // the shell's tokens, by the kit's opt-in class
    const back = el.querySelector('.hsback')!;
    expect(back.textContent).toBe('‹Back');
    expect(back.getAttribute('aria-label')).toBe('Back to the home screen');
    expect(el.querySelector('.hs-eyebrow')!.textContent).toBe('Ascent');
    expect(el.querySelector('.hsprompt')!.textContent).toBe('Select Your Hero');
    expect(el.querySelectorAll('.herocard.big')).toHaveLength(3);
    expect(el.querySelectorAll('.herocard .hcrod')).toHaveLength(3);
    expect(el.querySelectorAll('.herocard .hcfoot')).toHaveLength(3);
  });

  it('the Back pill still goes home', () => {
    const el = open(true);
    act(() => { el.querySelector('.hsback')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(useGame.getState().showTitle).toBe(true);
  });
});

describe('the mode line', () => {
  it('names the game the pick is for', () => {
    const base = { ranked: false, rankedDuos: false, watching: false };
    expect(heroSelectEyebrow({ ...base, mode: 'lobby', ranked: true })).toBe('Ranked');
    expect(heroSelectEyebrow({ ...base, mode: 'versus', rankedDuos: true })).toBe('Ranked Duos');
    expect(heroSelectEyebrow({ ...base, mode: 'versus' })).toBe('Versus');
    expect(heroSelectEyebrow({ ...base, mode: 'practice' })).toBe('Practice');
    expect(heroSelectEyebrow({ ...base, mode: 'gauntlet', gauntletStage: 3 })).toBe('Gauntlet: Dragons');
    expect(heroSelectEyebrow({ ...base, mode: 'gauntlet' })).toBe('Gauntlet');
    expect(heroSelectEyebrow({ ...base, mode: 'lobby', ranked: true, watching: true })).toBe('Watching: Ranked');
  });
});

describe('rules', () => {
  it('the skin is DEV only (lazy, null in production) and keeps to the UI rules', () => {
    expect(here('../HeroSelect.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(loadPhSkin\) : null/);
    const css = here('./heroSelectPh.css');
    expect(css).not.toMatch(/cursor:/);
    expect(css).not.toMatch(/infinite/);
    // Every rule is scoped to the new look (or the curtain / corner buttons it styles while the look is on).
    for (const sel of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0]!.trim()).filter((r) => r && !r.startsWith('@') && !r.startsWith('from') && !r.startsWith('to'))) {
      expect(sel, sel).toMatch(/phhs|\.hsc-curtain\.ph|\.hcrod|\.hcfoot|\.hsph-bd|\.hsback-arrow|^\.heroselect/);
    }
    expect(here('./heroSelectEyebrow.ts')).not.toMatch(/—|\s--\s|\b(Oath|climb)\b/);
  });
});
