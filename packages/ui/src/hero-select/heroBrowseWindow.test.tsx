// @vitest-environment jsdom
/**
 * THE "ALL HEROES" WINDOW (docs/superpowers/specs/2026-11-17-hero-select-all-heroes-design.md): the showcase's inspect card
 * and Select Hero button in a window over the roster grid, with an X, a scrim and Escape to close. Presentation only:
 * every press is a callback, HeroSelect owns the rules.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRef } from 'react';
import { HEROES, getHero, practiceHeroChoiceIds } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { setPartyHome } from '../partyHome/partyHomeFlag';
import { rememberAncient } from '../HeroAncients';
import { setHeroShowcase } from './heroShowcaseFlag';
import { HeroBrowseWindow, type HeroBrowseWindowProps } from './HeroBrowseWindow';

const ROSTER = [...practiceHeroChoiceIds('all')].sort((a, b) => getHero(a).name.localeCompare(getHero(b).name));

const props = (over: Partial<HeroBrowseWindowProps> = {}): HeroBrowseWindowProps => ({
  heroes: ROSTER,
  index: 0,
  onStep: vi.fn(),
  onClose: vi.fn(),
  onConfirm: vi.fn(),
  busy: false,
  showDifficulty: false,
  loadout: null,
  artRef: createRef<HTMLDivElement>(),
  ...over,
});

let ui: Mounted | null = null;
const show = (p: HeroBrowseWindowProps): HTMLElement => {
  ui = mount(<div className="heroselect phhs ph-tokens hsb hsb-open"><HeroBrowseWindow {...p} /></div>);
  return ui.container;
};
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
const keyOn = (el: EventTarget, key: string): void => { act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }); };
const win = (el: HTMLElement): HTMLElement => el.querySelector<HTMLElement>('.hsb-win')!;

beforeEach(() => { act(() => { setPartyHome(true); setHeroShowcase(true); }); rememberAncient('death'); });
afterEach(() => { ui?.unmount(); ui = null; act(() => { setPartyHome(false); setHeroShowcase(false); }); });

describe('HeroBrowseWindow', () => {
  it('shows the hero at index, with Select Hero, an X, and no tiles', () => {
    const el = show(props({ index: 4 }));
    expect(el.querySelector('.phi-name')!.textContent).toBe(getHero(ROSTER[4]!).name);
    expect(el.querySelector('.hss-confirm')!.textContent).toBe('Select Hero');
    expect(el.querySelector('.hsb-x')!.getAttribute('aria-label')).toBe('Close');
    expect(el.querySelector('.hss-tiles')).toBeNull();
    expect(win(el).getAttribute('role')).toBe('dialog');
    expect(win(el).getAttribute('aria-label')).toBe(getHero(ROSTER[4]!).name);
  });

  it('X, a scrim click and Escape each call onClose once and never onConfirm', () => {
    const p = props();
    const el = show(p);
    click(el.querySelector('.hsb-x'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
    click(el.querySelector('.hsb-scrim'));
    expect(p.onClose).toHaveBeenCalledTimes(2);
    keyOn(win(el), 'Escape');
    expect(p.onClose).toHaveBeenCalledTimes(3);
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('a click on the card, an arrow or Select Hero does not call onClose', () => {
    const p = props();
    const el = show(p);
    click(el.querySelector('.hss-card'));
    click(el.querySelector('.phi-nav.is-next'));
    click(el.querySelector('.hss-confirm'));
    expect(p.onClose).not.toHaveBeenCalled();
  });

  it('arrows and Left/Right call onStep with the wrapped index', () => {
    const first = props({ index: 0 });
    const el = show(first);
    click(el.querySelector('.phi-nav.is-prev'));
    expect(first.onStep).toHaveBeenLastCalledWith(ROSTER.length - 1);
    keyOn(win(el), 'ArrowRight');
    expect(first.onStep).toHaveBeenLastCalledWith(1);
    ui!.unmount();
    const last = props({ index: ROSTER.length - 1 });
    const el2 = show(last);
    click(el2.querySelector('.phi-nav.is-next'));
    expect(last.onStep).toHaveBeenLastCalledWith(0);
    keyOn(win(el2), 'ArrowLeft');
    expect(last.onStep).toHaveBeenLastCalledWith(ROSTER.length - 2);
  });

  it('Select Hero calls onConfirm', () => {
    const p = props();
    const el = show(p);
    click(el.querySelector('.hss-confirm'));
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('busy: X, scrim, Escape, arrows and keys call nothing; Select Hero is aria-disabled', () => {
    const p = props({ busy: true });
    const el = show(p);
    click(el.querySelector('.hsb-x'));
    click(el.querySelector('.hsb-scrim'));
    keyOn(win(el), 'Escape');
    keyOn(win(el), 'ArrowRight');
    click(el.querySelector('.hss-confirm'));
    expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onStep).not.toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
    expect(el.querySelector('.hss-confirm')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('a practiceOnly hero shows "Not currently enabled in Play"; another hero does not', () => {
    const only = HEROES.find((h) => h.practiceOnly && ROSTER.includes(h.id));
    const open = ROSTER.findIndex((id) => !getHero(id).practiceOnly);
    expect(open).toBeGreaterThanOrEqual(0);
    const plain = show(props({ index: open }));
    expect(plain.querySelector('.hsb-note')).toBeNull();
    ui!.unmount();
    if (!only) return; // no hero is withheld from Play right now: nothing to label
    const el = show(props({ index: ROSTER.indexOf(only.id) }));
    expect(el.querySelector('.hsb-note')!.textContent).toBe('Not currently enabled in Play');
  });

  it('takes focus on mount', () => {
    const el = show(props());
    expect(document.activeElement).toBe(win(el));
  });

  it('the X and the note sit in the card box, not loose in the stage', () => {
    const el = show(props());
    expect(el.querySelector('.hss-cardbox > .hsb-x')).not.toBeNull();
    expect(el.querySelector('.hss-cardbox > .hss-card')).not.toBeNull();
  });

  it('while the ceremony runs the window pieces take no pointer (they were given it back one by one)', () => {
    const file = './heroBrowseWindow.css'; // a variable, so Vite does not rewrite the URL into a served asset
    const css = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    expect(css).toContain('.heroselect.hsb.hsc-active .hsb-panel :is(.hss-stage > *, .hss-confirm) { pointer-events: none; }');
    // After the rule that hands the pointer back, so it wins at equal weight.
    expect(css.indexOf('.heroselect.hsb.hsc-active .hsb-panel :is(.hss-stage > *, .hss-confirm)')).toBeGreaterThan(css.indexOf('{ pointer-events: auto; }'));
    // The X floats just off the card box corner: wholly outside it (the plate is 44 units across).
    expect(css).not.toMatch(/.hsb-x {[^}]*(top|right):/);
  });

  it('has no title attribute anywhere', () => {
    const el = show(props());
    expect(el.querySelector('[title]')).toBeNull();
    expect(el.querySelector('title')).toBeNull();
  });
});
