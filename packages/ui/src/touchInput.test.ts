// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aimReleaseResolves, createLongPress, inspectActionFor, installTouchInput, isTap, LONG_PRESS_MS, longPressActive,
  TAP_SLOP, touchWording,
} from './touchInput';

describe('touch tap slop', () => {
  it('a finger wobble inside the slop is a tap, past it a drag', () => {
    expect(isTap(100, 100, 100, 100)).toBe(true);
    expect(isTap(100, 100, 106, 106)).toBe(true);          // ~8.5px: a normal fingertip wobble
    expect(isTap(100, 100, 100 + TAP_SLOP + 1, 100)).toBe(false);
    expect(isTap(0, 0, 3, 4, 5)).toBe(true);
    expect(isTap(0, 0, 3, 4, 4.9)).toBe(false);
  });
});

// R-TOUCH-AIMTAP-01 (owner 2026-10-18 audit): tap the power, then tap the minion. A finger tap sends no pointermove.
describe('hero power / Equipment aim release', () => {
  it('the release of the press that ARMED the aim keeps it armed (no move, no new press)', () => {
    expect(aimReleaseResolves(false, false)).toBe(false);
  });
  it('a clean second TAP (a new press, no movement) resolves the aim: fires on a minion, cancels off one', () => {
    expect(aimReleaseResolves(false, true)).toBe(true);
  });
  it('a press-drag-release still resolves (the mouse and the drag gesture are unchanged)', () => {
    expect(aimReleaseResolves(true, false)).toBe(true);
    expect(aimReleaseResolves(true, true)).toBe(true);
  });
  it('Recruit.tsx gates the aim release on the shared rule and counts presses made after arming', () => {
    const src = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
    expect(src).toContain('if (!aimReleaseResolves(moved, pressedSinceArm)) return;');
    expect(src).not.toContain('if (!moved) return; // a plain click');
    expect(src).toMatch(/window\.addEventListener\('pointerdown', press, true\)/);
    expect(src).toMatch(/window\.removeEventListener\('pointerdown', press, true\)/);
  });
});

// R-TOUCH-LONGPRESS-01: one shared long-press.
describe('long-press state machine', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const make = (took = true) => {
    const fire = vi.fn(() => took);
    const lp = createLongPress({ fire, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) });
    return { lp, fire };
  };
  const el = {} as Element;

  it('a finger held still for LONG_PRESS_MS fires once; its release is not a tap', () => {
    const { lp, fire } = make();
    lp.down(el, 100, 100);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith(el, 100, 100);
    expect(lp.active()).toBe(true);
    expect(lp.up()).toBe(true);
    expect(lp.active()).toBe(false);
  });
  it('a short tap never fires and keeps its own action', () => {
    const { lp, fire } = make();
    lp.down(el, 10, 10);
    vi.advanceTimersByTime(120);
    expect(lp.up()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });
  it('a wobble inside the slop keeps the hold; movement past the slop cancels it (it is a drag)', () => {
    const { lp, fire } = make();
    lp.down(el, 0, 0);
    lp.move(6, 6); // ~8.5 px
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    lp.up();
    const b = make();
    b.lp.down(el, 0, 0);
    b.lp.move(TAP_SLOP + 1, 0);
    b.lp.move(0, 0); // coming back does not re-arm it
    vi.advanceTimersByTime(LONG_PRESS_MS * 3);
    expect(b.fire).not.toHaveBeenCalled();
    expect(b.lp.up()).toBe(false);
  });
  it('a browser cancel stops it, and a hold nothing took does not count as fired', () => {
    const { lp, fire } = make();
    lp.down(el, 0, 0);
    lp.cancel();
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(fire).not.toHaveBeenCalled();
    const n = make(false);
    n.lp.down(el, 0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(n.fire).toHaveBeenCalledTimes(1);
    expect(n.lp.up()).toBe(false);
  });
});

/** jsdom has no PointerEvent: a MouseEvent with the pointer fields bolted on reaches the same window listeners. */
function pointer(type: string, target: EventTarget, x: number, y: number, pointerType = 'touch'): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'isPrimary', { value: true });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  target.dispatchEvent(e);
}

