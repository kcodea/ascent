// @vitest-environment jsdom
/**
 * R-PHONE-SIDEWAYS-01 (owner 2026-10-29: "Make it so mobile only loads in landscape so it doesn't require a rotate").
 *
 * A phone held upright plays the landscape game turned a quarter turn. The stage is placed by
 * `translateX(pw) rotate(90deg)`, and the screen-geometry APIs are mapped into the game's landscape frame, so every
 * measured position (drag, drop seats, the ping fan, popovers, Pixi FX) agrees with what is drawn under the finger.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  deltaToGame, eventX, eventY, gameToScreen, installSideways, rectScreenToGame, screenToGame, setSideways, sidewaysApplies,
  sidewaysInsets, sidewaysOn, sidewaysTransform,
} from './sideways';
import { canLockLandscape } from './orientationLock';
import { fitStage } from './stage';

/** Apply `translateX(pw) rotate(90deg)` about the origin to a game point: the browser's own drawing of the stage. */
function draw(x: number, y: number, pw: number): { x: number; y: number } {
  // rotate(90deg): (x, y) -> (x cos - y sin, x sin + y cos) = (-y, x); then translate by (pw, 0)
  return { x: -y + pw, y: x };
}

describe('the turned frame (pure)', () => {
  const PW = 1020; // an iPhone 15 Pro upright at the run's page scale: the stage's layout height

  it('screenToGame inverts the transform the stage is drawn with', () => {
    for (const [x, y] of [[0, 0], [2210, 1020], [100, 900], [1234.5, 17.25]] as const) {
      const s = draw(x, y, PW);
      expect(screenToGame(s.x, s.y, PW)).toEqual({ x, y });
      expect(gameToScreen(x, y, PW)).toEqual(s);
    }
  });

  it('the game top-left is the screen top-right, and the game runs down the screen', () => {
    expect(gameToScreen(0, 0, PW)).toEqual({ x: PW, y: 0 });
    expect(gameToScreen(2210, PW, PW)).toEqual({ x: 0, y: 2210 });
  });

  it('a screen rect maps to the game rect whose corners are drawn there', () => {
    // a 120 x 160 game rect at (300, 200)
    const g = { left: 300, top: 200, width: 120, height: 160 };
    const a = draw(g.left, g.top, PW);
    const b = draw(g.left + g.width, g.top + g.height, PW);
    const screen = { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
    expect(rectScreenToGame(screen, PW)).toEqual(g);
  });

  it('a drag delta turns with the stage', () => {
    // moving the finger DOWN the upright screen moves RIGHT across the game; moving it LEFT moves DOWN the game
    expect(deltaToGame(0, 10)).toEqual({ x: 10, y: -0 });
    expect(deltaToGame(-10, 0)).toEqual({ x: 0, y: 10 });
  });

  it('the upright safe area becomes the game sides: the notch on the left, the home indicator on the right', () => {
    expect(sidewaysInsets({ top: 59, right: 0, bottom: 34, left: 0 })).toEqual({ top: 0, right: 34, bottom: 0, left: 59 });
  });

  it('turns only a phone held upright: never landscape, never a tablet, never desktop', () => {
    expect(sidewaysApplies(true, 393, 852)).toBe(true);   // iPhone 15 Pro upright
    expect(sidewaysApplies(true, 412, 915)).toBe(true);   // Pixel upright
    expect(sidewaysApplies(true, 852, 393)).toBe(false);  // landscape: the plain game
    expect(sidewaysApplies(true, 820, 1180)).toBe(false); // iPad upright: letterboxed (R-TOUCH-ROTATE-01)
    expect(sidewaysApplies(false, 600, 900)).toBe(false); // a narrow desktop window
  });

  it('the transform is a turn plus an offset (a scale only on the transform path)', () => {
    expect(sidewaysTransform(1020)).toBe('translateX(1020px) rotate(90deg)');
    expect(sidewaysTransform(393, 0.4)).toBe('translateX(393px) rotate(90deg) scale(0.4)');
  });

  it('the turned phone fits exactly as the same phone held in landscape', () => {
    const upright = { top: 59, right: 0, bottom: 34, left: 0 };
    const turned = fitStage(852, 393, sidewaysInsets(upright), undefined, 1.35, true);
    const landscape = fitStage(852, 393, { top: 0, right: 34, bottom: 0, left: 59 }, undefined, 1.35, true);
    expect(turned).toEqual(landscape);
  });

  it('Android can lock only with both fullscreen and an orientation lock; iOS (neither) cannot', () => {
    expect(canLockLandscape({ lock: () => Promise.resolve() }, () => Promise.resolve())).toBe(true);
    expect(canLockLandscape({}, () => Promise.resolve())).toBe(false);
    expect(canLockLandscape({ lock: () => Promise.resolve() }, undefined)).toBe(false);
    expect(canLockLandscape(undefined, undefined)).toBe(false);
  });
});

describe('the wrapped screen-geometry APIs', () => {
  const PW = 400;
  const SCREEN_RECT = { x: 50, y: 100, width: 80, height: 30 };
  const efpCalls: Array<[number, number]> = [];
  const innerW = 400; const innerH = 900;

  beforeAll(() => {
    // jsdom has no layout: stand in a fixed screen rect, a recording hit test, and accessor window sizes.
    Element.prototype.getBoundingClientRect = function (): DOMRect { return new DOMRect(SCREEN_RECT.x, SCREEN_RECT.y, SCREEN_RECT.width, SCREEN_RECT.height); };
    Element.prototype.getClientRects = function (this: Element): DOMRectList {
      const one = [new DOMRect(SCREEN_RECT.x, SCREEN_RECT.y, SCREEN_RECT.width, SCREEN_RECT.height)];
      return Object.assign(one, { item: (i: number) => one[i] ?? null }) as unknown as DOMRectList;
    };
    Document.prototype.elementFromPoint = function (x: number, y: number): Element | null { efpCalls.push([x, y]); return null; };
    Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => innerW });
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => innerH });
    installSideways();
  });
  afterEach(() => setSideways(false, 0));

  it('pass straight through while the phone is not turned', () => {
    expect(sidewaysOn()).toBe(false);
    const r = document.body.getBoundingClientRect();
    expect([r.left, r.top, r.width, r.height]).toEqual([50, 100, 80, 30]);
    expect([window.innerWidth, window.innerHeight]).toEqual([400, 900]);
    document.elementFromPoint(10, 20);
    expect(efpCalls.at(-1)).toEqual([10, 20]);
  });

  it('report the landscape frame while turned', () => {
    setSideways(true, PW);
    expect(document.documentElement.hasAttribute('data-sideways')).toBe(true);
    const r = document.body.getBoundingClientRect();
    expect([r.left, r.top, r.width, r.height]).toEqual([100, PW - 50 - 80, 30, 80]);
    expect([window.innerWidth, window.innerHeight]).toEqual([900, 400]);
    const list = document.body.getClientRects();
    expect(list.length).toBe(1);
    expect(list.item(0)?.width).toBe(30);
    // a hit test asked at a game point lands on the screen point that is drawn there
    document.elementFromPoint(120, 300);
    expect(efpCalls.at(-1)).toEqual([PW - 300, 120]);
  });

  it('leave an event the game builds itself alone (its coordinates are already in the game frame)', () => {
    setSideways(true, PW);
    const ev = new MouseEvent('contextmenu', { clientX: 120, clientY: 300 });
    expect(ev.isTrusted).toBe(false);
    expect([ev.clientX, ev.clientY]).toEqual([120, 300]);
  });

  it('map a browser (trusted) event from the screen into the game frame', () => {
    // jsdom cannot make a trusted event (isTrusted is unforgeable), so the getters' mapping is checked directly.
    setSideways(true, PW);
    expect([eventX(50, 700), eventY(50, 700)]).toEqual([700, PW - 50]);
    expect(screenToGame(50, 700, PW)).toEqual({ x: eventX(50, 700), y: eventY(50, 700) });
    // and a tap drawn on a game rect's centre is inside that rect in the game frame
    const r = document.body.getBoundingClientRect();
    const cx = SCREEN_RECT.x + SCREEN_RECT.width / 2; const cy = SCREEN_RECT.y + SCREEN_RECT.height / 2;
    const gx = eventX(cx, cy); const gy = eventY(cx, cy);
    expect(gx > r.left && gx < r.right && gy > r.top && gy < r.bottom).toBe(true);
  });
});
