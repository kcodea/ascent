// @vitest-environment jsdom
/**
 * THE HERO SELECT SHOWCASE BODY (owner 2026-11-16, DEV switch "Hero Select: showcase layout"): a row of hero tiles with a
 * sliding gold glow and a corner re-roll, the shared inspect card for the selected hero with prev / next arrows, and a big
 * Select Hero button. Presentation only: every press is a callback, HeroSelect owns the rules.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRef, type MutableRefObject } from 'react';
import { HEROES, getHero, heroTip, practiceHeroChoiceIds } from '@game/sim';
import { mount, type Mounted } from '../renderedText.mount';
import { setPartyHome } from '../partyHome/partyHomeFlag';
import { rememberAncient } from '../HeroAncients';
import { setHeroShowcase } from './heroShowcaseFlag';
import { HeroShowcase, type HeroShowcaseProps } from './HeroShowcase';
import { HeroSelect } from '../HeroSelect';
import { useGame } from '../store';
import { useVersus } from '../versus/versusStore';
import { useSpectate } from '../versus/spectate';
import { useOwnHeroPick, setOwnHeroPick } from './ownHeroPick';
import { sfx } from '../sfx';
import { resetIdentityForTests, setIdentity } from '../identity';
import type { HeroSelectFrame } from '../versus/spectatorView';

// The ceremony's Pixi layer finds no WebGL under jsdom (as in versus/spectateHeroSelect.test.tsx).
vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

// The Versus timeout pick is marked shown inside the forced jump's frame: counted here, still the real store write.
const shownCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('../versus/versusStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../versus/versusStore')>();
  return { ...actual, markVersusPickShown: (): void => { shownCalls.n++; actual.markVersusPickShown(); } };
});

// One switch for the "hero with no art" case: the screen and the ceremony read art through heroPortrait.
const noArt = { on: false };
vi.mock('../skins/skins', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../skins/skins')>();
  return { ...actual, heroPortrait: (...a: Parameters<typeof actual.heroPortrait>) => (noArt.on ? undefined : actual.heroPortrait(...a)) };
});

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
    // warden has an authored tip; aster has none, so its card never shows a difficulty. The expected chip is read from the tip.
    const off = show(props({ selected: 1, showDifficulty: false }));
    const without = facts(off);
    expect(without.some((t) => ['Easy', 'Medium', 'Hard'].includes(t))).toBe(false);
    ui!.unmount(); ui = null;
    const on = show(props({ selected: 1, showDifficulty: true }));
    const withIt = facts(on);
    expect(withIt).toHaveLength(without.length + 1);
    expect(withIt[withIt.length - 1]).toBe(heroTip('warden')!.difficulty);
  });

  it('focus returns to the body when the focused re-roll button goes away (so the arrows keep working)', () => {
    const p = props({ canReroll: true });
    const el = show(p);
    const reroll = el.querySelector<HTMLElement>('.hss-reroll')!;
    act(() => { reroll.focus(); });
    expect(document.activeElement).toBe(reroll);
    ui!.render(host({ ...p, canReroll: false }));
    expect(el.querySelector('.hss-reroll')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('.hss-body'));
    keyOn(document.activeElement!, 'ArrowRight');
    expect(p.onSelect).toHaveBeenCalledWith(1);
  });

  it('focus outside the body (the lobby chat input) is never taken by the re-roll re-focus', () => {
    const p = props({ canReroll: true });
    show(p);
    const input = document.body.appendChild(document.createElement('input'));
    try {
      act(() => { input.focus(); });
      expect(document.activeElement).toBe(input);
      ui!.render(host({ ...p, canReroll: false }));
      expect(document.activeElement).toBe(input);
    } finally {
      input.remove();
    }
  });

  it('focus legitimately elsewhere inside the body is left alone', () => {
    const p = props({ canReroll: true });
    const el = show(p);
    const tile = el.querySelectorAll<HTMLElement>('.hss-tile')[1]!;
    act(() => { tile.focus(); });
    ui!.render(host({ ...p, canReroll: false }));
    expect(document.activeElement).toBe(tile);
  });

  it('the sliding glow: the first placement snaps, a new selection glides to the new slot', () => {
    const p = props({ selected: 0 });
    const el = show(p);
    const glow = el.querySelector<HTMLElement>('.hss-glow')!;
    expect(glow.classList.contains('placed')).toBe(true);
    expect(glow.classList.contains('glide')).toBe(false);
    // jsdom has no layout: give each slot a layout box before the selection moves.
    el.querySelectorAll<HTMLElement>('.hss-slot').forEach((slot, i) => {
      Object.defineProperty(slot, 'offsetLeft', { configurable: true, value: 100 + i * 250 });
      Object.defineProperty(slot, 'offsetWidth', { configurable: true, value: 240 });
    });
    ui!.render(host({ ...p, selected: 2 }));
    expect(glow.classList.contains('glide')).toBe(true);
    expect(glow.style.transform).toBe('translateX(600px)');
    expect(glow.style.width).toBe('240px');
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

/**
 * THE WIRING (HeroSelect renders the showcase body when both switches are on and the offer is not the browse grid). Every
 * pick rule stays in HeroSelect: tiles and arrows only select, Select Hero runs today's pick path from the card's splash
 * art, and with the showcase switch off the screen is today's.
 */
