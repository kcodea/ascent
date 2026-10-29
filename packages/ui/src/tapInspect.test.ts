// @vitest-environment jsdom
/**
 * R-TOUCH-TAPINSPECT-01 (owner 2026-10-25: "on mobile -> holding on a minion shouldnt do the inspect, only tapping
 * should") and R-PHONE-CRISP-01 ("the inspect looks grainy/not crisp").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clickAsPick, holdFiresOn, installTouchInput, isHeldRelease, isSelectOption, LONG_PRESS_MS, longPressActive, NO_HOLD, tapInspectAllowed,
} from './touchInput';
import { fullResUrl } from './phoneArt';
import { upgradeImages } from './fullResArt';

function pointer(type: string, target: EventTarget, x: number, y: number, pointerType = 'touch'): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'isPrimary', { value: true });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  target.dispatchEvent(e);
}

describe('R-TOUCH-TAPINSPECT-01: a tap on a card inspects it, a hold never does', () => {
  let uninstall: () => void = () => {};
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers(); now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    document.body.innerHTML = ''; document.body.className = '';
    uninstall = installTouchInput();
  });
  afterEach(() => { uninstall(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const card = (html = '<div class="card" id="c"><span id="art"></span></div>'): HTMLElement => {
    document.body.insertAdjacentHTML('beforeend', html);
    return document.getElementById('c')!;
  };
  const tap = (el: Element, ms = 80): void => { pointer('pointerdown', el, 10, 10); now += ms; vi.advanceTimersByTime(ms); pointer('pointerup', el, 10, 10); };

  it('a held card fires no long-press (no contextmenu, so no Inspect) and holding then moving is a drag', () => {
    const c = card();
    const menus = vi.fn();
    c.addEventListener('contextmenu', menus);
    pointer('pointerdown', c, 10, 10);
    now += LONG_PRESS_MS * 2; vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(menus).not.toHaveBeenCalled();
    expect(longPressActive()).toBe(false); // the drag path is not blocked
    pointer('pointerup', c, 10, 10);
  });
  it('the release of a hold on a card is not a tap: no Inspect, and its click (a Discover pick) is eaten', () => {
    const c = card();
    const clicks = vi.fn();
    c.addEventListener('click', clicks);
    tap(c, LONG_PRESS_MS + 50);
    expect(tapInspectAllowed(c)).toBe(false);
    c.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).not.toHaveBeenCalled();
  });
  it('a short tap on a play-zone or read-only card may inspect: the Shop, your board, a scout or Compendium card', () => {
    const c = card('<div data-zone="tavern"><div class="row"><div class="card" data-uid="u1" id="c"></div></div></div>');
    tap(c);
    expect(tapInspectAllowed(c)).toBe(true);
    document.body.innerHTML = '';
    const d = card('<div class="scout"><div class="card" id="c"></div></div>');
    tap(d);
    expect(tapInspectAllowed(d)).toBe(true);
  });
  it('never while aiming or dragging, never for a card inside another control, never for a mouse', () => {
    const c = card('<button><div class="card" id="c"></div></button>');
    tap(c);
    expect(tapInspectAllowed(c)).toBe(false);
    document.body.innerHTML = '';
    const d = card();
    tap(d);
    document.body.classList.add('aiming');
    expect(tapInspectAllowed(d)).toBe(false);
    document.body.classList.remove('aiming');
    expect(tapInspectAllowed(d)).toBe(true);
    pointer('pointerdown', d, 1, 1, 'mouse'); pointer('pointerup', d, 1, 1, 'mouse');
    expect(tapInspectAllowed(d)).toBe(false);
  });
  it('the Pick button on the Inspect view clicks the option as the commit, past tap-to-inspect', () => {
    const c = card('<div data-zone="tavern"><div class="row"><div class="card" data-uid="u" id="c"></div></div></div>');
    tap(c);
    let seen: boolean | null = null;
    c.addEventListener('click', () => { seen = tapInspectAllowed(c); });
    clickAsPick(c);
    expect(seen).toBe(false);
    expect(tapInspectAllowed(c)).toBe(true); // only that one click
  });
  it('the long-press still answers everything that is not a card (emotes on your portrait, a lobby seat)', () => {
    const f = document.createElement('div');
    document.body.appendChild(f);
    const menus = vi.fn((e: Event) => e.preventDefault());
    f.addEventListener('contextmenu', menus);
    pointer('pointerdown', f, 1, 1);
    now += LONG_PRESS_MS; vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toHaveBeenCalledTimes(1);
  });
  it('isHeldRelease: play-zone cards only (not choice options), from LONG_PRESS_MS', () => {
    document.body.innerHTML = '<div class="card" id="a"></div><button class="runecard" id="b"></button><div id="c"></div><div class="disc-slot"><div class="card" role="button" id="d"></div></div>';
    expect(NO_HOLD).toBe('.card, .runecard');
    expect(isHeldRelease(LONG_PRESS_MS, document.getElementById('a'))).toBe(true);
    expect(isHeldRelease(LONG_PRESS_MS, document.getElementById('b'))).toBe(false); // a rune: its hold inspects
    expect(isHeldRelease(LONG_PRESS_MS, document.getElementById('d'))).toBe(false); // a Discover option: likewise
    expect(isHeldRelease(LONG_PRESS_MS - 1, document.getElementById('a'))).toBe(false);
    expect(isHeldRelease(LONG_PRESS_MS * 3, document.getElementById('c'))).toBe(false);
  });
  it('Card.tsx inspects on a touch tap before its own click; Inspect picks through clickAsPick', () => {
    const cardSrc = readFileSync(join(__dirname, 'Card.tsx'), 'utf8');
    expect(cardSrc).toContain('if (tapInspectAllowed(e.currentTarget)) { inspectCard(inspectViewOf(card, skinArtUrl)); return; }');
    expect(readFileSync(join(__dirname, 'Inspect.tsx'), 'utf8')).toContain('clickAsPick(action.el)');
  });
});

/**
 * R-TOUCH-TAPSELECT-01 (owner 2026-10-26: "in a discover select, you can't select an option because tapping a minion
 * inspects. tapping in a discover/etc should select. the tap to inspect should only work on board/shop etc").
 */
