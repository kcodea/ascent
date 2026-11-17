// @vitest-environment jsdom
/**
 * HERO SELECT SHOWCASE: the ceremony can start from the inspect card's SPLASH ART (the optional `splash` prop) instead
 * of a hero card. Mounted directly here; HeroSelect wires the prop in its own task. With the prop absent the ceremony
 * is today's, cloning `.herocard.big`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useReducer, type MutableRefObject, type RefObject } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import { HeroSelectCeremony } from './HeroSelectCeremony';
import { ceremonyReduce, CEREMONY_IDLE, type HeroCeremonyState } from './heroCeremonyMachine';
import { ceremonyAdvanceSchedule, ceremonyTiming } from './heroCeremonyTiming';
import { heroPortrait } from '../skins/skins';
import { coverSquare, destinationRect, focusKeyframes, splashDest, splashTravelTarget, transformTo } from './heroCeremonyGeometry';
import { stageViewport } from '../stage';

// One switch for the "hero with no art" case: the ceremony reads its art through heroPortrait.
const noArt = { on: false };
vi.mock('../skins/skins', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../skins/skins')>();
  return { ...actual, heroPortrait: (...a: Parameters<typeof actual.heroPortrait>) => (noArt.on ? undefined : actual.heroPortrait(...a)) };
});

const HERO = 'aster';
const SPLASH_RECT = { left: 200, top: 150, width: 420, height: 420 };
const CARD_RECT = { left: 300, top: 220, width: 300, height: 393 };

const committed = (rect: typeof SPLASH_RECT): HeroCeremonyState =>
  ceremonyReduce(CEREMONY_IDLE, { type: 'select', heroId: HERO, rect, index: 0, now: 0 });

interface Splash { artEl: RefObject<HTMLElement>; exitEls: MutableRefObject<(HTMLElement | null)[]> }

function Harness({ rect, cardEls, splash }: {
  rect: typeof SPLASH_RECT;
  cardEls: MutableRefObject<(HTMLButtonElement | null)[]>;
  splash?: Splash;
}) {
  const [state, dispatch] = useReducer(ceremonyReduce, rect, committed);
  return <HeroSelectCeremony state={state} dispatch={dispatch} cardEls={cardEls} splash={splash} />;
}

/** Real DOM nodes standing in for the inspect card's art box, the tile slots and the classic cards. */
function fixtures() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const make = <T extends HTMLElement>(tag: string): T => host.appendChild(document.createElement(tag)) as T;
  const art = make<HTMLDivElement>('div');
  const tiles = [make<HTMLDivElement>('div'), make<HTMLDivElement>('div'), make<HTMLDivElement>('div')];
  const cards = [make<HTMLButtonElement>('button'), make<HTMLButtonElement>('button'), make<HTMLButtonElement>('button')];
  const splash: Splash = { artEl: { current: art }, exitEls: { current: tiles } };
  const cardEls = { current: cards } as MutableRefObject<(HTMLButtonElement | null)[]>;
  return { host, art, tiles, cards, splash, cardEls };
}

let ui: Mounted | null = null;
let fx: ReturnType<typeof fixtures>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  fx = fixtures();
});
afterEach(() => {
  ui?.unmount(); ui = null;
  fx.host.remove();
  noArt.on = false;
  vi.useRealTimers();
});