describe('Hero Select with the showcase body', () => {
  const versusBefore = useVersus.getState().match;
  beforeEach(() => {
    // jsdom has no ResizeObserver; the browse grid measures its rows with one.
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    noArt.on = false;
    setOwnHeroPick(null);
    act(() => {
      useVersus.setState({ match: versusBefore });
      useSpectate.setState({ matePick: null });
      useGame.setState({ heroChoices: null, heroReroll: null, rankedEntry: null });
    });
  });

  /** The lazy body (and the party home skin) resolve before anything is asserted. */
  const settle = async (): Promise<void> => {
    await act(async () => {
      await import('./HeroShowcase');
      await import('./HeroSelectPhSkin');
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  const open = async (o: { showcase?: boolean; mode?: 'ascent' | 'practice' | 'versus'; choices?: string[] } = {}): Promise<HTMLElement> => {
    act(() => {
      setPartyHome(true);
      setHeroShowcase(o.showcase ?? true);
      useGame.setState({ pendingMode: o.mode ?? 'ascent', heroChoices: o.choices ?? [...OFFER], heroReroll: null, rankedEntry: null, pendingSeed: 4242 });
    });
    ui = mount(<HeroSelect />);
    await settle();
    return ui.container;
  };
  const root = (): Element => document.querySelector('.heroselect')!;
  const cardName = (): string => document.querySelector('.hss-card .phi-name')?.textContent ?? '';
  const tiles = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.hss-tile')];
  const confirm = (): HTMLElement => document.querySelector<HTMLElement>('.hss-confirm')!;

  it("switch off: today's three .herocard.big, no .hss-body", async () => {
    const el = await open({ showcase: false });
    expect(el.querySelectorAll('.herocard.big')).toHaveLength(3);
    expect(el.querySelector('.hss-body')).toBeNull();
    expect(root().classList.contains('hss')).toBe(false);
  });

  it('switch on: .hss-body, no .herocard, first tile selected, card shows the first hero', async () => {
    const el = await open();
    expect(el.querySelector('.hss-body')).not.toBeNull();
    expect(el.querySelector('.herocard')).toBeNull();
    expect(root().classList.contains('hss')).toBe(true);
    expect([...el.querySelectorAll('.hss-slot')].map((s) => s.classList.contains('on'))).toEqual([true, false, false]);
    expect(cardName()).toBe(getHero('aster').name);
    expect(el.querySelector('.hss-glow')!.classList.contains('placed')).toBe(true);
  });

  it('clicking the second tile shows it on the card and does not start the ceremony', async () => {
    await open();
    click(tiles()[1]);
    expect(cardName()).toBe(getHero('warden').name);
    expect(document.querySelectorAll('.hss-slot')[1]!.classList.contains('on')).toBe(true);
    expect(root().classList.contains('hsc-active')).toBe(false);
    expect(document.querySelector('.hsc-layer')).toBeNull();
  });

  it('Select Hero starts the ceremony for the selected hero', async () => {
    await open();
    click(tiles()[2]);
    click(confirm());
    expect(root().classList.contains('hsc-active')).toBe(true);
    expect(document.querySelector('.hsc-layer')).not.toBeNull();
    expect(useOwnHeroPick.getState().heroId).toBe('soren');
  });

  it('the selection controls are dead while the ceremony runs (arrows and tiles)', async () => {
    await open();
    const pulse = vi.spyOn(sfx, 'pulse');
    click(confirm());
    expect(root().classList.contains('hsc-active')).toBe(true);
    expect(pulse).toHaveBeenCalledTimes(1);
    const onIdx = (): number => [...document.querySelectorAll('.hss-slot')].findIndex((s) => s.classList.contains('on'));
    expect(onIdx()).toBe(0);
    keyOn(document.querySelector('.hss-body')!, 'ArrowRight');
    click(tiles()[1]);
    expect(pulse).toHaveBeenCalledTimes(1);
    expect(onIdx()).toBe(0);
    expect(cardName()).toBe(getHero('aster').name);
  });

  it('turning the switch on after the offer exists starts on the first hero; a new offer then resets the selection', async () => {
    await open({ showcase: false });
    act(() => { setHeroShowcase(true); });
    await settle();
    const onIdx = (): number => [...document.querySelectorAll('.hss-slot')].findIndex((s) => s.classList.contains('on'));
    expect(onIdx()).toBe(0);
    click(tiles()[2]);
    expect(onIdx()).toBe(2);
    const next = getHeroIds().filter((id) => !(OFFER as readonly string[]).includes(id)).slice(0, 3);
    act(() => { useGame.setState({ heroChoices: next }); });
    expect(onIdx()).toBe(0);
    expect(cardName()).toBe(getHero(next[0]!).name);
  });

  it('after a pick clears the offer, the next offer (even the same three heroes) starts on the first hero', async () => {
    await open();
    const onIdx = (): number => [...document.querySelectorAll('.hss-slot')].findIndex((s) => s.classList.contains('on'));
    click(tiles()[2]);
    expect(onIdx()).toBe(2);
    act(() => { useGame.setState({ heroChoices: null }); }); // the pick: HeroSelect renders null but stays mounted
    act(() => { useGame.setState({ heroChoices: [...OFFER] }); }); // the next run's offer, identical on the same seed
    await settle();
    expect(onIdx()).toBe(0);
    expect(cardName()).toBe(getHero('aster').name);
    expect(root().classList.contains('hss-snap')).toBe(false);
  });

  it('Versus: the clock ran out and the server chose → the forced jump selects that hero and plays its ceremony once', async () => {
    setIdentity({ userId: 'me', displayName: 'Me', anonymous: true, email: null });
    try {
      await open({ mode: 'versus' });
      shownCalls.n = 0;
      const id = 'vs-timeout-1';
      // The server's pick for my seat (p1), revealed after the 20 s ran out with no pick of mine (`pickedFor` unset).
      act(() => {
        useVersus.setState({
          pickedFor: null,
          match: { id, phase: 'hero_select', p1_user: 'me', p2_user: 'them', p1_hero: 'soren', p2_hero: 'warden', heroes_revealed: true, hero_deadline: null } as never,
        });
      });
      await act(async () => { await new Promise((r) => setTimeout(r, 80)); }); // the forced jump commits a frame later
      expect(root().classList.contains('hsc-active')).toBe(true);
      expect(useOwnHeroPick.getState().heroId).toBe('soren');
      expect(document.querySelectorAll('.hss-slot')[2]!.classList.contains('on')).toBe(true);
      expect(cardName()).toBe(getHero('soren').name);
      expect(root().classList.contains('hss-snap')).toBe(true);
      expect(document.querySelector('.hsc-clone.hsc-splash')).not.toBeNull();
      // Marked shown through the real store (so the hook goes quiet), exactly once.
      expect(useVersus.getState().pickedFor).toBe(id);
      expect(shownCalls.n).toBe(1);
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(shownCalls.n).toBe(1);
      expect(document.querySelectorAll('.hsc-layer')).toHaveLength(1);
    } finally {
      resetIdentityForTests();
      act(() => { useVersus.setState({ pickedFor: null }); });
    }
  });

  it('Select Hero twice starts one ceremony', async () => {
    await open();
    const pulse = vi.spyOn(sfx, 'pulse');
    click(confirm());
    click(confirm());
    expect(document.querySelectorAll('.hsc-layer')).toHaveLength(1);
    expect(document.querySelectorAll('.hsc-clone')).toHaveLength(1);
    expect(pulse).toHaveBeenCalledTimes(1); // the second press is blocked ('busy') and silent
    expect(useOwnHeroPick.getState().heroId).toBe('aster');
  });

  it('one re-roll: the controls go, the selected slot stays selected, the card shows the new hero', async () => {
    await open();
    click(tiles()[1]);
    const rerolls = [...document.querySelectorAll<HTMLElement>('.hss-reroll')];
    expect(rerolls).toHaveLength(3);
    click(rerolls[1]);
    const now = useGame.getState().heroChoices!;
    expect(now[1]).not.toBe('warden');
    expect(now[0]).toBe('aster');
    expect(document.querySelectorAll('.hss-reroll')).toHaveLength(0);
    expect([...document.querySelectorAll('.hss-slot')].map((s) => s.classList.contains('on'))).toEqual([false, true, false]);
    expect(cardName()).toBe(getHero(now[1]!).name);
    expect(root().classList.contains('hsc-active')).toBe(false);
  });

  it('Select Hero during the swap picks the re-rolled hero', async () => {
    await open();
    click(document.querySelectorAll<HTMLElement>('.hss-reroll')[0]);
    expect(document.querySelector('.hss-slot.swapping')).not.toBeNull(); // still mid-swap
    click(confirm());
    const fresh = useGame.getState().heroChoices![0]!;
    expect(fresh).not.toBe('aster');
    expect(useOwnHeroPick.getState().heroId).toBe(fresh);
  });

  it("Practice (whole roster) still renders today's browse grid with the switch on", async () => {
    const all = practiceHeroChoiceIds('all');
    expect(all.length).toBeGreaterThan(6);
    const el = await open({ mode: 'practice', choices: all });
    expect(el.querySelector('.hsrow.browse')).not.toBeNull();
    expect(el.querySelector('.hss-body')).toBeNull();
    expect(root().classList.contains('hss')).toBe(false);
  });

  it('watch mode: no Select Hero; a watched pick selects that hero and plays the ceremony', async () => {
    act(() => { setPartyHome(true); setHeroShowcase(true); useGame.setState({ heroChoices: null }); });
    const frame = (picked: string | null): HeroSelectFrame => ({ offer: [...OFFER], picked, reroll: null, canReroll: false, mode: 'lobby' });
    ui = mount(<HeroSelect watch={{ frame: frame(null), fx: false, clock: 'none' }} />);
    await settle();
    expect(document.querySelector('.hss-body')).not.toBeNull();
    expect(document.querySelector('.hss-confirm')).toBeNull();
    expect(root().classList.contains('hsc-active')).toBe(false);
    ui.render(<HeroSelect watch={{ frame: frame('warden'), fx: false, clock: 'none' }} />);
    expect(document.querySelectorAll('.hss-slot')[1]!.classList.contains('on')).toBe(true); // the card shows it first
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); // the forced jump commits a frame later
    expect(root().classList.contains('hsc-active')).toBe(true);
    expect(document.querySelectorAll('.hss-slot')[1]!.classList.contains('on')).toBe(true);
    expect(cardName()).toBe(getHero('warden').name);
    // The forced jump skips the card's entrance, so the splash art is measured at its settled size.
    expect(root().classList.contains('hss-snap')).toBe(true);
    expect(document.querySelector('.hsc-clone.hsc-splash')).not.toBeNull();
  });

  it('a forced jump (hss-snap) does not leak into the next offer', async () => {
    act(() => { setPartyHome(true); setHeroShowcase(true); useGame.setState({ heroChoices: null }); });
    const frame = (offer: string[], picked: string | null): HeroSelectFrame => ({ offer, picked, reroll: null, canReroll: false, mode: 'lobby' });
    ui = mount(<HeroSelect watch={{ frame: frame([...OFFER], null), fx: false, clock: 'none' }} />);
    await settle();
    ui.render(<HeroSelect watch={{ frame: frame([...OFFER], 'warden'), fx: false, clock: 'none' }} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(root().classList.contains('hss-snap')).toBe(true);
    // A whole new offer arrives.
    const next = getHeroIds().filter((id) => !(OFFER as readonly string[]).includes(id)).slice(0, 3);
    expect(next).toHaveLength(3);
    ui.render(<HeroSelect watch={{ frame: frame(next, null), fx: false, clock: 'none' }} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(root().classList.contains('hss')).toBe(true);
    expect(root().classList.contains('hss-snap')).toBe(false);
  });

  it("Ranked Duos: teammate's hero selected → Select Hero blocked, no ceremony", async () => {
    act(() => {
      useVersus.setState({ match: { id: 'rd-1', phase: 'hero_select', group: { raw: { options: { mode: 'ranked_duos' } } } } as never });
      useSpectate.setState({ matePick: 'warden' });
    });
    await open({ mode: 'versus' });
    expect(document.querySelectorAll('.hss-slot')[1]!.classList.contains('taken')).toBe(true);
    const deny = vi.spyOn(sfx, 'deny');
    click(tiles()[1]);
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
    expect(confirm().textContent).toBe('Taken by your teammate');
    click(confirm());
    expect(deny).toHaveBeenCalledTimes(1);
    expect(root().classList.contains('hsc-active')).toBe(false);
    expect(document.querySelector('.hsc-layer')).toBeNull();
  });

  it('the ceremony clones the splash art, not a hero card', async () => {
    await open();
    const src = document.querySelector('.hss-card .phi-art img')!.getAttribute('src');
    expect(src).toBeTruthy();
    click(confirm());
    const clone = document.querySelector('.hsc-clone.hsc-splash');
    expect(clone).not.toBeNull();
    expect(document.querySelector('.hsc-clone-card')).toBeNull();
    expect(clone!.querySelector('img')!.getAttribute('src')).toBe(src);
  });

  it('a reset mid-ceremony restores the body', async () => {
    await open();
    click(confirm());
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); // the art box hides a frame after commit
    const art = document.querySelector<HTMLElement>('.hss-card .phi-art')!;
    expect(art.style.visibility).toBe('hidden'); // under the clone
    act(() => { useGame.setState({ heroChoices: ['indy', 'warden', 'soren'] }); });
    expect(document.querySelector('.hsc-layer')).toBeNull();
    expect(root().classList.contains('hsc-active')).toBe(false);
    expect(document.querySelector<HTMLElement>('.hss-card .phi-art')!.style.visibility).toBe('');
    expect(tiles()).toHaveLength(3);
  });

  it('a hero with no art still starts the ceremony', async () => {
    noArt.on = true;
    await open();
    click(confirm());
    expect(root().classList.contains('hsc-active')).toBe(true);
    const clone = document.querySelector('.hsc-clone.hsc-splash');
    expect(clone).not.toBeNull();
    expect(clone!.querySelector('img')).toBeNull();
  });

  it('switch off: the ceremony still clones .herocard.big', async () => {
    await open({ showcase: false });
    click(document.querySelector('.herocard.big'));
    expect(root().classList.contains('hsc-active')).toBe(true);
    expect(document.querySelector('.hsc-splash')).toBeNull();
    const card = document.querySelector('.hsc-clone > .hsc-clone-card');
    expect(card).not.toBeNull();
    expect(card!.classList.contains('herocard')).toBe(true);
    expect(card!.classList.contains('big')).toBe(true);
  });

  it('while the ceremony runs the card stage, Select Hero and the glow leave', () => {
    const src = './HeroShowcase.tsx';
    const file = './heroShowcase.css'; // a variable, so Vite does not rewrite the URL into a served asset
    const css = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    expect(css).toContain('.heroselect.hss.hsc-active :is(.hss-stage, .hss-confirm) { opacity: 0; pointer-events: none; transition: opacity 0.2s ease var(--hsc-header-delay, 0ms); }');
    // The glow fades with the stage (not instantly), and the tiles take no pointer while the ceremony runs.
    expect(css).toContain('.heroselect.hss.hsc-active .hss-glow { opacity: 0; transition: opacity 0.2s ease var(--hsc-header-delay, 0ms); }');
    expect(css).toContain('.heroselect.hss.hsc-active .hss-tiles { pointer-events: none; }');
    // The glow is shown by a class, never an inline opacity (which the rule above could not beat), and the class rule comes first.
    expect(css.indexOf('.heroselect.hss .hss-glow.placed { opacity: 1; }')).toBeGreaterThan(-1);
    expect(css.indexOf('.heroselect.hss .hss-glow.placed')).toBeLessThan(css.indexOf('.heroselect.hss.hsc-active .hss-glow'));
    expect(readFileSync(fileURLToPath(new URL(src, import.meta.url)), 'utf8')).not.toMatch(/glow.style.opacity/);
  });
});

describe('HeroShowcase: the spent re-roll', () => {
  let ui: Mounted | null = null;
  afterEach(() => { ui?.unmount(); ui = null; });
  const swap = { slot: 1, from: 'warden' };

  it('while the swap plays and the re-roll is used up, every slot shows the fading ghost, not a button', () => {
    ui = mount(<HeroShowcase {...props({ canReroll: false, swapping: swap })} />);
    expect(ui.container.querySelectorAll('.hss-reroll')).toHaveLength(0);
    const ghosts = [...ui.container.querySelectorAll('.hss-slot > .hss-reroll-gone')];
    expect(ghosts).toHaveLength(3);
    expect(ghosts.every((g) => g.tagName === 'SPAN' && g.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('no ghost at rest, while the re-roll is still available, or once the ceremony runs', () => {
    ui = mount(<HeroShowcase {...props()} />);
    expect(ui.container.querySelector('.hss-reroll-gone')).toBeNull();
    ui.unmount();
    ui = mount(<HeroShowcase {...props({ canReroll: true, swapping: swap })} />);
    expect(ui.container.querySelector('.hss-reroll-gone')).toBeNull();
    ui.unmount();
    ui = mount(<HeroShowcase {...props({ canReroll: false, swapping: swap, blocked: 'busy' })} />);
    expect(ui.container.querySelector('.hss-reroll-gone')).toBeNull();
  });
});
