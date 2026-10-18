// @vitest-environment jsdom
/**
 * R-TOUCH-HITSLOP-01 (owner 2026-10-18: "a AAA experience, seamless 1:1 from mobile to desktop"). Every control gets an
 * invisible touch target of at least 44 screen px; neighbouring targets split by distance (then priority); a direct hit
 * always wins; and none of it ever runs for a mouse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { distToBox, inflate, installTouchSlop, isDirectHit, pickSlopTarget, TOUCH_TARGET_PX, type SlopCandidate } from './touchSlop';

const box = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

describe('the grown hit area', () => {
  it('a 14 px corner button grows to 44 x 44 about its centre', () => {
    const g = inflate(box(100, 100, 14, 14));
    expect(g.right - g.left).toBe(TOUCH_TARGET_PX);
    expect(g.bottom - g.top).toBe(TOUCH_TARGET_PX);
    expect((g.left + g.right) / 2).toBe(107);
  });
  it('a control already 44 px or more is not grown on that axis', () => {
    const g = inflate(box(0, 0, 120, 13)); // a Practice option: wide but 13 px tall
    expect(g.right - g.left).toBe(120);
    expect(g.bottom - g.top).toBe(44);
  });
  it('distance to a rect is zero inside it', () => {
    expect(distToBox(5, 5, box(0, 0, 10, 10))).toBe(0);
    expect(distToBox(13, 14, box(0, 0, 10, 10))).toBe(5);
  });
});

describe('picking the control for a missed tap', () => {
  const a: SlopCandidate<string> = { item: 'a', rect: box(0, 0, 14, 14), priority: 2 };
  const b: SlopCandidate<string> = { item: 'b', rect: box(24, 0, 14, 14), priority: 2 };
  it('a tap just outside a small button lands on it', () => {
    expect(pickSlopTarget(-8, 7, [a])?.item).toBe('a');
    expect(pickSlopTarget(7, 25, [a])?.item).toBe('a');
  });
  it('a tap outside every grown area lands on nothing', () => {
    expect(pickSlopTarget(-40, 7, [a, b])).toBeNull();
  });
  it('overlapping grown areas split by distance: the nearer control wins', () => {
    expect(pickSlopTarget(17, 7, [a, b])?.item).toBe('a'); // 3 px from a, 7 px from b
    expect(pickSlopTarget(21, 7, [a, b])?.item).toBe('b');
  });
  it('an exact tie goes to the higher priority (a button over an info tip), then the smaller control', () => {
    const tip: SlopCandidate<string> = { item: 'tip', rect: box(24, 0, 14, 14), priority: 1 };
    expect(pickSlopTarget(19, 7, [tip, a])?.item).toBe('a');
    const big: SlopCandidate<string> = { item: 'big', rect: box(24, 0, 30, 30), priority: 2 };
    expect(pickSlopTarget(19, 7, [big, a])?.item).toBe('a');
  });
});

describe('direct hits', () => {
  it('a finger on a button, a card or a board row is never retargeted', () => {
    document.body.innerHTML = '<button id="b"><span id="s">x</span></button><div class="card"><i id="c"></i></div><div id="plain"></div>';
    expect(isDirectHit(document.getElementById('s'))).toBe(true);
    expect(isDirectHit(document.getElementById('c'))).toBe(true);
    expect(isDirectHit(document.getElementById('plain'))).toBe(false);
  });
});

/** jsdom has no PointerEvent: a MouseEvent with the pointer fields bolted on reaches the same window listeners. */
function pointerDown(target: EventTarget, pointerType: string): MouseEvent {
  const e = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 1, clientY: 1, button: 0 });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  Object.defineProperty(e, 'isPrimary', { value: true });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  target.dispatchEvent(e);
  return e;
}

describe('the installer', () => {
  let off: (() => void) | null = null;
  afterEach(() => { off?.(); off = null; document.body.innerHTML = ''; });
  it('a MOUSE press is never touched, even with the touch UI on', () => {
    off = installTouchSlop(() => true);
    document.body.innerHTML = '<div id="bg" style="width:500px;height:500px"></div><button id="btn">?</button>';
    const onDown = vi.fn();
    document.getElementById('bg')!.addEventListener('pointerdown', onDown);
    const ev = pointerDown(document.getElementById('bg')!, 'mouse');
    expect(onDown).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(false);
  });
  it('with the touch UI OFF a finger press is never touched either', () => {
    off = installTouchSlop(() => false);
    document.body.innerHTML = '<div id="bg"></div>';
    const onDown = vi.fn();
    document.getElementById('bg')!.addEventListener('pointerdown', onDown);
    pointerDown(document.getElementById('bg')!, 'touch');
    expect(onDown).toHaveBeenCalledTimes(1);
  });
});