describe('HeroSelectCeremony from the splash art', () => {
  it('clones the splash art, not a hero card', () => {
    ui = mount(<Harness rect={SPLASH_RECT} cardEls={fx.cardEls} splash={fx.splash} />);
    const clone = ui.container.querySelector<HTMLElement>('.hsc-clone.hsc-splash');
    expect(clone).not.toBeNull();
    expect(ui.container.querySelector('.hsc-clone-card, .herocard')).toBeNull();
    expect(clone!.style.left).toBe('200px');
    expect(clone!.style.width).toBe('420px');
    const img = clone!.querySelector('img')!;
    const expected = heroPortrait(HERO, null)!;
    expect(expected).toBeTruthy();
    expect(img.getAttribute('src')).toBe(expected);
    expect(img.getAttribute('decoding')).toBe('sync');
  });

  it('hides the art box a frame after commit, restores it on unmount, and sends the exitEls out (not the cards)', () => {
    ui = mount(<Harness rect={SPLASH_RECT} cardEls={fx.cardEls} splash={fx.splash} />);
    act(() => { vi.advanceTimersByTime(20); });
    expect(fx.art.style.visibility).toBe('hidden');
    for (const c of fx.cards) expect(c.style.visibility).toBe('');

    const { dismissAt } = ceremonyAdvanceSchedule(ceremonyTiming());
    act(() => { vi.advanceTimersByTime(dismissAt); });
    // jsdom has no WAAPI, so animateEl snaps each exit to its last keyframe.
    for (const tile of fx.tiles) {
      expect(tile.style.opacity).toBe('0');
      expect(tile.style.transform).toMatch(/^translate\(/);
    }
    for (const c of fx.cards) { expect(c.style.opacity).toBe(''); expect(c.style.transform).toBe(''); }

    ui.unmount(); ui = null;
    expect(fx.art.style.visibility).toBe('');
  });

  it('cancels the exit animations on unmount (a reset mid-ceremony)', () => {
    const made: { el: Element; cancel: ReturnType<typeof vi.fn> }[] = [];
    const proto = HTMLElement.prototype as { animate?: unknown };
    const had = Object.prototype.hasOwnProperty.call(proto, 'animate');
    const prev = proto.animate;
    proto.animate = function (this: Element) {
      const cancel = vi.fn();
      made.push({ el: this, cancel });
      return { cancel, finished: new Promise(() => {}) };
    };
    try {
      ui = mount(<Harness rect={SPLASH_RECT} cardEls={fx.cardEls} splash={fx.splash} />);
      act(() => { vi.advanceTimersByTime(ceremonyAdvanceSchedule(ceremonyTiming()).dismissAt); });
      const exits = made.filter((m) => fx.tiles.includes(m.el as HTMLDivElement));
      expect(exits).toHaveLength(fx.tiles.length);
      for (const e of exits) expect(e.cancel).not.toHaveBeenCalled();
      ui.unmount(); ui = null;
      for (const e of exits) expect(e.cancel).toHaveBeenCalled();
    } finally {
      if (had) proto.animate = prev; else delete proto.animate;
    }
  });

  it("hands the materializing beat the card path's frame rect (splashDest), not the square clone's box", () => {
    ui = mount(<Harness rect={SPLASH_RECT} cardEls={fx.cardEls} splash={fx.splash} />);
    act(() => { vi.advanceTimersByTime(ceremonyAdvanceSchedule(ceremonyTiming()).materializeAt + 1); });
    // jsdom lays nothing out, so a MEASURED crop would be 0 wide and no portrait would mount.
    const p = ui.container.querySelector<HTMLElement>('.hsc-portrait');
    expect(p).not.toBeNull();
    const vp = stageViewport();
    const crop = splashDest(destinationRect(vp.w, vp.h, SPLASH_RECT));
    const px = (v: string): number => Number.parseFloat(v);
    // The portrait grows around the crop's centre (tuner nudges default to 0).
    expect(px(p!.style.left) + px(p!.style.width) / 2).toBeCloseTo(crop.left + crop.width / 2, 1);
    expect(px(p!.style.top) + px(p!.style.height) / 2).toBeCloseTo(crop.top + crop.height / 2, 1);
  });

  it('a NON-SQUARE art box (taller than wide) travels and resize-snaps to splashTravelTarget, not the bare cover square', () => {
    // The inspect card can grow taller than its art column is wide; its cover-fit art is then a 532 square.
    const TALL = { left: 200, top: 150, width: 500, height: 532 };
    ui = mount(<Harness rect={TALL} cardEls={fx.cardEls} splash={fx.splash} />);
    const clone = ui.container.querySelector<HTMLElement>('.hsc-clone.hsc-splash');
    expect(clone).not.toBeNull();
    expect(clone!.style.height).toBe('532px');
    const vp = stageViewport();
    const dest = destinationRect(vp.w, vp.h, TALL);
    const target = splashTravelTarget(TALL, dest);
    // jsdom has no WAAPI: the travel snaps to its last keyframe, which is observable on the clone.
    act(() => { vi.advanceTimersByTime(ceremonyAdvanceSchedule(ceremonyTiming()).focusAt + 1); });
    expect(clone!.style.transform).toBe(focusKeyframes(TALL, target)[2]!.transform);
    expect(clone!.style.transform).not.toBe(focusKeyframes(TALL, coverSquare(splashDest(dest)))[2]!.transform);
    // The debounced resize snap (post-voicing) uses the same target.
    act(() => { vi.advanceTimersByTime(ceremonyAdvanceSchedule(ceremonyTiming()).materializeAt + 1); });
    act(() => { window.dispatchEvent(new Event('resize')); vi.advanceTimersByTime(200); });
    expect(clone!.style.transform).toBe(transformTo(TALL, splashTravelTarget(TALL, destinationRect(vp.w, vp.h, TALL))));
  });

  it('a hero with no art still starts the ceremony', () => {
    noArt.on = true;
    expect(() => { ui = mount(<Harness rect={SPLASH_RECT} cardEls={fx.cardEls} splash={fx.splash} />); }).not.toThrow();
    const clone = ui!.container.querySelector('.hsc-clone.hsc-splash');
    expect(clone).not.toBeNull();
    expect(clone!.querySelector('img')).toBeNull();
  });

  it('without splash: the ceremony still clones .herocard.big from the cards', () => {
    ui = mount(<Harness rect={CARD_RECT} cardEls={fx.cardEls} />);
    expect(ui.container.querySelector('.hsc-splash')).toBeNull();
    const card = ui.container.querySelector('.hsc-clone > .hsc-clone-card');
    expect(card).not.toBeNull();
    expect(card!.classList.contains('herocard')).toBe(true);
    expect(card!.classList.contains('big')).toBe(true);
    act(() => { vi.advanceTimersByTime(20); });
    expect(fx.cards[0].style.visibility).toBe('hidden');
    expect(fx.art.style.visibility).toBe('');
  });
});
