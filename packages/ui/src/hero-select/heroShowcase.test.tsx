// @vitest-environment jsdom
/**
 * THE HERO SELECT SHOWCASE BODY (owner 2026-11-16, DEV switch "Hero Select: showcase layout"): a row of hero tiles with a
 * sliding gold glow and a corner re-roll, the shared inspect card for the selected hero with prev / next arrows, and a big
 * Select Hero button. Presentation only: every press is a callback, HeroSelect owns the rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRef, type MutableRefObject } from 'react';
import { HEROES, getHero } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { setPartyHome } from '../partyHome/partyHomeFlag';
import { rememberAncient } from '../HeroAncients';
import { setHeroShowcase } from './heroShowcaseFlag';
import { HeroShowcase, type HeroShowcaseProps } from './HeroShowcase';

const OFFER = ['aster', 'warden', 'soren'] as const;

const props = (over: Partial<HeroShowcaseProps> = {}): HeroShowcaseProps => ({
  choices: OFFER,
  selected: 0,
  onSelect: vi.fn(),
  onConfirm: vi.fn(),
  onDenied: vi.fn(),
  blocked: null,
  canReroll: false,
  onReroll: vi.fn(),
  swapping: null,
  mateTaken: null,
  watching: false,
  showDifficulty: false,
  loadout: null,
  artRef: createRef<HTMLDivElement>(),
  slotEls: { current: [] } as MutableRefObject<(HTMLDivElement | null)[]>,
  ...over,
});

/** The real host: HeroSelect renders the body inside this root, which supplies the shell's tokens. */
const host = (...ps: HeroShowcaseProps[]) => (
  <div className="heroselect phhs ph-tokens hss">
    {ps.map((p, i) => <HeroShowcase key={i} {...p} />)}
  </div>
);

let ui: Mounted | null = null;
const show = (...ps: HeroShowcaseProps[]): HTMLElement => { ui = mount(host(...ps)); return ui.container; };
const click = (el: Element | null | undefined): void => { act(() => { (el as HTMLElement).click(); }); };
const keyOn = (el: EventTarget, key: string): void => { act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }); };

beforeEach(() => { act(() => { setPartyHome(true); setHeroShowcase(true); }); rememberAncient('death'); });
afterEach(() => { ui?.unmount(); ui = null; act(() => { setPartyHome(false); setHeroShowcase(false); }); });