describe('R-TOUCH-TAPSELECT-01: a tap on a choice option picks it; a hold inspects it', () => {
  let uninstall: () => void = () => {};
  let now = 0;
  beforeEach(() => {
    vi.useFakeTimers(); now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    document.body.innerHTML = ''; document.body.className = '';
    uninstall = installTouchInput();
  });
  afterEach(() => { uninstall(); vi.restoreAllMocks(); vi.useRealTimers(); });
  const tap = (el: Element, ms = 80): void => { pointer('pointerdown', el, 10, 10); now += ms; vi.advanceTimersByTime(ms); pointer('pointerup', el, 10, 10); };
  const hold = (el: Element): void => { pointer('pointerdown', el, 10, 10); now += LONG_PRESS_MS + 20; vi.advanceTimersByTime(LONG_PRESS_MS + 20); pointer('pointerup', el, 10, 10); };
  const OVERLAYS: [string, string][] = [
    ['Discover', '<div class="discover-ov"><div class="disc-cards"><div class="disc-slot"><div class="card" role="button" id="o"><span id="art"></span></div></div></div></div>'],
    ['Choose One', '<div class="discover-ov choose-one"><div class="disc-slot"><div class="card" role="button" id="o"><span id="art"></span></div></div></div>'],
    ['hero power offer', '<div class="discover-ov power-offer"><div class="disc-slot"><div class="card" role="button" id="o"><span id="art"></span></div></div></div>'],
    ['Runeforge rune', '<div class="runeforge"><button class="runecard" id="o"><span id="art"></span></button></div>'],
  ];
  for (const [name, html] of OVERLAYS) {
    it(`${name}: a tap is not an Inspect, so the option's own click picks it`, () => {
      document.body.insertAdjacentHTML('beforeend', html);
      const o = document.getElementById('o')!;
      const art = document.getElementById('art')!;
      expect(isSelectOption(art)).toBe(true);
      const clicks = vi.fn();
      o.addEventListener('click', clicks);
      tap(art);
      expect(tapInspectAllowed(o)).toBe(false);
      art.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicks).toHaveBeenCalledTimes(1); // the pick, not eaten
    });
    it(`${name}: a hold fires the long-press right-click (its Inspect) and eats the release's click`, () => {
      document.body.insertAdjacentHTML('beforeend', html);
      const o = document.getElementById('o')!;
      const art = document.getElementById('art')!;
      const menus = vi.fn((e: Event) => e.preventDefault());
      const clicks = vi.fn();
      o.addEventListener('contextmenu', menus);
      o.addEventListener('click', clicks);
      hold(art);
      expect(menus).toHaveBeenCalledTimes(1);
      art.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicks).not.toHaveBeenCalled(); // holding never picks
    });
  }
  it('play-zone cards keep tap-to-inspect and never long-press: the Shop, your board, your hand, combat', () => {
    document.body.innerHTML = [
      '<div data-zone="tavern"><div class="row"><div class="card" data-uid="s" id="s"></div></div></div>',
      '<div data-zone="warband"><div class="row"><div class="card" data-uid="b" id="b"></div></div></div>',
      '<div class="row hand"><div class="card" data-uid="h" id="h"></div></div>',
      '<div class="unit"><div class="card" id="u"></div></div>',
    ].join('');
    for (const id of ['s', 'b', 'h', 'u']) {
      const el = document.getElementById(id)!;
      expect(isSelectOption(el), id).toBe(false);
      expect(holdFiresOn(el), id).toBe(false);
      tap(el);
      expect(tapInspectAllowed(el), id).toBe(true);
    }
  });
  it('hero select and quest offers are unchanged: not cards, so a tap picks and a hold shows the hover face', () => {
    document.body.innerHTML = '<button class="herocard big" id="h"></button><button class="questcard" id="q"></button>';
    for (const id of ['h', 'q']) {
      const el = document.getElementById(id)!;
      expect(holdFiresOn(el)).toBe(true);
      tap(el);
      expect(tapInspectAllowed(el)).toBe(false);
    }
  });
  it('Card.tsx falls through to its own click for a choice; RuneCard buys on a tap and opens RuneInspect on a touch hold', () => {
    const cardSrc = readFileSync(join(__dirname, 'Card.tsx'), 'utf8');
    // Right-click opens the ping menu in a game (which carries Inspect, R-PING-04), else inspects at once.
    expect(cardSrc).toMatch(/onContextMenu=\{\(e\) => \{\s*e\.preventDefault\(\);[\s\S]{0,400}?inspectCard\([\s\S]{0,200}?openCardPingMenu\(e,[\s\S]{0,120}?else inspect\(\);/);
    const rune = readFileSync(join(__dirname, 'RuneCard.tsx'), 'utf8');
    expect(rune).not.toContain('tapInspectAllowed');
    expect(rune).toMatch(/onContextMenu=\{pickSfx \? \(e\) => \{\s*if \(!lastPointerWasTouch\(\)\) return;[\s\S]*?openRuneInspect\(/);
    expect(rune).toMatch(/if \(affordable\) onBuy\(e\.currentTarget\);/);
  });
});

describe('R-PHONE-CRISP-01: the enlarged card loads its full-resolution art on a phone', () => {
  const M = { dir: 'm1', assets: ['art/minions/x.webp'], public: ['frames/oval-dragon.webp'] };
  it('fullResUrl maps a phone copy back to its original and leaves everything else alone', () => {
    expect(fullResUrl('/assets/m1/x-AbC.webp', M, '/')).toBe('/assets/x-AbC.webp');
    expect(fullResUrl('http://h/assets/m1/x-AbC.webp', M, '/')).toBe('http://h/assets/x-AbC.webp');
    expect(fullResUrl('/m1/frames/oval-dragon.webp', M, '/')).toBe('/frames/oval-dragon.webp');
    expect(fullResUrl('./m1/frames/oval-dragon.webp', M, './')).toBe('./frames/oval-dragon.webp');
    expect(fullResUrl('/m1/frames/not-listed.webp', M, '/')).toBe('/m1/frames/not-listed.webp');
    expect(fullResUrl('/frames/oval-dragon.webp', M, '/')).toBe('/frames/oval-dragon.webp');
    expect(fullResUrl('/assets/m1/x.webp', null, '/')).toBe('/assets/m1/x.webp'); // desktop / dev: no copies
    expect(fullResUrl('data:image/webp;base64,AA', M, '/')).toBe('data:image/webp;base64,AA');
  });
  it('upgradeImages is a no-op off a phone', () => {
    document.body.innerHTML = '<div id="r"><img src="/assets/m1/x-AbC.webp"></div>';
    upgradeImages(document.getElementById('r'), false)();
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/assets/m1/x-AbC.webp');
  });
  it('the Inspect view and the hand pop use it; the pop gives the originals back on release', () => {
    expect(readFileSync(join(__dirname, 'Inspect.tsx'), 'utf8')).toContain('upgradeImages(cardRef.current)');
    const ti = readFileSync(join(__dirname, 'touchInput.ts'), 'utf8');
    expect(ti).toContain('restorePop = upgradeImages(card)');
    expect(ti).toMatch(/const unpress = \(\): void => \{ if \(pressed\) \{ dropUpgrade\(\);/);
  });
});
