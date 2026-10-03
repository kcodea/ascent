// @vitest-environment jsdom
/**
 * THE SCENE BUILDER'S PORTRAIT HERO PICKER (owner ask 2026-10-03). Pins:
 *  1. the order: current heroes A to Z, then every archived hero as one block at the bottom;
 *  2. the Set 3 Ancients check is DERIVED from `ANCIENT_PAIRINGS` (full / partial / none), never a hand list;
 *  3. the grid's keyboard model (`heroGridMove`) across the two sections;
 *  4. the panel: the trigger opens the flyout, a click picks (restarting the sandbox on that hero) and closes it,
 *     the keyboard walks + picks, Escape and an outside click close it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { ANCIENT_IDS, ANCIENT_PAIRINGS, HEROES, isArchivedHero, type AncientPairing } from '@game/sim';

vi.mock('./remoteBoards', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./remoteBoards')>();
  return {
    ...mod,
    uploadBoards: vi.fn(async () => {}),
    uploadVictory: vi.fn(async () => {}),
    uploadRunTelemetry: vi.fn(async () => {}),
    uploadRunHistory: vi.fn(async () => {}),
    uploadPlayerProfile: vi.fn(async () => {}),
    recordFightResult: vi.fn(async () => {}),
    refreshOpponentPoolAndRecords: vi.fn(),
  };
});

import { mount, type Mounted } from './renderedText.mount';
import { SceneBuilder } from './SceneBuilder';
import { HERO_PICKER_COLS, heroGridMove } from './SceneBuilderHeroPicker';
import { HERO_PICKS, ancientCoverageOf, ancientTally, heroPickerSections } from './sceneBuilderHeroes';
import { useGame } from './store';

describe('hero order', () => {
  it('lists EVERY hero: current ones A to Z, then the archived ones A to Z, clumped at the bottom', () => {
    expect(HERO_PICKS.map((h) => h.id).sort()).toEqual(HEROES.map((h) => h.id).sort());
    const firstArchived = HERO_PICKS.findIndex((h) => h.archived);
    expect(firstArchived).toBeGreaterThan(0);
    expect(HERO_PICKS.slice(0, firstArchived).every((h) => !h.archived)).toBe(true);
    expect(HERO_PICKS.slice(firstArchived).every((h) => h.archived)).toBe(true);
    for (const part of [HERO_PICKS.slice(0, firstArchived), HERO_PICKS.slice(firstArchived)]) {
      expect(part.map((h) => h.name)).toEqual([...part.map((h) => h.name)].sort((a, b) => a.localeCompare(b)));
    }
    for (const h of HEROES) expect(HERO_PICKS.find((p) => p.id === h.id)!.archived, h.id).toBe(isArchivedHero(h));
  });

  it('the search filters both sections (all terms must match)', () => {
    const { active, archived } = heroPickerSections('war den');
    expect(active.map((h) => h.id)).toContain('warden');
    expect([...active, ...archived].every((h) => h.hay.includes('war') && h.hay.includes('den'))).toBe(true);
    expect(heroPickerSections('zzzz-no-hero')).toEqual({ active: [], archived: [] });
  });
});

describe('the Set 3 Ancients check comes from the pairing registry', () => {
  it('full = all six pairings written, none = no entry, for every hero', () => {
    for (const h of HERO_PICKS) {
      const written = ANCIENT_IDS.filter((id) => ANCIENT_PAIRINGS[h.id]?.[id] !== undefined).length;
      expect(h.coverage, h.id).toBe(written === 0 ? 'none' : written === ANCIENT_IDS.length ? 'full' : 'partial');
      expect(h.ancients.length, h.id).toBe(written);
    }
    // the registry's heroes are the checked ones (13 today; the number moves as pairings land)
    expect(HERO_PICKS.filter((h) => h.coverage !== 'none').map((h) => h.id).sort()).toEqual(Object.keys(ANCIENT_PAIRINGS).sort());
    const t = ancientTally();
    expect(t.full + t.partial).toBe(HERO_PICKS.filter((h) => !h.archived && h.coverage !== 'none').length);
  });

  it('writing a pairing into the registry flips the hero (no hand list to update)', () => {
    const id = HERO_PICKS.find((h) => h.coverage === 'none' && !h.archived)!.id;
    expect(ancientCoverageOf(id)).toBe('none');
    const stub: AncientPairing = { offerText: 'x', powerText: 'x', effects: [] };
    ANCIENT_PAIRINGS[id] = { death: stub, war: stub };
    try {
      expect(ancientCoverageOf(id)).toBe('partial');
      ANCIENT_PAIRINGS[id] = Object.fromEntries(ANCIENT_IDS.map((a) => [a, stub]));
      expect(ancientCoverageOf(id)).toBe('full');
    } finally {
      delete ANCIENT_PAIRINGS[id];
    }
    expect(ancientCoverageOf(id)).toBe('none');
  });
});

describe('heroGridMove (5 columns, two sections)', () => {
  const C = HERO_PICKER_COLS;
  const sizes = [12, 7] as const; // current: rows of 5,5,2 · archived: rows of 5,2
  it('left / right step one tile and clamp at the ends', () => {
    expect(heroGridMove(0, 'ArrowLeft', sizes)).toBe(0);
    expect(heroGridMove(0, 'ArrowRight', sizes)).toBe(1);
    expect(heroGridMove(18, 'ArrowRight', sizes)).toBe(18);
    expect(heroGridMove(11, 'ArrowRight', sizes)).toBe(12); // across the section break
  });
  it('down / up move a row, crossing into the archived block at the same column', () => {
    expect(heroGridMove(1, 'ArrowDown', sizes)).toBe(1 + C);
    expect(heroGridMove(8, 'ArrowDown', sizes)).toBe(11); // the short last row: its last tile
    expect(heroGridMove(11, 'ArrowDown', sizes)).toBe(12 + 1); // col 1 of the archived block
    expect(heroGridMove(13, 'ArrowUp', sizes)).toBe(11); // back into the short last row
    expect(heroGridMove(14, 'ArrowUp', sizes)).toBe(11); // col 2 -> clamps to the row's last tile
    expect(heroGridMove(2, 'ArrowUp', sizes)).toBe('search'); // off the top row
    expect(heroGridMove(17, 'ArrowDown', sizes)).toBe(17); // bottom row stays
  });
  it('an empty section is skipped', () => {
    expect(heroGridMove(2, 'ArrowDown', [3, 0])).toBe(2);
    expect(heroGridMove(1, 'ArrowUp', [0, 4])).toBe('search');
  });
});

describe('the picker in the panel', () => {
  let ui: Mounted | null = null;
  const click = (el: Element | null | undefined): void => {
    expect(el).toBeTruthy();
    act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  };
  const key = (el: Element | null | undefined, k: string): void => {
    expect(el).toBeTruthy();
    act(() => { el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
  };
  const flyout = (): HTMLElement | null => document.querySelector<HTMLElement>('.sbhp');
  const trigger = (): HTMLButtonElement => ui!.container.querySelector<HTMLButtonElement>('.sbhp-trigger')!;

  beforeEach(() => {
    localStorage.clear();
    useGame.setState({ sbRules: 'god', sbBotLevel: 5, sbEditMode: false, sbTavernShowsEnemy: false });
    useGame.getState().startSceneBuilder('warden', 'set3');
    ui = mount(<SceneBuilder />);
  });
  afterEach(() => { ui?.unmount(); ui = null; localStorage.clear(); });

  it('the trigger opens a grid of every hero; the current one is highlighted; archived ones sit last', () => {
    expect(trigger().textContent).toContain('Warden');
    expect(flyout()).toBeNull();
    click(trigger());
    const tiles = [...flyout()!.querySelectorAll<HTMLElement>('.sbhp-tile')];
    expect(tiles.map((t) => t.dataset.hero)).toEqual(HERO_PICKS.map((h) => h.id));
    expect(flyout()!.querySelector('.sbhp-tile.cur')?.getAttribute('data-hero')).toBe('warden');
    const firstArch = tiles.findIndex((t) => t.classList.contains('arch'));
    expect(tiles.slice(firstArch).every((t) => t.classList.contains('arch'))).toBe(true);
    expect(flyout()!.querySelector('.sbhp-sec')?.textContent).toMatch(/^Archived/);
  });

  it('Set 3: a check on exactly the registry heroes, plus the legend and tally', () => {
    click(trigger());
    const checked = [...flyout()!.querySelectorAll('.sbhp-tile')].filter((t) => t.querySelector('.sbhp-anc')).map((t) => t.getAttribute('data-hero')).sort();
    expect(checked).toEqual(Object.keys(ANCIENT_PAIRINGS).sort());
    expect(flyout()!.querySelector('.sbhp-legend')?.textContent).toContain('has Ancients');
    const t = ancientTally();
    expect(flyout()!.querySelector('.sbhp-tally')?.textContent).toContain(`${t.full} / ${t.current} heroes`);
  });

  it('a click picks the hero (the sandbox restarts on them) and closes the flyout', () => {
    click(trigger());
    click(flyout()!.querySelector('[data-hero="albus"]'));
    expect(useGame.getState().run.heroId).toBe('albus');
    expect(useGame.getState().run.setId).toBe('set3');
    expect(flyout()).toBeNull();
    expect(trigger().textContent).toContain('Albus');
  });

  it('an archived hero is still pickable', () => {
    const arch = HERO_PICKS.find((h) => h.archived)!;
    click(trigger());
    click(flyout()!.querySelector(`[data-hero="${arch.id}"]`));
    expect(useGame.getState().run.heroId).toBe(arch.id);
  });

  it('keyboard: ↓ from the search walks to the current hero, → moves, ↵ picks', () => {
    click(trigger());
    const search = flyout()!.querySelector<HTMLInputElement>('.sbhp-search')!;
    expect(document.activeElement).toBe(search);
    key(search, 'ArrowDown');
    expect((document.activeElement as HTMLElement).dataset.hero).toBe('warden');
    key(document.activeElement, 'ArrowLeft');
    const prev = HERO_PICKS[HERO_PICKS.findIndex((h) => h.id === 'warden') - 1]!;
    expect((document.activeElement as HTMLElement).dataset.hero).toBe(prev.id);
    key(document.activeElement, 'Enter');
    expect(useGame.getState().run.heroId).toBe(prev.id);
    expect(flyout()).toBeNull();
  });

  it('typing filters and ↵ in the box picks the top match', () => {
    click(trigger());
    const search = flyout()!.querySelector<HTMLInputElement>('.sbhp-search')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(search, 'hunch');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect([...flyout()!.querySelectorAll('.sbhp-tile')].map((t) => t.getAttribute('data-hero'))).toEqual(['hunch']);
    key(search, 'Enter');
    expect(useGame.getState().run.heroId).toBe('hunch');
  });

  it('Escape and an outside click close it without changing the hero', () => {
    click(trigger());
    key(flyout()!.querySelector('.sbhp-search'), 'Escape');
    expect(flyout()).toBeNull();
    click(trigger());
    expect(flyout()).not.toBeNull();
    act(() => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(flyout()).toBeNull();
    expect(useGame.getState().run.heroId).toBe('warden');
  });
});