describe('Hero Select showcase body', () => {
  it('renders one tile per offer with name, Health and Armor; the selected slot is .on', () => {
    const p = props();
    const el = show(p);
    const slots = [...el.querySelectorAll('.hss-slot')];
    expect(slots).toHaveLength(3);
    expect(slots[0]!.classList.contains('on')).toBe(true);
    expect(slots[1]!.classList.contains('on')).toBe(false);
    const aster = getHero('aster');
    expect(slots[0]!.querySelector('.hss-name')!.textContent).toBe(aster.name);
    const vitals = slots[0]!.querySelector('.hss-vitals')!;
    expect(vitals.querySelector('.hss-hp')!.textContent).toContain(String(aster.resolve));
    if (aster.armor > 0) expect(vitals.querySelector('.hss-arm')!.textContent).toContain(String(aster.armor));
    OFFER.forEach((id, i) => {
      const h = getHero(id);
      expect(slots[i]!.querySelector('.hss-name')!.textContent).toBe(h.name);
      expect(slots[i]!.querySelector('.hss-hp')!.textContent).toContain(String(h.resolve));
      expect(!!slots[i]!.querySelector('.hss-arm')).toBe(h.armor > 0);
    });
    const tiles = [...el.querySelectorAll('.hss-tile')];
    expect(tiles.map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    // The slot refs are handed back for the ceremony, and the card shows the selected hero.
    expect(p.slotEls.current).toEqual(slots);
    expect(el.querySelector('.hss-stage .phi.hss-card .phi-name')!.textContent).toBe(aster.name);
    expect(p.artRef.current).toBe(el.querySelector('.hss-card .phi-art'));
    expect(el.querySelector('.hss-tiles > i.hss-glow')).not.toBeNull();
  });

  it('a tile click calls onSelect with its index and never onConfirm', () => {
    const p = props();
    const el = show(p);
    click(el.querySelectorAll('.hss-tile')[2]);
    expect(p.onSelect).toHaveBeenCalledTimes(1);
    expect(p.onSelect).toHaveBeenCalledWith(2);
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('arrows and Left/Right wrap', () => {
    const p = props({ selected: 0 });
    const el = show(p);
    click(el.querySelector('.hss-stage .phi-nav.is-prev'));
    expect(p.onSelect).toHaveBeenLastCalledWith(2);
    click(el.querySelector('.hss-stage .phi-nav.is-next'));
    expect(p.onSelect).toHaveBeenLastCalledWith(1);
    ui!.unmount(); ui = null;

    const q = props({ selected: 2 });
    const el2 = show(q);
    keyOn(el2.querySelector('.hss-body')!, 'ArrowRight');
    expect(q.onSelect).toHaveBeenLastCalledWith(0);
    keyOn(el2.querySelector('.hss-body')!, 'ArrowLeft');
    expect(q.onSelect).toHaveBeenLastCalledWith(1);
    expect(q.onConfirm).not.toHaveBeenCalled();
  });

  it('one offer has no arrows', () => {
    const el = show(props({ choices: ['aster'] }));
    expect(el.querySelector('.phi-nav')).toBeNull();
  });

  it('Up/Down step the Ancient on show', () => {
    const el = show(props());
    const body = el.querySelector('.hss-body')!;
    const shown = (): string => (el.querySelector('.hanc-text.is-on') as HTMLElement).dataset.ancient ?? '';
    const first = shown();
    keyOn(body, 'ArrowDown');
    const second = shown();
    expect(second).not.toBe(first);
    keyOn(body, 'ArrowUp');
    expect(shown()).toBe(first);
  });

  it('keys are scoped to the body', () => {
    const a = props();
    const b = props();
    const el = show(a, b);
    const bodies = el.querySelectorAll('.hss-body');
    expect(bodies).toHaveLength(2);
    keyOn(bodies[0]!, 'ArrowRight');
    expect(a.onSelect).toHaveBeenCalledWith(1);
    expect(b.onSelect).not.toHaveBeenCalled();
    keyOn(window, 'ArrowRight');
    keyOn(document, 'ArrowLeft');
    expect(a.onSelect).toHaveBeenCalledTimes(1);
    expect(b.onSelect).not.toHaveBeenCalled();
  });

  it('the body takes focus on mount unless watching', () => {
    const el = show(props());
    expect(document.activeElement).toBe(el.querySelector('.hss-body'));
    ui!.unmount(); ui = null;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const w = show(props({ watching: true }));
    expect(document.activeElement).not.toBe(w.querySelector('.hss-body'));
  });

  it('re-roll buttons show only while canReroll and call onReroll(slot) without onSelect', () => {
    const off = show(props({ canReroll: false }));
    expect(off.querySelector('.hss-reroll')).toBeNull();
    ui!.unmount(); ui = null;

    const p = props({ canReroll: true });
    const el = show(p);
    const rerolls = [...el.querySelectorAll('.hss-slot > button.hss-reroll.gtip')];
    expect(rerolls).toHaveLength(3);
    const warden = getHero('warden');
    expect(rerolls[1]!.getAttribute('aria-label')).toBe(`Re-roll ${warden.name}. Swaps this hero for a new one. One re-roll per hero select.`);
    expect(rerolls[1]!.getAttribute('data-tip')).toBe('Re-roll this hero. Once per hero select.');
    expect(rerolls[1]!.hasAttribute('title')).toBe(false);
    // A sibling of the tile, never inside it.
    expect(rerolls[1]!.closest('.hss-tile')).toBeNull();
    click(rerolls[1]);
    expect(p.onReroll).toHaveBeenCalledWith(1);
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('a swapping slot plays the swap on its tile portrait', () => {
    const el = show(props({ choices: ['aster', 'warden', 'soren'], swapping: { slot: 1, from: 'aster' } }));
    const slot = el.querySelectorAll('.hss-slot')[1]!;
    expect(slot.classList.contains('swapping')).toBe(true);
    expect(slot.querySelector('.hcswap-in')).not.toBeNull();
    expect(slot.querySelector('.hcswap-out')).not.toBeNull();
    expect(slot.querySelector('.rfb-shine')).not.toBeNull();
    expect(el.querySelectorAll('.hss-slot')[0]!.querySelector('.hcswap-out')).toBeNull();
  });

  it("the teammate's hero is marked taken and labelled", () => {
    const el = show(props({ mateTaken: 'warden' }));
    const slot = el.querySelectorAll('.hss-slot')[1]!;
    expect(slot.classList.contains('taken')).toBe(true);
    expect(slot.textContent).toContain("Your teammate's pick");
    expect(el.querySelectorAll('.hss-slot.taken')).toHaveLength(1);
  });

  it('Select Hero: allowed → onConfirm; blocked "mate" → aria-disabled, label "Taken by your teammate", onDenied', () => {
    const p = props();
    const el = show(p);
    const btn = el.querySelector('button.hss-confirm.phk-btn.v-primary')!;
    expect(btn.textContent).toBe('Select Hero');
    expect(btn.getAttribute('aria-disabled')).not.toBe('true');
    click(btn);
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    expect(p.onDenied).not.toHaveBeenCalled();
    ui!.unmount(); ui = null;

    const q = props({ blocked: 'mate', mateTaken: 'aster' });
    const el2 = show(q);
    const b2 = el2.querySelector('.hss-confirm')!;
    expect(b2.getAttribute('aria-disabled')).toBe('true');
    expect(b2.textContent).toBe('Taken by your teammate');
    click(b2);
    expect(q.onDenied).toHaveBeenCalledTimes(1);
    expect(q.onConfirm).not.toHaveBeenCalled();
    ui!.unmount(); ui = null;

    for (const blocked of ['pending', 'busy'] as const) {
      const r = props({ blocked });
      const el3 = show(r);
      const b3 = el3.querySelector('.hss-confirm')!;
      expect(b3.getAttribute('aria-disabled')).toBe('true');
      expect(b3.textContent).toBe('Select Hero');
      click(b3);
      expect(r.onDenied).toHaveBeenCalledTimes(1);
      expect(r.onConfirm).not.toHaveBeenCalled();
      ui!.unmount(); ui = null;
    }
  });

  it('watching: no .hss-confirm', () => {
    const el = show(props({ watching: true }));
    expect(el.querySelector('.hss-confirm')).toBeNull();
    expect(el.querySelectorAll('.hss-tile')).toHaveLength(3); // still readable
  });

  it('difficulty chip only when showDifficulty', () => {
    const facts = (el: HTMLElement): string[] => [...el.querySelectorAll('.hss-card .phi-fact')].map((f) => f.textContent ?? '');
    // warden has an authored tip (Easy); aster has none, so its card never shows a difficulty.
    const off = show(props({ selected: 1, showDifficulty: false }));
    const without = facts(off);
    expect(without.some((t) => ['Easy', 'Medium', 'Hard'].includes(t))).toBe(false);
    ui!.unmount(); ui = null;
    const on = show(props({ selected: 1, showDifficulty: true }));
    const withIt = facts(on);
    expect(withIt).toHaveLength(without.length + 1);
    expect(withIt[withIt.length - 1]).toBe('Easy');
  });

  it('five offers render five tiles', () => {
    const five = ['aster', 'warden', 'soren', ...getHeroIds().filter((id) => !['aster', 'warden', 'soren'].includes(id)).slice(0, 2)];
    const p = props({ choices: five, selected: 4 });
    const el = show(p);
    expect(el.querySelectorAll('.hss-slot')).toHaveLength(5);
    expect(el.querySelectorAll('.hss-slot')[4]!.classList.contains('on')).toBe(true);
    keyOn(el.querySelector('.hss-body')!, 'ArrowRight');
    expect(p.onSelect).toHaveBeenLastCalledWith(0);
  });
});

function getHeroIds(): string[] { return HEROES.filter((h) => !h.practiceOnly && !h.duosOnly).map((h) => h.id); }
