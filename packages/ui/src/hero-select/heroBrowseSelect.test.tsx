// @vitest-environment jsdom
/**
 * HERO SELECT, WHOLE ROSTER, WITH THE SHOWCASE SWITCH ON (docs/superpowers/specs/2026-11-17-hero-select-all-heroes-design.md):
 * the grid stays today's grid; a card click opens the showcase window instead of picking; the X, the scrim and Escape close
 * it; only Select Hero picks, and the ceremony grows from the card's splash art. Switch off, the screen is today's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { getHero, practiceHeroChoiceIds } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { setPartyHome } from '../partyHome/partyHomeFlag';
import { rememberAncient } from '../HeroAncients';
import { setHeroShowcase } from './heroShowcaseFlag';
import { HeroSelect } from '../HeroSelect';
import { useGame } from '../store';
import { useOwnHeroPick, setOwnHeroPick } from './ownHeroPick';

// The ceremony's Pixi layer finds no WebGL under jsdom (as in heroShowcase.test.tsx).
vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const ALL = practiceHeroChoiceIds('all');
/** The grid's order: alphabetical by display name. */
const SHOWN = [...ALL].sort((a, b) => getHero(a).name.localeCompare(getHero(b).name));

let ui: Mounted | null = null;
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
const keyOn = (el: EventTarget, key: string): void => { act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }); };

const settle = async (): Promise<void> => {
  await act(async () => {
    await import('./HeroShowcase');
    await import('./HeroBrowseWindow');
    await import('./HeroSelectPhSkin');
    await new Promise((r) => setTimeout(r, 0));
  });
};
const open = async (o: { showcase?: boolean; ph?: boolean; choices?: string[] } = {}): Promise<HTMLElement> => {
  act(() => {
    setPartyHome(o.ph ?? true);
    setHeroShowcase(o.showcase ?? true);
    useGame.setState({ pendingMode: 'practice', heroChoices: o.choices ?? [...ALL], heroReroll: null, rankedEntry: null, pendingSeed: 4242 });
  });
  ui = mount(<HeroSelect />);
  await settle();
  return ui.container;
};
const root = (): Element => document.querySelector('.heroselect')!;
const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.hsrow.browse .herocard')];
const win = (): HTMLElement | null => document.querySelector<HTMLElement>('.hsb-win');
const cardName = (): string => document.querySelector('.hsb-win .phi-name')?.textContent ?? '';
/** Open the window on grid card `i` and let the lazy window resolve. */
const openCard = async (i: number): Promise<void> => { click(cards()[i]); await settle(); };

beforeEach(() => {
  // jsdom has no ResizeObserver (the browse grid measures its rows with one) and no scrollIntoView.
  vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  rememberAncient('death');
});
afterEach(() => {
  ui?.unmount(); ui = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  setOwnHeroPick(null);
  act(() => { setPartyHome(false); setHeroShowcase(false); useGame.setState({ heroChoices: null, heroReroll: null, rankedEntry: null }); });
});

describe('Hero Select whole roster with the showcase switch on', () => {
  it('the grid renders, no window, root has hsb and not hss', async () => {
    await open();
    expect(cards()).toHaveLength(ALL.length);
    expect(win()).toBeNull();
    expect(root().classList.contains('hsb')).toBe(true);
    expect(root().classList.contains('hsb-open')).toBe(false);
    expect(root().classList.contains('hss')).toBe(false);
  });

  it('a card click opens the window for that hero and starts no ceremony', async () => {
    await open();
    await openCard(2);
    expect(win()).not.toBeNull();
    expect(cardName()).toBe(getHero(SHOWN[2]!).name);
    expect(root().classList.contains('hsb-open')).toBe(true);
    expect(root().classList.contains('hsc-active')).toBe(false);
    expect(useOwnHeroPick.getState().heroId).toBeNull();
  });

  it('the X closes it without picking', async () => {
    await open();
    await openCard(1);
    click(document.querySelector('.hsb-x'));
    expect(win()).toBeNull();
    expect(root().classList.contains('hsb-open')).toBe(false);
    expect(root().classList.contains('hsc-active')).toBe(false);
  });

  it('a scrim click closes it without picking', async () => {
    await open();
    await openCard(1);
    click(document.querySelector('.hsb-scrim'));
    expect(win()).toBeNull();
    expect(root().classList.contains('hsc-active')).toBe(false);
  });

  it('Escape closes it without picking', async () => {
    await open();
    await openCard(1);
    keyOn(win()!, 'Escape');
    expect(win()).toBeNull();
    expect(useOwnHeroPick.getState().heroId).toBeNull();
  });

  it('stepping then closing returns focus to the last hero shown and scrolls it into view', async () => {
    const scrolled: { el: Element; arg: unknown }[] = [];
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = function (this: Element, arg: unknown): void { scrolled.push({ el: this, arg }); };
    await open();
    await openCard(0);
    click(document.querySelector('.hsb-win .phi-nav.is-next'));
    click(document.querySelector('.hsb-win .phi-nav.is-next'));
    expect(cardName()).toBe(getHero(SHOWN[2]!).name);
    keyOn(win()!, 'Escape');
    expect(document.activeElement).toBe(cards()[2]);
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]!.el).toBe(cards()[2]);
    expect(scrolled[0]!.arg).toEqual({ block: 'nearest' });
  });

  it('stepping back from the first hero wraps to the last', async () => {
    await open();
    await openCard(0);
    click(document.querySelector('.hsb-win .phi-nav.is-prev'));
    expect(cardName()).toBe(getHero(SHOWN[SHOWN.length - 1]!).name);
  });

  it('while open the grid row is inert; not after closing', async () => {
    await open();
    const row = document.querySelector<HTMLElement>('.hsrow.browse')!;
    expect(row.hasAttribute('inert')).toBe(false);
    await openCard(0);
    expect(row.hasAttribute('inert')).toBe(true);
    keyOn(win()!, 'Escape');
    expect(row.hasAttribute('inert')).toBe(false);
  });

  it('a new offer closes the window', async () => {
    await open();
    await openCard(3);
    act(() => { useGame.setState({ heroChoices: [...ALL].reverse() }); });
    await settle();
    expect(win()).toBeNull();
    expect(root().classList.contains('hsb-open')).toBe(false);
  });

  it('showcase switch off: a card click picks as today', async () => {
    await open({ showcase: false });
    expect(root().classList.contains('hsb')).toBe(false);
    click(cards()[2]);
    expect(win()).toBeNull();
    expect(root().classList.contains('hsc-active')).toBe(true);
    expect(useOwnHeroPick.getState().heroId).toBe(SHOWN[2]);
  });

  it('party home off: a card click picks as today', async () => {
    await open({ ph: false });
    expect(root().classList.contains('hsb')).toBe(false);
    click(cards()[2]);
    expect(win()).toBeNull();
    expect(root().classList.contains('hsc-active')).toBe(true);
  });
});
