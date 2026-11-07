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
import { pageFitZoom } from './HeroSelectPhSkin';

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

describe('round 6', () => {
  const offer = (ids: string[]): HTMLElement => {
    act(() => { setPartyHome(true); useGame.setState({ pendingMode: 'ascent', heroChoices: ids, heroReroll: null, rankedEntry: null }); });
    ui = mount(<HeroSelect />);
    return ui.container;
  };
  it('the difficulty pill shows only when it tells the offers apart', () => {
    expect(offer(['indy', 'warden', 'soren']).querySelectorAll('.hcdiff')).toHaveLength(3); // Easy, Easy, Hard
    ui?.unmount();
    expect(offer(['indy', 'warden']).querySelector('.hcdiff')).toBeNull(); // Easy, Easy
  });
  it('R-HS-DIFF-OUT-01: the difficulty sits under the flag, and the power description is the light weight', () => {
    const root = offer(['indy', 'warden', 'soren']);
    const diffs = [...root.querySelectorAll('.hcdiff')];
    expect(diffs).toHaveLength(3);
    for (const d of diffs) {
      expect(d.closest('.herocard')).toBeNull();
      expect(d.parentElement!.classList.contains('hcslot')).toBe(true);
    }
    const css = here('./heroSelectPh.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.herocard\.big \.hcpw \{[^}]*font-weight: 400/);
  });
  it('R-HS-POWER-FOCUS-01: rest shows name, medallions and power name + cost; hover hands the focus to the power', () => {
    const root = offer(['indy', 'warden', 'soren']);
    const card = root.querySelector('.herocard.big')!;
    expect(card.querySelector('.hchp .healthmedal')).not.toBeNull();
    expect(card.querySelector('.hcpw-title.hcname')).not.toBeNull();
    expect(card.querySelector('.hcpw-titlecost')).not.toBeNull();
    // The difficulty sits ABOVE the flag: the first thing in its slot.
    expect(root.querySelector('.hcslot')!.firstElementChild!.classList.contains('hcdiff-out')).toBe(true);
    const css = here('./heroSelectPh.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.herocard\.big :is\(\.hcpw-title, \.hcpw-titlecost, \.hcpw-body, \.hclock\) \{ opacity: 0; \}/);
    expect(css).toMatch(/\.herocard\.big:is\(:hover, :focus-visible, \.tt-on\) :is\(\.hcpw-title, \.hcpw-titlecost, \.hcpw-body, \.hclock\) \{ opacity: 1; \}/);
    expect(css).toMatch(/\.herocard\.big:is\(:hover, :focus-visible, \.tt-on\) :is\(\.hcname:not\(\.hcpw-title\), \.hchp, \.hcpw-head\) \{ opacity: 0; \}/);
  });
  it('every hero name is whole, and every power is on the card (no hover needed)', () => {
    const css = here('./heroSelectPh.css');
    const name = css.slice(css.indexOf('.hcname.hudpill-name {'));
    expect(name.slice(0, name.indexOf('}'))).toMatch(/white-space: normal/);
    expect(name.slice(0, name.indexOf('}'))).not.toMatch(/ellipsis/);
    expect(css).toMatch(/\.hcbelow > :is\(\.hcpw, \.hcmeta\) \{[^}]*opacity: 1/);
    expect(offer(['keshi', 'indy']).textContent).toContain('Keshi the Protector');
  });
  it('fits itself when the browser ignored the page scale, and only then', () => {
    expect(pageFitZoom(true, 2337, 844)).toBeCloseTo(0.361, 3);
    expect(pageFitZoom(true, 2337, 2337)).toBe(1); // the viewport meta did its job
    expect(pageFitZoom(false, 2337, 844)).toBe(1); // no page scale in play
    expect(pageFitZoom(true, Number.NaN, 844)).toBe(1);
  });
});

describe('the cleanup pass', () => {
  it('hover is lighting only and nothing draws an underline', () => {
    const css = here('./heroSelectPh.css').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]*:(?:hover|active)[^{}]*)\{([^}]*)\}/g)) {
      expect(m[2]!.replace(/(?:transform|translate|scale): none;?/g, ''), m[1]).not.toMatch(/\b(?:transform|translate|scale):/);
    }
    expect(css).toMatch(/\.hsprompt::after \{ content: none; \}/);
    expect(css).not.toMatch(/divider\.webp/);
  });
});

describe('the mode line', () => {
  it('R-HS-CENTRE-01: the portrait and text sit on the flag\'s centre line, never a one-sided inset', () => {
    // The card is a column with align-items: center, which centres each child's MARGIN box: a one-sided horizontal margin
    // on a banner child shifts it half that margin off the flag (owner 2026-11-06: "these are off center").
    const css = here('./heroSelectPh.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = css.split('}').map((r) => r.split('{')).filter((p) => p.length === 2) as [string, string][];
    const inset = rules.filter(([sel]) => /\.herocard\.big\s*>\s*(?::is\([^)]*\.hc(?:frame|below)|\.hc(?:frame|below))/.test(sel));
    expect(inset.length).toBeGreaterThan(0);
    for (const [sel, body] of inset) {
      expect(body, sel).not.toMatch(/(^|[;\s])margin-(left|right)\s*:/);
    }
    expect(inset.some(([, body]) => /margin-inline\s*:\s*auto/.test(body))).toBe(true);
  });

  it('R-HS-WASH-01: the hover wash fades to nothing inside the cloth, never a box edge', () => {
    // owner 2026-11-07: "when highlighting a flag, ther is a glow with hard edges that shows".
    const css = here('./heroSelectPh.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const washes = [...css.matchAll(/\.herocard\.big::after \{([^}]*)\}/g)].map((m) => m[1]!);
    const last = washes[washes.length - 1]!;
    expect(last).toMatch(/inset: calc\(100cqi \* 96 \/ 784\) calc\(100cqi \* 58 \/ 784\)/);
    expect(last).toMatch(/radial-gradient\(closest-side[^;]*0\) 100%\)/);
  });

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
  it('the skin is lazy and keeps to the UI rules', () => {
    expect(here('../HeroSelect.tsx')).toMatch(/= lazy\(loadPhSkin\)/);
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