describe('installTouchInput: the long-press is the touch right-click', () => {
  let uninstall: () => void = () => {};
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; uninstall = installTouchInput(); });
  afterEach(() => { uninstall(); vi.useRealTimers(); });

  it('fires ONE contextmenu at the held element (every existing right-click path answers it), then eats the click', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);
    const menus: MouseEvent[] = [];
    card.addEventListener('contextmenu', (e) => { e.preventDefault(); menus.push(e); });
    const clicks = vi.fn();
    card.addEventListener('click', clicks);
    pointer('pointerdown', card, 50, 50);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(menus).toHaveLength(1);
    expect(longPressActive()).toBe(true);
    pointer('pointerup', card, 50, 50);
    expect(longPressActive()).toBe(false);
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).not.toHaveBeenCalled(); // the release's click: eaten
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toHaveBeenCalledTimes(1); // the NEXT one is a real tap
  });

  it("swallows the browser's own long-press contextmenu from a finger (Android), never a mouse right-click", () => {
    const card = document.createElement('div');
    document.body.appendChild(card);
    const seen = vi.fn();
    card.addEventListener('contextmenu', seen);
    pointer('pointerdown', card, 5, 5);
    const native = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    card.dispatchEvent(native);
    expect(native.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    pointer('pointerup', card, 5, 5);
    pointer('pointerdown', card, 5, 5, 'mouse');
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a short tap fires nothing, and movement past the slop cancels the hold', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);
    const seen = vi.fn((e: Event) => e.preventDefault());
    card.addEventListener('contextmenu', seen);
    pointer('pointerdown', card, 0, 0);
    vi.advanceTimersByTime(100);
    pointer('pointerup', card, 0, 0);
    vi.advanceTimersByTime(1000);
    pointer('pointerdown', card, 0, 0);
    pointer('pointermove', card, TAP_SLOP + 5, 0);
    vi.advanceTimersByTime(1000);
    expect(seen).not.toHaveBeenCalled();
  });

  it('with no right-click of its own (a hero card, a rune offer) it opens the HOVER face instead', () => {
    const hero = document.createElement('button');
    hero.className = 'herocard';
    document.body.appendChild(hero);
    const enter = vi.fn();
    hero.addEventListener('mouseover', enter);
    pointer('pointerdown', hero, 1, 1);
    vi.advanceTimersByTime(LONG_PRESS_MS);
    expect(hero.classList.contains('tt-on')).toBe(true);
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it('never fires while aiming or dragging (there the finger is the aim / the drag)', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);
    const seen = vi.fn();
    card.addEventListener('contextmenu', seen);
    document.body.classList.add('aiming');
    pointer('pointerdown', card, 0, 0);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    document.body.classList.remove('aiming');
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('Inspect touch action (R-TOUCH-INSPECTACT-01)', () => {
  it('a shop offer gets Buy, a clickable pick outside the play zones gets Pick, your own board gets nothing', () => {
    document.body.innerHTML = `
      <div data-zone="tavern"><div class="row"><div class="card" data-uid="s1"><span id="art"></span></div></div></div>
      <div data-zone="warband"><div class="row"><div class="card" data-uid="b1" id="board"></div></div></div>
      <div class="discover"><div class="card" role="button" id="pick"></div><div class="card" id="plain"></div></div>`;
    expect(inspectActionFor(document.getElementById('art'))).toEqual({ kind: 'buy', uid: 's1' });
    expect(inspectActionFor(document.getElementById('board'))).toBeNull();
    expect(inspectActionFor(document.getElementById('pick'))).toEqual({ kind: 'pick', el: document.getElementById('pick') });
    expect(inspectActionFor(document.getElementById('plain'))).toBeNull();
    expect(inspectActionFor(null)).toBeNull();
  });
});

describe('touch wording (R-TOUCH-WORDING-01)', () => {
  it('turns mouse words into touch words, keeping case and bold', () => {
    expect(touchWording('**Right-click** any card.')).toBe('**Tap and hold** any card.');
    expect(touchWording('right-clicking a minion lists every buff')).toBe('tapping and holding a minion lists every buff');
    expect(touchWording('**Hover** their seat. You can hover it to scout. Hovering shows it.')).toBe('**Tap** their seat. You can tap it to scout. Tapping shows it.');
    expect(touchWording('a hovered card and an overhaul')).toBe('a hovered card and an overhaul'); // whole words only
  });
});
